import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
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

export class WebSocketTransport implements Transport {
  private ws: WSContext;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(ws: WSContext) {
    this.ws = ws;
  }

  async start(): Promise<void> {
    return;
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.ws.send(JSON.stringify(message));
  }

  async close(): Promise<void> {
    this.ws.close();
    this.onclose?.();
  }

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

const getServer = (env: ProvidersEnv) => {
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

  server.onerror = (error) => console.error('[MCP Error]', error);

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
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
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
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
    }
  });

  return server;
};

// This transport uses a WebSocket to move JSON-RPC messages between the MCP server and connected client.
// This transport uses a WebSocket to move JSON-RPC messages between the MCP server and connected client.
export const handleMcpWebSocket = async (ws: WSContext, env: ProvidersEnv) => {
  const transport = new WebSocketTransport(ws);
  const server = getServer(env);

  // The WebSocket transport bridges JSON-RPC messages between the MCP Server and the WebSocket client.
  await server.connect(transport);

  return transport;
};
