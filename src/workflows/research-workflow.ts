import { WorkflowEntrypoint, WorkflowStep } from 'cloudflare:workers';
import type { WorkflowEvent } from 'cloudflare:workers';

/**
 * Parameters for initiating a research workflow
 */
export interface ResearchParams {
  taskId: string;
  query: string;
  language?: string;
  limit?: number;
}

/**
 * Repository candidate returned from search
 */
export interface RepoCandidate {
  id: string;
  fullName: string;
  url: string;
  stars: number;
  description: string;
}

/**
 * Approval event payload sent by the user
 */
export interface ApprovalPayload {
  selectedRepoIds: string[];
}

/**
 * Analysis result for a single repository
 */
export interface RepoAnalysis {
  repoId: string;
  fullName: string;
  summary: string;
  findings: {
    readme?: string;
    packageInfo?: string;
    recentActivity?: string;
  };
}

/**
 * Final research result
 */
export interface ResearchResult {
  taskId: string;
  query: string;
  status: 'completed' | 'rejected';
  analyses: RepoAnalysis[];
}

type Env = {
  GITHUB_TOKEN?: string;
  DB: D1Database;
};

/**
 * ResearchWorkflow implements a Human-in-the-Loop research process:
 * 1. Search GitHub for repositories
 * 2. Wait for user approval to select which repos to analyze
 * 3. Analyze selected repositories in parallel
 * 4. Store final results in D1
 */
