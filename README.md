# Code Research MCP Server
[![smithery badge](https://smithery.ai/badge/@nahmanmate/code-research-mcp-server)](https://smithery.ai/server/@nahmanmate/code-research-mcp-server)

A Model Context Protocol server that provides tools for searching and accessing programming resources across multiple platforms. This server integrates with popular developer platforms to help LLMs find relevant code examples, documentation, and packages.

<a href="https://glama.ai/mcp/servers/8ibodeufsz"><img width="380" height="200" src="https://glama.ai/mcp/servers/8ibodeufsz/badge" alt="Code Research Server MCP server" /></a>

## Features

### Integrated Platforms
- Stack Overflow - Programming Q&A
- MDN Web Docs - Web development documentation
- GitHub - Code and repository search
- npm - JavaScript package registry
- PyPI - Python package index

### Tools

#### `search_stackoverflow`
Search Stack Overflow for programming questions and answers.
- Parameters:
  - `query` (required): Search query string
  - `limit` (optional): Maximum results (1-10, default: 5)
- Returns: Formatted list of questions with scores, answer counts, and excerpts
- Results are cached for 1 hour

#### `search_mdn`
Search MDN Web Docs for web development documentation.
- Parameters:
  - `query` (required): Search query string
- Returns: Top 5 MDN documentation matches with summaries and links
- Results are cached for 1 hour

#### `search_github`
Search GitHub for both repositories and code examples.
- Parameters:
  - `query` (required): Search query string
  - `language` (optional): Filter by programming language
  - `limit` (optional): Maximum results per category (1-10, default: 5)
- Returns: Two sections:
  1. Top repositories sorted by stars
  2. Relevant code files with repository context
- Results are cached for 1 hour

#### `search_npm`
Search npm registry for JavaScript packages.
- Parameters:
  - `query` (required): Search query string
  - `limit` (optional): Maximum results (1-10, default: 5)
- Returns: Package information including version, description, and download stats
- Results are cached for 1 hour

#### `search_pypi`
Search PyPI for Python packages.
- Parameters:
  - `query` (required): Search query string
- Returns: Detailed package information including version, author, and links
- Results are cached for 1 hour

#### `search_all`
Search all platforms simultaneously for comprehensive results.
- Parameters:
  - `query` (required): Search query string
  - `limit` (optional): Maximum results per platform (1-5, default: 3)
- Returns: Combined results from all platforms:
  1. Stack Overflow questions and answers
  2. MDN documentation
  3. GitHub repositories and code
  4. npm packages
  5. PyPI packages
- Results are cached for 1 hour
- Note: Executes all searches in parallel for faster response

## Cloudflare Workers Setup

### Prerequisites

- Node.js >= 20.11.0
- npm >= 10.0.0
- Cloudflare Wrangler CLI (`npm install -g wrangler`)
- Cloudflare account with Workers + Durable Objects enabled

### Install Dependencies

```bash
npm install
```

### Local Development

1. Create a `.dev.vars` file for local secrets:

```bash
GITHUB_TOKEN=your_github_token
OPENAI_API_KEY=your_openai_key
```

2. Start the Worker:

```bash
wrangler dev
```

### Secrets & Environment Variables

**IMPORTANT**: Never add sensitive values like `GITHUB_TOKEN` or `OPENAI_API_KEY` to `wrangler.jsonc` under the `[vars]` section. These values are not encrypted and can be accidentally committed to source control.

For **local development**, create a `.dev.vars` file (already in `.gitignore`):

```bash
GITHUB_TOKEN=your_github_token
OPENAI_API_KEY=your_openai_key
```

For **production deployment**, use Cloudflare's encrypted secrets via Wrangler CLI:

```bash
wrangler secret put GITHUB_TOKEN
wrangler secret put OPENAI_API_KEY
```

These secrets will be securely stored and available on the `env` object in your Worker (e.g., `c.env.GITHUB_TOKEN`).

### Deploy

```bash
wrangler deploy
```

### Durable Objects

The Worker uses a `CodeResearchAgent` Durable Object binding (`CODE_RESEARCH_AGENT`) for agent state.

## Development

### Generated Worker Types

Use Wrangler to generate types for your Worker bindings and runtime APIs:
```bash
npm run types
```

This uses `.dev.vars` to pick up secrets for type generation and writes `worker-configuration.d.ts`.

### Error Handling

The server implements robust error handling:
- API-specific error messages for each platform
- Rate limit handling for GitHub API
- Graceful fallbacks for service unavailability
- Cached responses to reduce API load

### Caching

Results are cached in memory for the life of a Worker instance:
- Default TTL: 1 hour
- Separate cache keys per query/limit combination
- Platform-specific caching strategies
- Memory-efficient storage

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

AGPLv3
