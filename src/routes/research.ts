import { createRoute, z } from '@hono/zod-openapi';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { getAgentByName } from 'agents';
import type { ResearchAgent } from '../agents/research-agent.js';

const taskSchema = z.object({
  id: z.string(),
  query: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  workflowInstanceId: z.string().optional(),
});

const candidateSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  url: z.string(),
  stars: z.number(),
  description: z.string(),
});

const pendingApprovalSchema = z.object({
  taskId: z.string(),
  query: z.string(),
  candidates: z.array(candidateSchema),
});

const findingSchema = z.object({
  id: z.string(),
  repoId: z.string(),
  summary: z.string(),
  findings: z.record(z.string(), z.unknown()),
});

const startResearchBody = z.object({
  query: z.string().min(1).openapi({ example: 'Cloudflare Workers' }),
  language: z.string().optional().openapi({ example: 'typescript' }),
  limit: z.number().min(1).max(20).optional().openapi({ example: 10 }),
});

const submitApprovalBody = z.object({
  selectedRepoIds: z.array(z.string()).openapi({ example: ['gh-123456', 'gh-789012'] }),
});

const errorResponse = z.object({
  message: z.string(),
});

const successResponse = z.object({
  success: z.boolean(),
  message: z.string(),
});

// Route definitions
const startResearchRoute = createRoute({
  method: 'post',
  path: '/start',
  operationId: 'startResearch',
  request: {
    body: {
      content: {
        'application/json': {
          schema: startResearchBody,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Research task started successfully',
      content: {
        'application/json': {
          schema: taskSchema,
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: errorResponse,
        },
      },
    },
  },
});

const getTasksRoute = createRoute({
  method: 'get',
  path: '/tasks',
  operationId: 'getTasks',
  responses: {
    200: {
      description: 'List of all research tasks',
      content: {
        'application/json': {
          schema: z.array(taskSchema),
        },
      },
    },
  },
});

const getTaskRoute = createRoute({
  method: 'get',
  path: '/tasks/{taskId}',
  operationId: 'getTask',
  request: {
    params: z.object({
      taskId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Research task details',
      content: {
        'application/json': {
          schema: taskSchema,
        },
      },
    },
    404: {
      description: 'Task not found',
      content: {
        'application/json': {
          schema: errorResponse,
        },
      },
    },
  },
});

const getPendingApprovalsRoute = createRoute({
  method: 'get',
  path: '/pending',
  operationId: 'getPendingApprovals',
  responses: {
    200: {
      description: 'List of tasks waiting for approval',
      content: {
        'application/json': {
          schema: z.array(pendingApprovalSchema),
        },
      },
    },
  },
});

const submitApprovalRoute = createRoute({
  method: 'post',
  path: '/tasks/{taskId}/approve',
  operationId: 'submitApproval',
  request: {
    params: z.object({
      taskId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: submitApprovalBody,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Approval submitted',
      content: {
        'application/json': {
          schema: successResponse,
        },
      },
    },
    400: {
      description: 'Invalid request or task not in approval state',
      content: {
        'application/json': {
          schema: errorResponse,
        },
      },
    },
  },
});

const rejectTaskRoute = createRoute({
  method: 'post',
  path: '/tasks/{taskId}/reject',
  operationId: 'rejectTask',
  request: {
    params: z.object({
      taskId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Task rejected',
      content: {
        'application/json': {
          schema: successResponse,
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: errorResponse,
        },
      },
    },
  },
});

const getFindingsRoute = createRoute({
  method: 'get',
  path: '/findings/{taskId}',
  operationId: 'getFindings',
  request: {
    params: z.object({
      taskId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Analysis findings for the task',
      content: {
        'application/json': {
          schema: z.object({
            task: taskSchema.nullable(),
            results: z.array(findingSchema),
          }),
        },
      },
    },
  },
});

/**
 * Register research API routes
 */
export const registerResearchRoutes = (
  app: OpenAPIHono<{ Bindings: Env }>
) => {
  const getAgent = async (env: Env) => {
    return await getAgentByName(env.RESEARCH_AGENT, 'default');
  };

  app.openapi(startResearchRoute, async (c) => {
    const body = c.req.valid('json');
    const agent = await getAgent(c.env);
    const result = await (agent as unknown as ResearchAgent).startResearch(body.query, body.language, body.limit);
    return c.json(result, 200);
  });

  app.openapi(getTasksRoute, async (c) => {
    const agent = await getAgent(c.env);
    const tasks = await (agent as unknown as ResearchAgent).getTasks();
    return c.json(tasks, 200);
  });

  app.openapi(getTaskRoute, async (c) => {
    const { taskId } = c.req.valid('param');
    const agent = await getAgent(c.env);
    const task = await (agent as unknown as ResearchAgent).getTask(taskId);
    if (!task) {
      return c.json({ message: 'Task not found' }, 404);
    }
    return c.json(task, 200);
  });

  app.openapi(getPendingApprovalsRoute, async (c) => {
    const agent = await getAgent(c.env);
    const pending = await (agent as unknown as ResearchAgent).getPendingApprovals();
    return c.json(pending, 200);
  });

  app.openapi(submitApprovalRoute, async (c) => {
    const { taskId } = c.req.valid('param');
    const body = c.req.valid('json');
    const agent = await getAgent(c.env);
    const result = await (agent as unknown as ResearchAgent).submitApproval(taskId, body.selectedRepoIds);
    if (!result.success) {
      return c.json({ message: result.message }, 400);
    }
    return c.json(result, 200);
  });

  app.openapi(rejectTaskRoute, async (c) => {
    const { taskId } = c.req.valid('param');
    const agent = await getAgent(c.env);
    const result = await (agent as unknown as ResearchAgent).rejectTask(taskId);
    if (!result.success) {
      return c.json({ message: result.message }, 400);
    }
    return c.json(result, 200);
  });

  app.openapi(getFindingsRoute, async (c) => {
    const { taskId } = c.req.valid('param');
    const agent = await getAgent(c.env);
    const findings = await (agent as unknown as ResearchAgent).getFindings(taskId);
    return c.json(findings, 200);
  });
};
