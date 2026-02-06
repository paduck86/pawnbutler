// PawnButler Page Actions - All browser page interactions

import type { Page } from 'playwright-core';
import type { BrowserManager } from './browser-manager.js';
import type {
  NavigateResult,
  ClickResult,
  TypeResult,
  ScrollResult,
  ScreenshotResult,
  ExtractResult,
  SnapshotResult,
  EvaluateResult,
  WaitForResult,
} from './types.js';

/**
 * Get the active page or throw.
 */
function requireActivePage(manager: BrowserManager): { id: string; page: Page } {
  const active = manager.getActivePage();
  if (!active) {
    throw new Error('No active browser page. Call browser_navigate first.');
  }
  return active;
}

/**
 * Navigate to a URL. Enforces URL allowlist via BrowserSecurity.
 */
export async function navigate(
  manager: BrowserManager,
  url: string,
): Promise<NavigateResult> {
  // Pre-check URL allowlist before even navigating
  const security = manager.getSecurity();
  const check = security.checkUrl(url);
  if (!check.allowed) {
    throw new Error(`Navigation blocked: ${check.reason}`);
  }

  // Create a new page if none exists
  let active = manager.getActivePage();
  if (!active) {
    active = await manager.newPage();
  }

  security.log('navigate', url);

  const response = await active.page.goto(url, {
    waitUntil: 'domcontentloaded',
  });

  const title = await active.page.title();
  const status = response?.status() ?? null;

  manager.updatePageInfo(active.id, url, title);

  return { url, title, status };
}

/**
 * Click an element matching a CSS selector.
 */
export async function click(
  manager: BrowserManager,
  selector: string,
): Promise<ClickResult> {
  const { page } = requireActivePage(manager);
  const security = manager.getSecurity();
  security.log('click', page.url(), selector);

  await page.click(selector);
  return { selector, clicked: true };
}

/**
 * Type text into an element matching a CSS selector.
 */
export async function type(
  manager: BrowserManager,
  selector: string,
  text: string,
): Promise<TypeResult> {
  const { page } = requireActivePage(manager);
  const security = manager.getSecurity();
  security.log('type', page.url(), selector);

  await page.fill(selector, text);
  return { selector, typed: true };
}

/**
 * Scroll the page up or down.
 */
export async function scroll(
  manager: BrowserManager,
  direction: 'up' | 'down',
): Promise<ScrollResult> {
  const { page } = requireActivePage(manager);
  const security = manager.getSecurity();
  security.log('scroll', page.url(), undefined, direction);

  const delta = direction === 'down' ? 500 : -500;
  await page.mouse.wheel(0, delta);
  return { direction, scrolled: true };
}

/**
 * Take a screenshot of the current page.
 */
export async function screenshot(
  manager: BrowserManager,
): Promise<ScreenshotResult> {
  const { page } = requireActivePage(manager);
  const security = manager.getSecurity();
  security.log('screenshot', page.url());

  const buffer = await page.screenshot({ type: 'png', fullPage: false });
  const base64 = buffer.toString('base64');

  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };

  return {
    base64,
    width: viewport.width,
    height: viewport.height,
  };
}

/**
 * Extract text content and links from the current page.
 */
export async function extract(
  manager: BrowserManager,
): Promise<ExtractResult> {
  const { page } = requireActivePage(manager);
  const security = manager.getSecurity();
  security.log('extract', page.url());

  const title = await page.title();
  const url = page.url();

  const text = await page.evaluate(() => {
    return document.body?.innerText ?? '';
  });

  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href]')).map((a) => ({
      text: (a as HTMLAnchorElement).innerText.trim().slice(0, 100),
      href: (a as HTMLAnchorElement).href,
    }));
  });

  return { title, url, text, links };
}

/**
 * Create an AI-friendly summary/snapshot of the current page.
 */
export async function snapshot(
  manager: BrowserManager,
): Promise<SnapshotResult> {
  const { page } = requireActivePage(manager);
  const security = manager.getSecurity();
  security.log('snapshot', page.url());

  const title = await page.title();
  const url = page.url();

  const headings = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('h1, h2, h3')).map(
      (el) => el.textContent?.trim() ?? '',
    ).filter(Boolean);
  });

  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href]'))
      .slice(0, 50)
      .map((a) => ({
        text: (a as HTMLAnchorElement).innerText.trim().slice(0, 80),
        href: (a as HTMLAnchorElement).href,
      }));
  });

  const forms = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('form')).map((form) => ({
      action: (form as HTMLFormElement).action,
      fields: Array.from(form.querySelectorAll('input, select, textarea')).map(
        (el) =>
          (el as HTMLInputElement).name ||
          (el as HTMLInputElement).id ||
          (el as HTMLInputElement).type,
      ),
    }));
  });

  const bodyText = await page.evaluate(() => {
    return (document.body?.innerText ?? '').slice(0, 500);
  });

  return {
    title,
    url,
    summary: bodyText,
    headings,
    links,
    forms,
  };
}

/**
 * Evaluate a JavaScript expression on the current page (restricted).
 * Forbidden patterns (cookies, storage, network, eval) are blocked.
 */
export async function evaluate(
  manager: BrowserManager,
  script: string,
): Promise<EvaluateResult> {
  const { page } = requireActivePage(manager);
  const security = manager.getSecurity();

  // Security: validate script before execution
  const check = security.validateScript(script);
  if (!check.allowed) {
    throw new Error(`Script blocked: ${check.reason}`);
  }

  security.log('evaluate', page.url(), undefined, script.slice(0, 200));

  const result = await page.evaluate(script);
  return { script, result };
}

/**
 * Wait for an element matching a CSS selector to appear.
 */
export async function waitFor(
  manager: BrowserManager,
  selector: string,
  timeout: number = 10_000,
): Promise<WaitForResult> {
  const { page } = requireActivePage(manager);
  const security = manager.getSecurity();
  security.log('waitFor', page.url(), selector);

  const start = Date.now();
  try {
    await page.waitForSelector(selector, { timeout });
    return { selector, found: true, elapsed: Date.now() - start };
  } catch {
    return { selector, found: false, elapsed: Date.now() - start };
  }
}
