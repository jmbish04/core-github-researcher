import { Agent } from 'agents';
import type { ResearchParams, ApprovalPayload } from '../workflows/research-workflow.js';

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
  async startResearch(query: string, language?: string, limit?: number): Promise<TaskInfo> {
    const taskId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Create task record in D1
    await this.env.DB.prepare(
      `INSERT INTO research_tasks (id, query, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(taskId, query, 'pending', now, now).run();

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

    // Update task status - note: workflowInstanceId equals taskId by design
    await this.env.DB.prepare(
      `UPDATE research_tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind('searching', taskId).run();

    return {
      id: taskId,
      query,
      status: 'searching',
      createdAt: now,
      updatedAt: now,
      // Workflow instance ID matches task ID by design
      workflowInstanceId: instance.id,
    };
  }

  /**
   * Get all research tasks
   */
  async getTasks(): Promise<TaskInfo[]> {
    const result = await this.env.DB.prepare(
      `SELECT id, query, status, created_at as createdAt, updated_at as updatedAt
       FROM research_tasks
       ORDER BY created_at DESC`
    ).all<TaskInfo>();

    return result.results || [];
  }

  /**
   * Get a specific task by ID
   */
  async getTask(taskId: string): Promise<TaskInfo | null> {
    const result = await this.env.DB.prepare(
      `SELECT id, query, status, created_at as createdAt, updated_at as updatedAt
       FROM research_tasks
       WHERE id = ?`
    ).bind(taskId).first<TaskInfo>();

    return result || null;
  }

  /**
   * Get all tasks that are waiting for approval
   */
  async getPendingApprovals(): Promise<PendingApproval[]> {
    const tasks = await this.env.DB.prepare(
      `SELECT id, query FROM research_tasks WHERE status = 'waiting_for_approval'`
    ).all<{ id: string; query: string }>();

    const pending: PendingApproval[] = [];

    for (const task of tasks.results || []) {
      const candidates = await this.env.DB.prepare(
        `SELECT id, full_name as fullName, url, stars, description
         FROM repo_candidates
         WHERE task_id = ?`
      ).bind(task.id).all<{
        id: string;
        fullName: string;
        url: string;
        stars: number;
        description: string;
      }>();

      pending.push({
        taskId: task.id,
        query: task.query,
        candidates: candidates.results || [],
      });
    }

    return pending;
  }

  /**
   * Submit an approval decision for a task
   */
  async submitApproval(taskId: string, selectedRepoIds: string[]): Promise<{ success: boolean; message: string }> {
    // Verify task exists and is in waiting state
    const task = await this.env.DB.prepare(
      `SELECT id, status FROM research_tasks WHERE id = ?`
    ).bind(taskId).first<{ id: string; status: string }>();

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
    const task = await this.getTask(taskId);
    
    const results = await this.env.DB.prepare(
      `SELECT ar.id, ar.repo_id as repoId, ar.summary, ar.findings_json as findingsJson,
              rc.full_name as repoName
       FROM analysis_results ar
       JOIN repo_candidates rc ON ar.repo_id = rc.id
       WHERE ar.task_id = ?`
    ).bind(taskId).all<{
      id: string;
      repoId: string;
      summary: string;
      findingsJson: string;
      repoName: string;
    }>();

    return {
      task,
      results: (results.results || []).map(r => ({
        id: r.id,
        repoId: r.repoId,
        summary: r.summary,
        findings: JSON.parse(r.findingsJson || '{}'),
      })),
    };
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
