import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { WSContext } from 'hono/ws';
import {
  cacheNote,
  searchAll,
  searchGitHub,
  searchMDN,
  searchNpm,
  searchPyPI,
  searchStackOverflow,
  type ProvidersEnv,
} from '../lib/providers.js';
import { getDb } from '../lib/session.js';
import { researchTasks, repoCandidates, analysisResults, sessions, requestLogs } from '../db/schema.js';
import { eq, desc, and, sql } from 'drizzle-orm';
import { searchSimilarRepositories } from '../lib/vectorize.js';

type McpEnv = ProvidersEnv & {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  OPENAI_API_KEY?: string;
};

export class WebSocketTransport implements Transport {
  private ws: WSContext;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  /**
   * Create a transport that bridges MCP JSON-RPC messages over a Cloudflare WebSocket.
   */
  constructor(ws: WSContext) {
    this.ws = ws;
  }

  /**
   * Start the transport (no-op for WebSocket-backed transports).
   */
  async start(): Promise<void> {
    return;
  }

  /**
   * Send a JSON-RPC message to the WebSocket client.
   */
  async send(message: JSONRPCMessage): Promise<void> {
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Close the WebSocket connection.
   */
  async close(): Promise<void> {
    this.ws.close();
    this.onclose?.();
  }

  /**
   * Parse inbound JSON-RPC messages from the WebSocket and forward to MCP.
   */
  handleMessage(data: string) {
    try {
      const parsed = JSON.parse(data) as JSONRPCMessage;
      this.onmessage?.(parsed);
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Failed to parse MCP message');
      this.onerror?.(err);
    }
  }
}

const getServer = (env: McpEnv) => {
  const server = new Server(
    {
      name: 'code-research-server',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.onerror = (error: Error) => console.error('[MCP Error]', error);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'search_stackoverflow',
        description: 'Search Stack Overflow for programming questions and answers',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results (default: 5)',
              minimum: 1,
              maximum: 10,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'search_mdn',
        description: 'Search MDN Web Docs for web development documentation',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'search_github',
        description: 'Search GitHub for repositories and code',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query',
            },
            language: {
              type: 'string',
              description: 'Filter by programming language',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results per category (default: 5)',
              minimum: 1,
              maximum: 10,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'search_npm',
        description: 'Search npm registry for JavaScript packages',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results (default: 5)',
              minimum: 1,
              maximum: 10,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'search_pypi',
        description: 'Search PyPI for Python packages',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'search_all',
        description: `Search all platforms simultaneously. ${cacheNote}`,
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query',
            },
            limit: {
              type: 'number',
              description: 'Maximum results per platform (1-5, default: 3)',
              minimum: 1,
              maximum: 5,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'query_research_tasks',
        description: 'Query research tasks from D1 database with optional filters',
        inputSchema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              description: 'Filter by task status (e.g., pending, searching, completed)',
            },
            sessionId: {
              type: 'string',
              description: 'Filter by session ID',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results (default: 10)',
              minimum: 1,
              maximum: 100,
            },
          },
        },
      },
      {
        name: 'query_repo_candidates',
        description: 'Query repository candidates from D1 database',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: {
              type: 'string',
              description: 'Filter by task ID',
            },
            isSelected: {
              type: 'boolean',
              description: 'Filter by selection status',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results (default: 20)',
              minimum: 1,
              maximum: 100,
            },
          },
        },
      },
      {
        name: 'query_vectorize',
        description: 'Search for similar repositories using vector similarity in Vectorize',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query for finding similar repositories',
            },
            topK: {
              type: 'number',
              description: 'Number of top results to return (default: 10)',
              minimum: 1,
              maximum: 50,
            },
            taskId: {
              type: 'string',
              description: 'Optional: Filter by task ID',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_session_stats',
        description: 'Get statistics about a session including request counts and activity',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID to query',
            },
          },
          required: ['sessionId'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    const db = getDb(env.DB);
    
    switch (request.params.name) {
      case 'search_stackoverflow': {
        const { query, limit } = request.params.arguments as { query: string; limit?: number };
        const results = await searchStackOverflow(query, limit);
        return { content: [{ type: 'text', text: results }] };
      }
      case 'search_mdn': {
        const { query } = request.params.arguments as { query: string };
        const results = await searchMDN(query);
        return { content: [{ type: 'text', text: results }] };
      }
      case 'search_github': {
        const { query, language, limit } = request.params.arguments as { query: string; language?: string; limit?: number };
        const results = await searchGitHub(env, query, language, limit);
        return { content: [{ type: 'text', text: results }] };
      }
      case 'search_npm': {
        const { query, limit } = request.params.arguments as { query: string; limit?: number };
        const results = await searchNpm(query, limit);
        return { content: [{ type: 'text', text: results }] };
      }
      case 'search_pypi': {
        const { query } = request.params.arguments as { query: string };
        const results = await searchPyPI(query);
        return { content: [{ type: 'text', text: results }] };
      }
      case 'search_all': {
        const { query, limit } = request.params.arguments as { query: string; limit?: number };
        const results = await searchAll(env, query, limit);
        return { content: [{ type: 'text', text: results }] };
      }
      case 'query_research_tasks': {
        const { status, sessionId, limit = 10 } = request.params.arguments as { 
          status?: string; 
          sessionId?: string; 
          limit?: number 
        };
        
        let queryBuilder = db.select().from(researchTasks);
        
        if (status || sessionId) {
          const conditions = [];
          if (status) conditions.push(eq(researchTasks.status, status));
          if (sessionId) conditions.push(eq(researchTasks.sessionId, sessionId));
          if (conditions.length === 1) {
            queryBuilder = queryBuilder.where(conditions[0]) as any;
          } else if (conditions.length > 1) {
            queryBuilder = queryBuilder.where(and(...conditions)) as any;
          }
        }
        
        const tasks = await queryBuilder.orderBy(desc(researchTasks.createdAt)).limit(limit).all();
        return { content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }] };
      }
      case 'query_repo_candidates': {
        const { taskId, isSelected, limit = 20 } = request.params.arguments as {
          taskId?: string;
          isSelected?: boolean;
          limit?: number;
        };
        
        let queryBuilder = db.select().from(repoCandidates);
        
        if (taskId || isSelected !== undefined) {
          const conditions = [];
          if (taskId) conditions.push(eq(repoCandidates.taskId, taskId));
          if (isSelected !== undefined) conditions.push(eq(repoCandidates.isSelected, isSelected ? 1 : 0));
          if (conditions.length === 1) {
            queryBuilder = queryBuilder.where(conditions[0]) as any;
          } else if (conditions.length > 1) {
            queryBuilder = queryBuilder.where(and(...conditions)) as any;
          }
        }
        
        const candidates = await queryBuilder.limit(limit).all();
        return { content: [{ type: 'text', text: JSON.stringify(candidates, null, 2) }] };
      }
      case 'query_vectorize': {
        const { query, topK = 10, taskId } = request.params.arguments as {
          query: string;
          topK?: number;
          taskId?: string;
        };
        
        const filter = taskId ? { taskId } : undefined;
        const results = await searchSimilarRepositories(env.VECTORIZE, query, {
          topK,
          filter,
          openaiKey: env.OPENAI_API_KEY,
        });
        
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      }
      case 'get_session_stats': {
        const { sessionId } = request.params.arguments as { sessionId: string };
        
        // Get session info
        const session = await db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
        
        if (!session) {
          return { content: [{ type: 'text', text: 'Session not found' }] };
        }
        
        // Get request count
        const requestCount = await db
          .select({ count: sql<number>`count(*)` })
          .from(requestLogs)
          .where(eq(requestLogs.sessionId, sessionId))
          .get();
        
        // Get task count
        const taskCount = await db
          .select({ count: sql<number>`count(*)` })
          .from(researchTasks)
          .where(eq(researchTasks.sessionId, sessionId))
          .get();
        
        const stats = {
          session,
          requestCount: requestCount?.count || 0,
          taskCount: taskCount?.count || 0,
        };
        
        return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
      }
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
    }
  });

  return server;
};

/**
 * Connect the MCP server to a WebSocket transport and return the transport instance.
 */
export const handleMcpWebSocket = async (ws: WSContext, env: McpEnv) => {
  const transport = new WebSocketTransport(ws);
  const server = getServer(env);

  /**
   * Bridge JSON-RPC messages between the MCP server and WebSocket client.
   */
  await server.connect(transport);

  return transport;
};
