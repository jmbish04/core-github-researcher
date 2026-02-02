import * as cheerio from 'cheerio';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

type CacheEntry = {
  expiresAt: number;
  value: string;
};

// Cache entries persist only for the active worker instance.
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000;

const userAgent = 'Mozilla/5.0 (compatible; CodeResearchBot/1.0)';

const getCachedValue = (key: string) => {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
};

const setCachedValue = (key: string, value: string) => {
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
};

const fetchJson = async <T>(input: RequestInfo, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
};

export type ProvidersEnv = {
  GITHUB_TOKEN?: string;
};

export const searchStackOverflow = async (query: string, limit = 5): Promise<string> => {
  const cacheKey = `stackoverflow:${query}:${limit}`;
  const cached = getCachedValue(cacheKey);
  if (cached) return cached;

  try {
    const url = new URL('https://api.stackexchange.com/2.3/search/advanced');
    url.searchParams.set('q', query);
    url.searchParams.set('site', 'stackoverflow');
    url.searchParams.set('pagesize', limit.toString());
    url.searchParams.set('order', 'desc');
    url.searchParams.set('sort', 'votes');
    url.searchParams.set('filter', 'withbody');

    const data = await fetchJson<{ items: Array<{ title: string; link: string; score: number; answer_count: number; body: string }> }>(url.toString(), {
      headers: { 'User-Agent': userAgent },
    });

    const results = data.items.map((item) => {
      const $ = cheerio.load(item.body);
      return {
        title: item.title,
        link: item.link,
        score: item.score,
        answer_count: item.answer_count,
        excerpt: `${$.text().substring(0, 200)}...`,
      };
    });

    const formatted = results
      .map(
        (result, index) =>
          `${index + 1}. ${result.title}\n   Score: ${result.score} | Answers: ${result.answer_count}\n   ${result.link}\n   ${result.excerpt}\n`
      )
      .join('\n');

    setCachedValue(cacheKey, formatted);
    return formatted;
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Stack Overflow API error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

export const searchMDN = async (query: string): Promise<string> => {
  const cacheKey = `mdn:${query}`;
  const cached = getCachedValue(cacheKey);
  if (cached) return cached;

  try {
    const url = new URL('https://developer.mozilla.org/api/v1/search');
    url.searchParams.set('q', query);
    url.searchParams.set('locale', 'en-US');

    const data = await fetchJson<{ documents: Array<{ title: string; summary: string; mdn_url: string }> }>(url.toString(), {
      headers: { 'User-Agent': userAgent },
    });

    const results = data.documents
      .slice(0, 5)
      .map(
        (doc, index) =>
          `${index + 1}. ${doc.title}\n   ${doc.summary}\n   https://developer.mozilla.org${doc.mdn_url}\n`
      )
      .join('\n');

    setCachedValue(cacheKey, results);
    return results;
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `MDN API error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

export const searchGitHub = async (
  env: ProvidersEnv,
  query: string,
  language?: string,
  limit = 5
): Promise<string> => {
  const cacheKey = `github:${query}:${language ?? 'all'}:${limit}`;
  const cached = getCachedValue(cacheKey);
  if (cached) return cached;

  const q = language ? `${query} language:${language}` : query;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'CodeResearchBot/1.0',
  };
  if (env.GITHUB_TOKEN) {
    headers.Authorization = `token ${env.GITHUB_TOKEN}`;
  }

  const makeRequest = async <T>(endpoint: string, params: Record<string, string>) => {
    const url = new URL(`https://api.github.com${endpoint}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await fetch(url.toString(), { headers });
    if (response.status === 401 && env.GITHUB_TOKEN) {
      const fallback = await fetch(url.toString(), {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'CodeResearchBot/1.0',
        },
      });
      if (!fallback.ok) {
        throw new Error(`Request failed with status ${fallback.status}`);
      }
      return (await fallback.json()) as T;
    }
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    return (await response.json()) as T;
  };

  try {
    const [reposResponse, codeResponse] = await Promise.all([
      makeRequest<{ items: Array<{ full_name: string; stargazers_count: number; description: string | null; html_url: string }> }>(
        '/search/repositories',
        { q, sort: 'stars', order: 'desc', per_page: limit.toString() }
      ),
      makeRequest<{ items: Array<{ name: string; repository: { full_name: string }; path: string; html_url: string }> }>(
        '/search/code',
        { q, sort: 'indexed', order: 'desc', per_page: limit.toString() }
      ),
    ]);

    let result = '=== Top Repositories ===\n';
    result += reposResponse.items
      .map(
        (repo, index) =>
          `${index + 1}. ${repo.full_name} (⭐ ${repo.stargazers_count})\n   ${repo.description || 'No description'}\n   ${repo.html_url}\n`
      )
      .join('\n');

    result += '\n=== Relevant Code ===\n';
    result += codeResponse.items
      .map(
        (item, index) =>
          `${index + 1}. ${item.name} (${item.repository.full_name})\n   Path: ${item.path}\n   ${item.html_url}\n`
      )
      .join('\n');

    setCachedValue(cacheKey, result);
    return result;
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `GitHub API error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

export const searchNpm = async (query: string, limit = 5): Promise<string> => {
  const cacheKey = `npm:${query}:${limit}`;
  const cached = getCachedValue(cacheKey);
  if (cached) return cached;

  try {
    const url = new URL('https://registry.npmjs.org/-/v1/search');
    url.searchParams.set('text', query);
    url.searchParams.set('size', limit.toString());

    const data = await fetchJson<{ objects: Array<{ package: { name: string; version: string; description?: string; downloads: number; links: { npm: string } } }> }>(
      url.toString(),
      { headers: { 'User-Agent': userAgent } }
    );

    const results = data.objects
      .map((item, index) => {
        const pkg = item.package;
        return `${index + 1}. ${pkg.name} (v${pkg.version})\n   ${pkg.description || 'No description'}\n   Weekly Downloads: ${pkg.downloads}\n   ${pkg.links.npm}\n`;
      })
      .join('\n');

    setCachedValue(cacheKey, results);
    return results;
  } catch (error) {
    throw new McpError(ErrorCode.InternalError, `npm API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

export const searchPyPI = async (query: string): Promise<string> => {
  const cacheKey = `pypi:${query}`;
  const cached = getCachedValue(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://pypi.org/pypi/${encodeURIComponent(query)}/json`;
    const response = await fetch(url, { headers: { 'User-Agent': userAgent } });
    if (response.status === 404) {
      return `No package found for "${query}"`;
    }
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    const data = (await response.json()) as { info: { name: string; version: string; summary?: string; author?: string; home_page?: string; project_url?: string } };
    const pkg = data.info;
    const result =
      `Package: ${pkg.name} (v${pkg.version})\n` +
      `Description: ${pkg.summary || 'No description'}\n` +
      `Author: ${pkg.author || 'Unknown'}\n` +
      `Homepage: ${pkg.home_page || pkg.project_url || 'N/A'}\n` +
      `PyPI: https://pypi.org/project/${pkg.name}/\n`;

    setCachedValue(cacheKey, result);
    return result;
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `PyPI API error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

export const searchAll = async (env: ProvidersEnv, query: string, limit = 3): Promise<string> => {
  const cacheKey = `all:${query}:${limit}`;
  const cached = getCachedValue(cacheKey);
  if (cached) return cached;

  try {
    const [so, mdn, npm, pypi] = await Promise.all([
      searchStackOverflow(query, limit).catch((error) => `Error: ${error instanceof Error ? error.message : 'Unknown error'}`),
      searchMDN(query).catch((error) => `Error: ${error instanceof Error ? error.message : 'Unknown error'}`),
      searchNpm(query, limit).catch((error) => `Error: ${error instanceof Error ? error.message : 'Unknown error'}`),
      searchPyPI(query).catch((error) => `Error: ${error instanceof Error ? error.message : 'Unknown error'}`),
    ]);

    let results = `=== Stack Overflow Results ===\n${so}\n\n` + `=== MDN Documentation ===\n${mdn}\n\n`;

    try {
      const gh = await searchGitHub(env, query, undefined, limit);
      results += `=== GitHub Results ===\n${gh}\n\n`;
    } catch (error) {
      results += `=== GitHub Results ===\nGitHub search failed: ${error instanceof Error ? error.message : 'Unknown error'}\n\n`;
    }

    results += `=== npm Packages ===\n${npm}\n\n` + `=== PyPI Packages ===\n${pypi}`;

    setCachedValue(cacheKey, results);
    return results;
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Search all platforms error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

export const cacheNote =
  'Results are cached in-memory using a Map. Cache entries persist only for the active worker instance.';
