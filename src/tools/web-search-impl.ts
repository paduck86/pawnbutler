// PawnButler Web Search Implementation - Brave Search API with DuckDuckGo fallback

import { toolEvents } from './tool-events.js';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  query: string;
  results: SearchResult[];
  source: 'brave' | 'duckduckgo';
  totalResults: number;
}

const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';
const DDG_HTML_URL = 'https://html.duckduckgo.com/html/';

/**
 * Search via Brave Search API.
 */
async function searchBrave(
  query: string,
  apiKey: string,
  count: number,
): Promise<WebSearchResponse> {
  const url = new URL(BRAVE_SEARCH_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(count));

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Brave Search API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
      }>;
    };
  };

  const results: SearchResult[] = (data.web?.results ?? []).slice(0, count).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.description ?? '',
  }));

  return {
    query,
    results,
    source: 'brave',
    totalResults: results.length,
  };
}

/**
 * Fallback: scrape DuckDuckGo HTML search results.
 */
async function searchDuckDuckGo(
  query: string,
  count: number,
): Promise<WebSearchResponse> {
  const response = await fetch(DDG_HTML_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ q: query }).toString(),
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo search error: ${response.status}`);
  }

  const html = await response.text();
  const results = parseDdgHtml(html, count);

  return {
    query,
    results,
    source: 'duckduckgo',
    totalResults: results.length,
  };
}

/**
 * Parse DuckDuckGo HTML results with simple regex extraction.
 */
function parseDdgHtml(html: string, count: number): SearchResult[] {
  const results: SearchResult[] = [];
  // DuckDuckGo HTML results are in <a class="result__a" href="...">title</a>
  // and <a class="result__snippet">snippet</a>
  const resultPattern = /<a[^>]+class="result__a"[^>]+href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
  const snippetPattern = /<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/gi;

  const titleMatches = [...html.matchAll(resultPattern)];
  const snippetMatches = [...html.matchAll(snippetPattern)];

  for (let i = 0; i < Math.min(titleMatches.length, count); i++) {
    const href = titleMatches[i][1] ?? '';
    const title = stripHtml(titleMatches[i][2] ?? '');
    const snippet = stripHtml(snippetMatches[i]?.[1] ?? '');

    // DuckDuckGo wraps URLs in a redirect, extract the actual URL
    let url = href;
    const uddgMatch = href.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      url = decodeURIComponent(uddgMatch[1]);
    }

    if (url && title) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
}

/**
 * Execute a web search. Uses Brave API if BRAVE_API_KEY is set, falls back to DuckDuckGo.
 */
export async function executeWebSearch(
  query: string,
  count: number = 5,
): Promise<WebSearchResponse> {
  const start = Date.now();
  toolEvents.emitStart('web_search', { query, count });

  try {
    const apiKey = process.env.BRAVE_API_KEY;
    let result: WebSearchResponse;

    if (apiKey) {
      result = await searchBrave(query, apiKey, count);
    } else {
      result = await searchDuckDuckGo(query, count);
    }

    toolEvents.emitComplete('web_search', {
      query,
      source: result.source,
      resultCount: result.totalResults,
    }, Date.now() - start);

    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    toolEvents.emitError('web_search', error, Date.now() - start);
    throw err;
  }
}
