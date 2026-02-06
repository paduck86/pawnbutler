// PawnButler Web Fetch Implementation - URL content fetching with HTML parsing

import * as cheerio from 'cheerio';
import { UrlAllowlist } from '../safety/url-allowlist.js';
import { toolEvents } from './tool-events.js';

export interface WebFetchResponse {
  url: string;
  title: string;
  text: string;
  contentLength: number;
  truncated: boolean;
}

const MAX_CONTENT_SIZE = 50 * 1024; // 50KB
const FETCH_TIMEOUT = 15_000; // 15 seconds

/**
 * Fetch and parse web page content.
 * Enforces URL allowlist and content size limits.
 */
export async function executeWebFetch(
  url: string,
  urlAllowlist?: UrlAllowlist,
): Promise<WebFetchResponse> {
  const start = Date.now();
  toolEvents.emitStart('web_fetch', { url });

  try {
    // URL allowlist check
    if (urlAllowlist) {
      const check = urlAllowlist.isAllowed(url);
      if (!check.allowed) {
        throw new Error(`URL blocked: ${check.reason}`);
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'PawnButler/1.0 (AI Agent Web Fetcher)',
          'Accept': 'text/html, text/plain, application/json',
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') ?? '';

    // Read body with size limit
    const rawBody = await readBodyWithLimit(response, MAX_CONTENT_SIZE);
    const truncated = rawBody.truncated;

    let title = '';
    let text = '';

    if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
      const parsed = parseHtml(rawBody.text, url);
      title = parsed.title;
      text = parsed.text;
    } else if (contentType.includes('application/json')) {
      title = url;
      text = rawBody.text;
    } else {
      // Plain text or other
      title = url;
      text = rawBody.text;
    }

    const result: WebFetchResponse = {
      url,
      title,
      text,
      contentLength: rawBody.text.length,
      truncated,
    };

    toolEvents.emitComplete('web_fetch', {
      url,
      title,
      contentLength: result.contentLength,
      truncated,
    }, Date.now() - start);

    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    toolEvents.emitError('web_fetch', error, Date.now() - start);
    throw err;
  }
}

/**
 * Read response body up to a size limit.
 */
async function readBodyWithLimit(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) {
    return { text: '', truncated: false };
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      // Take only what we need from this chunk
      const overflow = totalBytes - maxBytes;
      const partialChunk = value.slice(0, value.byteLength - overflow);
      chunks.push(partialChunk);
      truncated = true;
      reader.cancel();
      break;
    }
    chunks.push(value);
  }

  const decoder = new TextDecoder('utf-8', { fatal: false });
  const allBytes = new Uint8Array(
    chunks.reduce((acc, c) => acc + c.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    allBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { text: decoder.decode(allBytes), truncated };
}

/**
 * Parse HTML using cheerio to extract title and readable text.
 */
function parseHtml(html: string, url: string): { title: string; text: string } {
  const $ = cheerio.load(html);

  // Remove non-content elements
  $('script, style, nav, footer, header, aside, iframe, noscript').remove();

  const title = $('title').first().text().trim() || url;

  // Try article/main content first (Readability-like)
  let text = '';
  const contentSelectors = ['article', 'main', '[role="main"]', '.content', '#content', '.post-content', '.entry-content'];

  for (const selector of contentSelectors) {
    const el = $(selector).first();
    if (el.length > 0) {
      text = el.text().trim();
      break;
    }
  }

  // Fallback to body text
  if (!text) {
    text = $('body').text().trim();
  }

  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n').trim();

  return { title, text };
}
