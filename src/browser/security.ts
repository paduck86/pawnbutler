// PawnButler Browser Security - URL enforcement, download/popup blocking

import type { Page, BrowserContext } from 'playwright-core';
import { UrlAllowlist } from '../safety/url-allowlist.js';
import type { BrowserActionLog } from './types.js';

export class BrowserSecurity {
  private urlAllowlist: UrlAllowlist;
  private logs: BrowserActionLog[] = [];

  constructor(urlAllowlist: UrlAllowlist) {
    this.urlAllowlist = urlAllowlist;
  }

  // Patterns forbidden in evaluate() scripts
  private static readonly FORBIDDEN_SCRIPT_PATTERNS: RegExp[] = [
    /document\.cookie/i,
    /localStorage/i,
    /sessionStorage/i,
    /indexedDB/i,
    /window\.open/i,
    /fetch\s*\(/i,
    /XMLHttpRequest/i,
    /navigator\.sendBeacon/i,
    /WebSocket/i,
    /eval\s*\(/i,
    /Function\s*\(/i,
    /import\s*\(/i,
  ];

  /**
   * Check if a URL is allowed for navigation.
   */
  checkUrl(url: string): { allowed: boolean; reason?: string } {
    return this.urlAllowlist.isAllowed(url);
  }

  /**
   * Validate a JavaScript expression for safe evaluate().
   * Blocks access to cookies, storage, network, and dynamic code execution.
   */
  validateScript(script: string): { allowed: boolean; reason?: string } {
    for (const pattern of BrowserSecurity.FORBIDDEN_SCRIPT_PATTERNS) {
      if (pattern.test(script)) {
        return {
          allowed: false,
          reason: `Script contains forbidden pattern: ${pattern.source}`,
        };
      }
    }
    return { allowed: true };
  }

  /**
   * Apply security policies to a browser context:
   * - Block downloads
   * - Block popups
   * - Cookie/session isolation (contexts are already isolated)
   */
  async applyContextPolicy(context: BrowserContext): Promise<void> {
    // Block popups by denying new page creation from scripts
    context.on('page', async (page: Page) => {
      // Popup pages opened by scripts get closed immediately
      const opener = await page.opener();
      if (opener) {
        this.log('popup_blocked', undefined, undefined, page.url());
        await page.close();
      }
    });
  }

  /**
   * Apply page-level security:
   * - Intercept navigation requests for URL allowlist
   * - Block download requests
   */
  async applyPagePolicy(page: Page): Promise<void> {
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = request.url();
      const resourceType = request.resourceType();

      // Block download-like resources
      if (resourceType === 'media' || resourceType === 'other') {
        const contentDisposition = request.headers()['content-disposition'];
        if (contentDisposition && contentDisposition.includes('attachment')) {
          this.log('download_blocked', url);
          await route.abort('blockedbyclient');
          return;
        }
      }

      // For navigation requests, enforce URL allowlist
      if (request.isNavigationRequest()) {
        const check = this.checkUrl(url);
        if (!check.allowed) {
          this.log('navigation_blocked', url, undefined, check.reason);
          await route.abort('blockedbyclient');
          return;
        }
      }

      await route.continue();
    });

    // Block file downloads
    page.on('download', (download) => {
      this.log('download_blocked', download.url());
      download.cancel();
    });
  }

  log(action: string, url?: string, selector?: string, details?: string): void {
    this.logs.push({
      timestamp: Date.now(),
      action,
      url,
      selector,
      details,
    });
  }

  getLogs(): BrowserActionLog[] {
    return [...this.logs];
  }

  clearLogs(): void {
    this.logs = [];
  }
}
