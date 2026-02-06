// PawnButler Browser Manager - Playwright chromium lifecycle, page pool, auto-cleanup

import { chromium } from 'playwright-core';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { v4 as uuidv4 } from 'uuid';
import type { BrowserConfig, PageInfo } from './types.js';
import { DEFAULT_BROWSER_CONFIG } from './types.js';
import { BrowserSecurity } from './security.js';
import { UrlAllowlist } from '../safety/url-allowlist.js';

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pages: Map<string, Page> = new Map();
  private pageInfo: Map<string, PageInfo> = new Map();
  private config: BrowserConfig;
  private security: BrowserSecurity;
  private activePageId: string | null = null;

  constructor(
    config: Partial<BrowserConfig> = {},
    urlAllowlist?: UrlAllowlist,
  ) {
    this.config = { ...DEFAULT_BROWSER_CONFIG, ...config };
    this.security = new BrowserSecurity(
      urlAllowlist ?? new UrlAllowlist(),
    );
  }

  getSecurity(): BrowserSecurity {
    return this.security;
  }

  async launch(): Promise<void> {
    if (this.browser) return;

    this.browser = await chromium.launch({
      headless: this.config.headless,
    });

    this.context = await this.browser.newContext({
      acceptDownloads: false,
    });

    await this.security.applyContextPolicy(this.context);
  }

  async newPage(): Promise<{ id: string; page: Page }> {
    if (!this.context) {
      await this.launch();
    }

    // Enforce max pages limit
    if (this.pages.size >= this.config.maxPages) {
      // Close the oldest page
      const oldest = [...this.pageInfo.entries()].sort(
        (a, b) => a[1].createdAt - b[1].createdAt,
      )[0];
      if (oldest) {
        await this.closePage(oldest[0]);
      }
    }

    const page = await this.context!.newPage();
    const id = uuidv4();

    await this.security.applyPagePolicy(page);

    this.pages.set(id, page);
    this.pageInfo.set(id, {
      id,
      url: 'about:blank',
      title: '',
      createdAt: Date.now(),
    });
    this.activePageId = id;

    // Auto-cleanup on page close
    page.on('close', () => {
      this.pages.delete(id);
      this.pageInfo.delete(id);
      if (this.activePageId === id) {
        this.activePageId = this.pages.size > 0
          ? [...this.pages.keys()][this.pages.size - 1]
          : null;
      }
    });

    return { id, page };
  }

  getActivePage(): { id: string; page: Page } | null {
    if (!this.activePageId) return null;
    const page = this.pages.get(this.activePageId);
    if (!page) return null;
    return { id: this.activePageId, page };
  }

  getPage(id: string): Page | undefined {
    return this.pages.get(id);
  }

  setActivePage(id: string): boolean {
    if (!this.pages.has(id)) return false;
    this.activePageId = id;
    return true;
  }

  listPages(): PageInfo[] {
    return [...this.pageInfo.values()];
  }

  async closePage(id: string): Promise<boolean> {
    const page = this.pages.get(id);
    if (!page) return false;
    await page.close();
    return true;
  }

  updatePageInfo(id: string, url: string, title: string): void {
    const info = this.pageInfo.get(id);
    if (info) {
      info.url = url;
      info.title = title;
    }
  }

  isLaunched(): boolean {
    return this.browser !== null;
  }

  async shutdown(): Promise<void> {
    for (const [id] of this.pages) {
      await this.closePage(id);
    }
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this.pages.clear();
    this.pageInfo.clear();
    this.activePageId = null;
  }
}
