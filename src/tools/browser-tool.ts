// PawnButler Browser Tools - Agent-facing browser automation tools

import type { ToolDefinition } from './tool-registry.js';
import { BrowserManager } from '../browser/browser-manager.js';
import * as pageActions from '../browser/page-actions.js';
import { UrlAllowlist } from '../safety/url-allowlist.js';
import type { BrowserConfig } from '../browser/types.js';

let _manager: BrowserManager | null = null;

/**
 * Get or create the shared BrowserManager instance.
 */
export function getBrowserManager(
  config?: Partial<BrowserConfig>,
  urlAllowlist?: UrlAllowlist,
): BrowserManager {
  if (!_manager) {
    _manager = new BrowserManager(config, urlAllowlist);
  }
  return _manager;
}

/**
 * Set a custom BrowserManager (useful for testing).
 */
export function setBrowserManager(manager: BrowserManager | null): void {
  _manager = manager;
}

export const browserNavigateTool: ToolDefinition = {
  name: 'browser_navigate',
  description: 'Navigate the browser to a URL. Subject to URL allowlist enforcement.',
  safetyLevel: 'moderate',
  requiredRole: ['researcher', 'butler'],
  validateParams: (params) => {
    if (!params.url || typeof params.url !== 'string') {
      return { valid: false, error: 'Parameter "url" is required and must be a string' };
    }
    try {
      new URL(params.url as string);
    } catch {
      return { valid: false, error: `Invalid URL: ${params.url}` };
    }
    return { valid: true };
  },
  execute: async (params) => {
    const manager = getBrowserManager();
    return pageActions.navigate(manager, params.url as string);
  },
};

export const browserClickTool: ToolDefinition = {
  name: 'browser_click',
  description: 'Click an element on the current page using a CSS selector.',
  safetyLevel: 'moderate',
  requiredRole: ['researcher', 'butler'],
  validateParams: (params) => {
    if (!params.selector || typeof params.selector !== 'string') {
      return { valid: false, error: 'Parameter "selector" is required and must be a string' };
    }
    return { valid: true };
  },
  execute: async (params) => {
    const manager = getBrowserManager();
    return pageActions.click(manager, params.selector as string);
  },
};

export const browserTypeTool: ToolDefinition = {
  name: 'browser_type',
  description: 'Type text into an input element on the current page.',
  safetyLevel: 'moderate',
  requiredRole: ['researcher', 'butler'],
  validateParams: (params) => {
    if (!params.selector || typeof params.selector !== 'string') {
      return { valid: false, error: 'Parameter "selector" is required and must be a string' };
    }
    if (params.text === undefined || typeof params.text !== 'string') {
      return { valid: false, error: 'Parameter "text" is required and must be a string' };
    }
    return { valid: true };
  },
  execute: async (params) => {
    const manager = getBrowserManager();
    return pageActions.type(
      manager,
      params.selector as string,
      params.text as string,
    );
  },
};

export const browserScreenshotTool: ToolDefinition = {
  name: 'browser_screenshot',
  description: 'Take a screenshot of the current browser page. Returns base64 PNG.',
  safetyLevel: 'safe',
  requiredRole: ['researcher', 'butler'],
  validateParams: () => ({ valid: true }),
  execute: async () => {
    const manager = getBrowserManager();
    return pageActions.screenshot(manager);
  },
};

export const browserExtractTool: ToolDefinition = {
  name: 'browser_extract',
  description: 'Extract text content and links from the current page.',
  safetyLevel: 'safe',
  requiredRole: ['researcher', 'butler'],
  validateParams: () => ({ valid: true }),
  execute: async () => {
    const manager = getBrowserManager();
    return pageActions.extract(manager);
  },
};

export const browserEvaluateTool: ToolDefinition = {
  name: 'browser_evaluate',
  description: 'Evaluate a JavaScript expression on the current page. Restricted: no cookies, storage, network, or dynamic code execution.',
  safetyLevel: 'moderate',
  requiredRole: ['researcher', 'butler'],
  validateParams: (params) => {
    if (!params.script || typeof params.script !== 'string') {
      return { valid: false, error: 'Parameter "script" is required and must be a string' };
    }
    return { valid: true };
  },
  execute: async (params) => {
    const manager = getBrowserManager();
    return pageActions.evaluate(manager, params.script as string);
  },
};

/**
 * All browser tool definitions.
 */
export const browserTools: ToolDefinition[] = [
  browserNavigateTool,
  browserClickTool,
  browserTypeTool,
  browserScreenshotTool,
  browserExtractTool,
  browserEvaluateTool,
];
