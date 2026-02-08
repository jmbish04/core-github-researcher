import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { upgradeWebSocket } from 'hono/cloudflare-workers';
import { handleMcpWebSocket, WebSocketTransport } from './mcp/server.js';
import { routeAgentRequest } from 'agents';
import { CodeResearchAgent, ResearchAgent } from './agents/index.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerResearchRoutes } from './routes/research.js';
import { cacheNote, type ProvidersEnv } from './lib/providers.js';
import { sessionMiddleware, requestLoggingMiddleware } from './lib/session.js';

// Export workflow and agents for Cloudflare
export { ResearchWorkflow } from './workflows/research-workflow.js';
export { CodeResearchAgent, ResearchAgent } from './agents/index.js';

type Env = {
  Bindings: Cloudflare.Env & ProvidersEnv & {
    OPENAI_API_KEY?: string;
    CODE_RESEARCH_AGENT: DurableObjectNamespace<CodeResearchAgent>;
    RESEARCH_AGENT: DurableObjectNamespace<ResearchAgent>;
    DB: D1Database;
    VECTORIZE: VectorizeIndex;
    ASSETS?: Fetcher;
  };
};

/**
 * Generated worker types from `wrangler types` must be present for Cloudflare.Env.
 */

/**
 * Main Cloudflare Worker application exposing REST, MCP, and Agents endpoints.
 */
const app = new OpenAPIHono<Env>();

// Apply session middleware to all routes
app.use('*', sessionMiddleware);
app.use('*', requestLoggingMiddleware);

const searchApi = new OpenAPIHono<Env>();

registerSearchRoutes(searchApi);
app.route('/api/search', searchApi);

// Research API routes
const researchApi = new OpenAPIHono<Env>();
registerResearchRoutes(researchApi);
app.route('/api/research', researchApi);

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
    let transportPromise: Promise<WebSocketTransport> | undefined;

    const getTransport = (ws: Parameters<typeof handleMcpWebSocket>[0]) => {
      if (!transportPromise) {
        transportPromise = handleMcpWebSocket(ws, c.env);
      }
      return transportPromise;
    };

    return {
      onOpen: (_event: Event, ws: Parameters<typeof handleMcpWebSocket>[0]) => {
        getTransport(ws).catch((e) => console.error('Transport initialization failed', e));
      },
      onMessage: async (event: MessageEvent, ws: Parameters<typeof handleMcpWebSocket>[0]) => {
        if (typeof event.data !== 'string') {
          return;
        }
        try {
          const transport = await getTransport(ws);
          transport.handleMessage(event.data);
        } catch (e) {
          console.error('Failed to handle message:', e);
          ws.close(1011, 'Internal Server Error');
        }
      },
      onClose: async () => {
        if (!transportPromise) return;
        try {
          const transport = await transportPromise;
          await transport.close();
        } catch {
          // Ignore if initialization failed
        }
      },
      onError: async () => {
        if (!transportPromise) return;
        try {
          const transport = await transportPromise;
          transport.onerror?.(new Error('WebSocket error'));
        } catch {
          // Ignore if initialization failed
        }
      },
    };
  })
);

app.all('/agents/*', async (c) => {
  if (!c.env.OPENAI_API_KEY) {
    return c.text('OPENAI_API_KEY environment variable is not configured.', 503);
  }
  const response = await routeAgentRequest(c.req.raw, c.env);
  if (response) {
    return response;
  }
  return c.text('Agent not found', 404);
});

// Serve frontend assets if ASSETS binding is available
app.all('*', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('Not found', 404);
});

export default app;
