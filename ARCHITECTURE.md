# Architecture Enhancements

This document describes the recent architecture enhancements to the core-github-researcher application.

## Session Management

All requests now receive a unique session ID that tracks user activity across the system.

### Features
- **Automatic Session Creation**: Sessions are created automatically on first request
- **Session Persistence**: Session IDs are stored in cookies (30-day expiration) and returned in response headers
- **Request Logging**: All API requests are logged to D1 with session ID, method, path, status code, and metadata
- **Session Stats**: Query session statistics including request counts and task counts via MCP tools

### Usage
Session IDs are automatically handled by middleware. Clients can:
- Send `X-Session-ID` header to use an existing session
- Omit the header to receive a new session ID
- Use the `session_id` cookie for subsequent requests

## Drizzle ORM Integration

The application now uses Drizzle ORM for type-safe database queries instead of raw SQL.

### Schema
Located in `src/db/schema.ts`, the schema includes:
- `sessions` - User session tracking
- `researchTasks` - Research task lifecycle management
- `repoCandidates` - Repository search results
- `analysisResults` - Analysis findings for approved repos
- `requestLogs` - API request logging

### Benefits
- Type-safe database queries
- Better IDE autocomplete and error checking
- Easier query composition and maintenance
- Simplified migrations with drizzle-kit

### Usage Example
```typescript
import { getDb } from '../lib/session.js';
import { researchTasks } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const db = getDb(env.DB);
const tasks = await db.select()
  .from(researchTasks)
  .where(eq(researchTasks.status, 'completed'))
  .all();
```

## Vectorize Integration

GitHub repositories are now indexed in Cloudflare Vectorize for semantic search capabilities.

### Features
- **Automatic Indexing**: Repositories are automatically indexed when analyzed
- **Vector Similarity Search**: Find similar repositories using natural language queries
- **Metadata Filtering**: Filter results by task ID, language, topics, etc.
- **Persistent Storage**: Vector IDs are stored in D1 for reference

### Usage
The `indexRepository` function in `src/lib/vectorize.ts` handles indexing:

```typescript
import { indexRepository, searchSimilarRepositories } from '../lib/vectorize.js';

// Index a repository
await indexRepository(env.VECTORIZE, {
  id: repoId,
  fullName: 'owner/repo',
  description: 'Repository description',
  url: 'https://github.com/owner/repo',
  stars: 1000,
  language: 'TypeScript',
  topics: ['cloudflare', 'workers'],
  taskId: taskId,
});

// Search for similar repositories
const results = await searchSimilarRepositories(env.VECTORIZE, 'cloudflare workers', {
  topK: 10,
  filter: { taskId: 'some-task-id' }
});
```

## Enhanced MCP Tools

The MCP server now includes additional tools for agents to query D1 tables and Vectorize.

### New Tools

1. **query_research_tasks**: Query research tasks with optional filters
   - Filter by status (pending, searching, completed, etc.)
   - Filter by session ID
   - Limit results

2. **query_repo_candidates**: Query repository candidates
   - Filter by task ID
   - Filter by selection status
   - Limit results

3. **query_vectorize**: Search for similar repositories using vector similarity
   - Natural language query
   - Top K results
   - Optional task ID filter

4. **get_session_stats**: Get statistics about a session
   - Request count
   - Task count
   - Session metadata

### Usage in MCP Clients
Connect to the WebSocket endpoint at `/mcp` and call tools:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "query_research_tasks",
    "arguments": {
      "status": "completed",
      "limit": 5
    }
  },
  "id": 1
}
```

## OpenAPI 3.1.0 Compliance

All REST API endpoints are documented with OpenAPI 3.1.0 specification.

### Endpoints
- **GET /openapi.json**: OpenAPI specification
- **GET /swagger**: Interactive Swagger UI documentation
- All routes have operation IDs for easy client generation

### API Access Methods
The worker exposes services via:
1. **REST API**: Standard HTTP endpoints (`/api/search/*`, `/api/research/*`)
2. **WebSocket API**: MCP protocol over WebSocket (`/mcp`)
3. **Agents API**: OpenAI Agents SDK endpoints (`/agents/*`)

## Container Binding

The Dockerfile has been updated to properly run as a container binding on Cloudflare Workers.

### Features
- Multi-stage build for optimized image size
- Exposes port 8787 for worker binding
- Runs wrangler dev for local development
- Production-ready with environment variable support

### Usage
```bash
# Build the container
docker build -t core-github-researcher .

# Run locally
docker run -p 8787:8787 \
  -e GITHUB_TOKEN=your_token \
  -e OPENAI_API_KEY=your_key \
  core-github-researcher
```

## Database Migrations

Two migrations are included:

1. **0001_create_research_tables.sql**: Initial schema for research workflow
2. **0002_add_sessions_and_logging.sql**: Adds sessions, request logging, and Vectorize support

### Running Migrations
```bash
# Apply migrations locally
wrangler d1 migrations apply research-db --local

# Apply migrations to production
wrangler d1 migrations apply research-db
```

## Environment Configuration

Update your `.dev.vars` or Cloudflare dashboard with:

```env
GITHUB_TOKEN=your_github_token
OPENAI_API_KEY=your_openai_key
```

The wrangler.jsonc includes bindings for:
- **DB**: D1 database for persistent storage
- **VECTORIZE**: Vectorize index for semantic search
- **ASSETS**: Static assets for frontend
- **CODE_RESEARCH_AGENT**: Durable Object for OpenAI agent
- **RESEARCH_AGENT**: Durable Object for research coordination
- **RESEARCH_WORKFLOW**: Workflow for multi-agent research

## Testing

To test the enhanced features:

```bash
# Build and type check
npm run build

# Start local development server
npm run dev

# Test session creation
curl -v http://localhost:8787/api/search/github?query=cloudflare

# Test MCP WebSocket (use wscat or similar)
wscat -c ws://localhost:8787/mcp

# View API documentation
open http://localhost:8787/swagger
```
