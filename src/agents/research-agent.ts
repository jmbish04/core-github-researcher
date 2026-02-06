import { Agent } from 'agents';
import type { ResearchParams, ApprovalPayload } from '../workflows/research-workflow.js';
import { getDb } from '../lib/session.js';
import { researchTasks, repoCandidates, analysisResults } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { indexRepository } from '../lib/vectorize.js';

/**
 * Task status tracking interface
 */
interface TaskInfo {
  id: string;
  query: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  workflowInstanceId?: string;
  sessionId?: string;
}

/**
 * Pending approval with candidate repos
 */
interface PendingApproval {
  taskId: string;
  query: string;
  candidates: Array<{
    id: string;
    fullName: string;
    url: string;
    stars: number;
    description: string;
  }>;
}

/**
 * ResearchAgent manages research tasks and coordinates with the ResearchWorkflow.
 * It provides callable methods for starting research, checking pending approvals,
 * and submitting approval selections.
 */
export class ResearchAgent extends Agent<Env> {
  /**
   * Start a new research task with the given query
   */
  async startResearch(query: string, language?: string, limit?: number, sessionId?: string): Promise<TaskInfo> {
    const db = getDb(this.env.DB);
    const taskId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Create task record in D1 using Drizzle
    await db.insert(researchTasks).values({
      id: taskId,
      sessionId: sessionId || 'default',
      query,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });

    // Start the workflow
    const params: ResearchParams = {
      taskId,
      query,
      language,
      limit: limit || 10,
    };

    const instance = await this.env.RESEARCH_WORKFLOW.create({
      id: taskId,
      params,
    });

    // Update task status
    await db.update(researchTasks)
      .set({ status: 'searching', updatedAt: now })
      .where(eq(researchTasks.id, taskId));

    return {
      id: taskId,
      query,
      status: 'searching',
      createdAt: now,
      updatedAt: now,
      sessionId: sessionId || 'default',
      // Workflow instance ID matches task ID by design
      workflowInstanceId: instance.id,
    };
  }

  /**
   * Get all research tasks
   */
  async getTasks(): Promise<TaskInfo[]> {
    const db = getDb(this.env.DB);
    const tasks = await db.select({
      id: researchTasks.id,
      query: researchTasks.query,
      status: researchTasks.status,
      createdAt: researchTasks.createdAt,
      updatedAt: researchTasks.updatedAt,
      sessionId: researchTasks.sessionId,
    })
      .from(researchTasks)
      .orderBy(desc(researchTasks.createdAt))
      .all();

    return tasks as TaskInfo[];
  }

  /**
   * Get a specific task by ID
   */
  async getTask(taskId: string): Promise<TaskInfo | null> {
    const db = getDb(this.env.DB);
    const task = await db.select({
      id: researchTasks.id,
      query: researchTasks.query,
      status: researchTasks.status,
      createdAt: researchTasks.createdAt,
      updatedAt: researchTasks.updatedAt,
      sessionId: researchTasks.sessionId,
    })
      .from(researchTasks)
      .where(eq(researchTasks.id, taskId))
      .get();

    return task as TaskInfo | null;
  }

  /**
   * Get all tasks that are waiting for approval
   */
  async getPendingApprovals(): Promise<PendingApproval[]> {
    const db = getDb(this.env.DB);
    const tasks = await db.select({
      id: researchTasks.id,
      query: researchTasks.query,
    })
      .from(researchTasks)
      .where(eq(researchTasks.status, 'waiting_for_approval'))
      .all();

    const pending: PendingApproval[] = [];

    for (const task of tasks) {
      const candidates = await db.select({
        id: repoCandidates.id,
        fullName: repoCandidates.fullName,
        url: repoCandidates.url,
        stars: repoCandidates.stars,
        description: repoCandidates.description,
      })
        .from(repoCandidates)
        .where(eq(repoCandidates.taskId, task.id))
        .all();

      pending.push({
        taskId: task.id,
        query: task.query,
        candidates: candidates as Array<{
          id: string;
          fullName: string;
          url: string;
          stars: number;
          description: string;
        }>,
      });
    }

    return pending;
  }

  /**
   * Submit an approval decision for a task
   */
  async submitApproval(taskId: string, selectedRepoIds: string[]): Promise<{ success: boolean; message: string }> {
    const db = getDb(this.env.DB);
    
    // Verify task exists and is in waiting state
    const task = await db.select({
      id: researchTasks.id,
      status: researchTasks.status,
    })
      .from(researchTasks)
      .where(eq(researchTasks.id, taskId))
      .get();

    if (!task) {
      return { success: false, message: 'Task not found' };
    }

    if (task.status !== 'waiting_for_approval') {
      return { success: false, message: `Task is not waiting for approval (status: ${task.status})` };
    }

    // Send approval event to the workflow
    const payload: ApprovalPayload = { selectedRepoIds };
    
    try {
      const instance = await this.env.RESEARCH_WORKFLOW.get(taskId);
      await instance.sendEvent({
        type: 'repo-approval',
        payload,
      });

      return { success: true, message: 'Approval submitted successfully' };
    } catch (error) {
      return {
        success: false,
        message: `Failed to submit approval: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Reject a task (select no repositories)
   */
  async rejectTask(taskId: string): Promise<{ success: boolean; message: string }> {
    return this.submitApproval(taskId, []);
  }

  /**
   * Get analysis results for a completed task
   */
  async getFindings(taskId: string): Promise<{
    task: TaskInfo | null;
    results: Array<{
      id: string;
      repoId: string;
      summary: string;
      findings: Record<string, unknown>;
    }>;
  }> {
    const db = getDb(this.env.DB);
    const task = await this.getTask(taskId);
    
    const results = await db.select({
      id: analysisResults.id,
      repoId: analysisResults.repoId,
      summary: analysisResults.summary,
      findingsJson: analysisResults.findingsJson,
      repoName: repoCandidates.fullName,
    })
      .from(analysisResults)
      .innerJoin(repoCandidates, eq(analysisResults.repoId, repoCandidates.id))
      .where(eq(analysisResults.taskId, taskId))
      .all();

    return {
      task,
      results: results.map(r => ({
        id: r.id,
        repoId: r.repoId,
        summary: r.summary || '',
        findings: JSON.parse(r.findingsJson || '{}'),
      })),
    };
  }

  /**
   * Index a repository in Vectorize
   */
  async indexRepoInVectorize(
    repoId: string,
    fullName: string,
    description: string,
    url: string,
    stars: number,
    taskId: string,
    language?: string,
    topics?: string[]
  ): Promise<void> {
    try {
      const vectorizeId = await indexRepository(this.env.VECTORIZE, {
        id: repoId,
        fullName,
        description,
        url,
        stars,
        language,
        topics,
        taskId,
      }, this.env.OPENAI_API_KEY);
      
      // Update repo candidate with vectorize ID
      const db = getDb(this.env.DB);
      await db.update(repoCandidates)
        .set({ vectorizeId })
        .where(eq(repoCandidates.id, repoId));
    } catch (error) {
      console.error('Failed to index repo in Vectorize:', error);
    }
  }

  /**
   * Return the agent status
   */
  async getStatus() {
    return {
      name: this.name,
      type: 'research-agent',
      ready: true,
    };
  }
}
