import { createRoute, z } from '@hono/zod-openapi';
import type { OpenAPIHono } from '@hono/zod-openapi';
import {
  searchAll,
  searchGitHub,
  searchMDN,
  searchNpm,
  searchPyPI,
  searchStackOverflow,
  type ProvidersEnv,
} from '../lib/providers.js';

const querySchema = z.string().min(1).openapi({ example: 'Cloudflare Workers fetch' });
const limitSchema = z.coerce.number().min(1).max(10).optional().openapi({ example: 5 });
const limitAllSchema = z.coerce.number().min(1).max(5).optional().openapi({ example: 3 });

const searchResponse = z.object({
  platform: z.string(),
  query: z.string(),
  results: z.string(),
});

const queryOnlyParams = z.object({
  query: querySchema,
});

const queryWithLimitParams = z.object({
  query: querySchema,
  limit: limitSchema,
});

const githubQueryParams = z.object({
  query: querySchema,
  limit: limitSchema,
  language: z.string().optional().openapi({ example: 'typescript' }),
});

const allQueryParams = z.object({
  query: querySchema,
  limit: limitAllSchema,
});

const errorResponse = z.object({
  message: z.string(),
});

const createSearchRoute = (
  platform: string,
  operationId: string,
  query: z.ZodTypeAny,
  responseDescription: string
) =>
  createRoute({
    method: 'get',
    path: `/${platform}`,
    operationId,
    request: {
      query,
    },
    responses: {
      200: {
        description: responseDescription,
        content: {
          'application/json': {
            schema: searchResponse,
          },
        },
      },
      400: {
        description: 'Invalid request parameters',
        content: {
          'application/json': {
            schema: errorResponse,
          },
        },
      },
    },
  });

const searchStackOverflowRoute = createSearchRoute(
  'stackoverflow',
  'searchStackOverflow',
  queryWithLimitParams,
  'Search results for stackoverflow'
);
const searchMdnRoute = createSearchRoute('mdn', 'searchMdn', queryOnlyParams, 'Search results for mdn');
const searchGitHubRoute = createSearchRoute('github', 'searchGithub', githubQueryParams, 'Search results for github');
const searchNpmRoute = createSearchRoute('npm', 'searchNpm', queryWithLimitParams, 'Search results for npm');
const searchPyPiRoute = createSearchRoute('pypi', 'searchPyPi', queryOnlyParams, 'Search results for pypi');
const searchAllRoute = createSearchRoute('all', 'searchAll', allQueryParams, 'Search results for all');

export const registerSearchRoutes = (app: OpenAPIHono<{ Bindings: ProvidersEnv }>) => {
  app.openapi(searchStackOverflowRoute, async (c) => {
    const { query, limit } = c.req.valid('query');
    const results = await searchStackOverflow(query, limit);
    return c.json({ platform: 'stackoverflow', query, results }, 200);
  });

  app.openapi(searchMdnRoute, async (c) => {
    const { query } = c.req.valid('query');
    const results = await searchMDN(query);
    return c.json({ platform: 'mdn', query, results }, 200);
  });

  app.openapi(searchGitHubRoute, async (c) => {
    const { query, limit, language } = c.req.valid('query');
    const results = await searchGitHub(c.env, query, language, limit);
    return c.json({ platform: 'github', query, results }, 200);
  });

  app.openapi(searchNpmRoute, async (c) => {
    const { query, limit } = c.req.valid('query');
    const results = await searchNpm(query, limit);
    return c.json({ platform: 'npm', query, results }, 200);
  });

  app.openapi(searchPyPiRoute, async (c) => {
    const { query } = c.req.valid('query');
    const results = await searchPyPI(query);
    return c.json({ platform: 'pypi', query, results }, 200);
  });

  app.openapi(searchAllRoute, async (c) => {
    const { query, limit } = c.req.valid('query');
    const results = await searchAll(c.env, query, limit ?? 3);
    return c.json({ platform: 'all', query, results }, 200);
  });
};