export class ResearchWorkflow extends WorkflowEntrypoint<Env, ResearchParams> {
  async run(event: WorkflowEvent<ResearchParams>, step: WorkflowStep): Promise<ResearchResult> {
    const { taskId, query, language, limit = 10 } = event.payload;

    // Step 1: Search GitHub for repositories
    const candidates = await step.do('search-github', async () => {
      const repos = await this.searchGitHub(query, language, limit);
      
      // Store candidates in D1
      for (const repo of repos) {
        await this.env.DB.prepare(
          `INSERT INTO repo_candidates (id, task_id, full_name, url, stars, description)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          repo.id,
          taskId,
          repo.fullName,
          repo.url,
          repo.stars,
          repo.description
        ).run();
      }

      // Update task status to waiting for approval
      await this.env.DB.prepare(
        `UPDATE research_tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind('waiting_for_approval', taskId).run();

      return repos;
    });

    // Step 2: Wait for user approval with 24-hour timeout
    let approval: ApprovalPayload;
    try {
      const event = await step.waitForEvent<ApprovalPayload>(
        'wait-for-repo-selection',
        { type: 'repo-approval', timeout: '24 hours' }
      );
      approval = event.payload;
    } catch {
      // Timeout or rejection - mark task as timed out
      await step.do('handle-timeout', async () => {
        await this.env.DB.prepare(
          `UPDATE research_tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`
        ).bind('timed_out', taskId).run();
      });
      
      return {
        taskId,
        query,
        status: 'rejected',
        analyses: [],
      };
    }

    // Check if any repos were selected
    if (!approval.selectedRepoIds || approval.selectedRepoIds.length === 0) {
      await step.do('handle-rejection', async () => {
        await this.env.DB.prepare(
          `UPDATE research_tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`
        ).bind('rejected', taskId).run();
      });

      return {
        taskId,
        query,
        status: 'rejected',
        analyses: [],
      };
    }

    // Step 3: Mark selected repos and update status
    await step.do('mark-selected-repos', async () => {
      for (const repoId of approval.selectedRepoIds) {
        await this.env.DB.prepare(
          `UPDATE repo_candidates SET is_selected = 1 WHERE id = ? AND task_id = ?`
        ).bind(repoId, taskId).run();
      }
      
      await this.env.DB.prepare(
        `UPDATE research_tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind('analyzing', taskId).run();
    });

    // Step 4: Analyze selected repositories in parallel
    const selectedRepos = candidates.filter(r => approval.selectedRepoIds.includes(r.id));
    
    const analyses = await step.do('analyze-repos', async () => {
      const analysisPromises = selectedRepos.map(repo => this.analyzeRepository(repo));
      return Promise.all(analysisPromises);
    });

    // Step 5: Store analysis results and finalize
    await step.do('store-results', async () => {
      for (const analysis of analyses) {
        const analysisId = crypto.randomUUID();
        await this.env.DB.prepare(
          `INSERT INTO analysis_results (id, task_id, repo_id, summary, findings_json)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(
          analysisId,
          taskId,
          analysis.repoId,
          analysis.summary,
          JSON.stringify(analysis.findings)
        ).run();
      }

      await this.env.DB.prepare(
        `UPDATE research_tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind('completed', taskId).run();
    });

    return {
      taskId,
      query,
      status: 'completed',
      analyses,
    };
  }

  /**
   * Search GitHub for repositories matching the query
   */
  private async searchGitHub(
    query: string,
    language?: string,
    limit = 10
  ): Promise<RepoCandidate[]> {
    const q = language ? `${query} language:${language}` : query;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'CodeResearchBot/1.0',
    };
    if (this.env.GITHUB_TOKEN) {
      headers.Authorization = `token ${this.env.GITHUB_TOKEN}`;
    }

    const url = new URL('https://api.github.com/search/repositories');
    url.searchParams.set('q', q);
    url.searchParams.set('sort', 'stars');
    url.searchParams.set('order', 'desc');
    url.searchParams.set('per_page', limit.toString());

    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const data = await response.json() as {
      items: Array<{
        id: number;
        full_name: string;
        html_url: string;
        stargazers_count: number;
        description: string | null;
      }>;
    };

    return data.items.map(item => ({
      id: `gh-${item.id}`,
      fullName: item.full_name,
      url: item.html_url,
      stars: item.stargazers_count,
      description: item.description || 'No description',
    }));
  }

  /**
   * Analyze a repository by fetching README, package.json, and recent activity
   */
  private async analyzeRepository(repo: RepoCandidate): Promise<RepoAnalysis> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'CodeResearchBot/1.0',
    };
    if (this.env.GITHUB_TOKEN) {
      headers.Authorization = `token ${this.env.GITHUB_TOKEN}`;
    }

    // Fetch README
    let readme = '';
    try {
      const readmeUrl = `https://api.github.com/repos/${repo.fullName}/readme`;
      const readmeResponse = await fetch(readmeUrl, {
        headers: { ...headers, Accept: 'application/vnd.github.v3.raw' },
      });
      if (readmeResponse.ok) {
        const text = await readmeResponse.text();
        readme = text.substring(0, 2000); // Limit to first 2000 chars
      }
    } catch {
      readme = 'Unable to fetch README';
    }

    // Fetch package.json (if exists)
    let packageInfo = '';
    try {
      const packageUrl = `https://api.github.com/repos/${repo.fullName}/contents/package.json`;
      const packageResponse = await fetch(packageUrl, { headers });
      if (packageResponse.ok) {
        const data = await packageResponse.json() as { content: string };
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        const pkg = JSON.parse(content);
        packageInfo = JSON.stringify({
          name: pkg.name,
          version: pkg.version,
          dependencies: Object.keys(pkg.dependencies || {}).slice(0, 10),
        });
      }
    } catch {
      packageInfo = 'No package.json found';
    }

    // Fetch recent commits
    let recentActivity = '';
    try {
      const commitsUrl = `https://api.github.com/repos/${repo.fullName}/commits?per_page=5`;
      const commitsResponse = await fetch(commitsUrl, { headers });
      if (commitsResponse.ok) {
        const commits = await commitsResponse.json() as Array<{
          commit: { message: string; author: { date: string } };
        }>;
        recentActivity = commits
          .map(c => `${c.commit.author.date}: ${c.commit.message.split('\n')[0]}`)
          .join('\n');
      }
    } catch {
      recentActivity = 'Unable to fetch recent activity';
    }

    return {
      repoId: repo.id,
      fullName: repo.fullName,
      summary: `Repository: ${repo.fullName}\nStars: ${repo.stars}\nDescription: ${repo.description}`,
      findings: {
        readme,
        packageInfo,
        recentActivity,
      },
    };
  }
}
