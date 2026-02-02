import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { upgradeWebSocket } from 'hono/cloudflare-workers';
import { handleMcpWebSocket, WebSocketTransport } from './mcp/server.js';
import { routeAgentRequest } from 'agents';
import { CodeResearchAgent } from './agents/index.js';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import { registerSearchRoutes } from './routes/search.js';
import { cacheNote, type ProvidersEnv } from './lib/providers.js';

type Env = {
  Bindings: Cloudflare.Env & ProvidersEnv & {
    OPENAI_API_KEY: string;
    CODE_RESEARCH_AGENT: DurableObjectNamespace<CodeResearchAgent>;
  };
};

/**
 * Main Cloudflare Worker application exposing REST, MCP, and Agents endpoints.
 */
const app = new OpenAPIHono<Env>();
const searchApi = new OpenAPIHono<Env>();

registerSearchRoutes(searchApi);
app.route('/api/search', searchApi);

app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Code Research API',
    version: '0.1.0',
    description: `REST API for searching developer resources. ${cacheNote}`,
  },
});

app.get(
  '/swagger',
  swaggerUI({
    url: '/openapi.json',
  })
);

app.get(
  '/mcp',
  upgradeWebSocket((c) => {
    let transport: WebSocketTransport | undefined;
    let backlog: string[] = [];

    const ensureTransport = async (ws: Parameters<typeof handleMcpWebSocket>[0]) => {
      if (!transport) {
        transport = await handleMcpWebSocket(ws, c.env);
        backlog.forEach((message) => transport?.handleMessage(message));
        backlog = [];
      }
    };

    return {
      onOpen: async (_event: Event, ws: Parameters<typeof handleMcpWebSocket>[0]) => {
        await ensureTransport(ws);
      },
      onMessage: async (event: MessageEvent, ws: Parameters<typeof handleMcpWebSocket>[0]) => {
        if (typeof event.data !== 'string') {
          return;
        }
        if (!transport) {
          backlog.push(event.data);
          await ensureTransport(ws);
          return;
        }
        transport.handleMessage(event.data);
      },
      onClose: () => {
        transport?.close().catch(() => undefined);
      },
      onError: () => {
        transport?.onerror?.(new Error('WebSocket error'));
      },
    };
  })
);

app.all('/agents/*', async (c) => {
  const response = await routeAgentRequest(c.req.raw, c.env);
  if (response) {
    return response;
  }
  return c.text('Agent not found', 404);
});

export default app;
