import type { ToolDefinition } from './tool-registry.js';
import { DockerSandbox } from '../sandbox/docker-sandbox.js';
import type { SandboxConfig } from '../sandbox/sandbox-config.js';
import { DEFAULT_SANDBOX_CONFIG } from '../sandbox/sandbox-config.js';
import { browserTools } from './browser-tool.js';
import { cronTools } from './cron-tool.js';
import type { MemoryManager } from '../memory/memory-manager.js';
import { createMemorySearchTool, createMemoryGetTool, createMemorySaveTool } from './memory-tool.js';
import { executeWebSearch } from './web-search-impl.js';
import { executeWebFetch } from './web-fetch-impl.js';
import { executeReadFile, executeWriteFile, executeEditFile } from './file-ops-impl.js';
import { executeCommand } from './exec-impl.js';
import { ActionClassifier } from '../safety/action-classifier.js';
import { defaultConfig } from '../config/default-config.js';

let _sandbox: DockerSandbox | null = null;
let _sandboxAvailable: boolean | null = null;

/**
 * Get or create the shared DockerSandbox instance.
 * Returns null if Docker is not available.
 */
async function getSandbox(config?: Partial<SandboxConfig>): Promise<DockerSandbox | null> {
  if (_sandboxAvailable === false) return null;

  if (!_sandbox) {
    _sandbox = new DockerSandbox(config ?? DEFAULT_SANDBOX_CONFIG);
    _sandboxAvailable = await _sandbox.isAvailable();
    if (!_sandboxAvailable) {
      _sandbox = null;
      return null;
    }
  }

  return _sandbox;
}

// Shared classifier for exec_command
const _classifier = new ActionClassifier(defaultConfig.safety);

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web for information using a query string',
  safetyLevel: 'safe',
  requiredRole: ['researcher', 'butler'],
  validateParams: (params) => {
    if (!params.query || typeof params.query !== 'string') {
      return { valid: false, error: 'Parameter "query" is required and must be a string' };
    }
    if ((params.query as string).length === 0) {
      return { valid: false, error: 'Parameter "query" must not be empty' };
    }
    return { valid: true };
  },
  execute: async (params) => {
    const count = typeof params.count === 'number' ? params.count : 5;
    return executeWebSearch(params.query as string, count);
  },
};

export const webFetchTool: ToolDefinition = {
  name: 'web_fetch',
  description: 'Fetch content from a URL (subject to URL allowlist)',
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
    return executeWebFetch(params.url as string);
  },
};

export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file from the local filesystem',
  safetyLevel: 'safe',
  requiredRole: ['researcher', 'executor', 'butler'],
  validateParams: (params) => {
    if (!params.path || typeof params.path !== 'string') {
      return { valid: false, error: 'Parameter "path" is required and must be a string' };
    }
    return { valid: true };
  },
  execute: async (params) => {
    return executeReadFile(
      params.path as string,
      params.workspaceRoot as string | undefined,
    );
  },
};

export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description: 'Write content to a file on the local filesystem',
  safetyLevel: 'moderate',
  requiredRole: ['executor', 'butler'],
  validateParams: (params) => {
    if (!params.path || typeof params.path !== 'string') {
      return { valid: false, error: 'Parameter "path" is required and must be a string' };
    }
    if (params.content === undefined || params.content === null) {
      return { valid: false, error: 'Parameter "content" is required' };
    }
    return { valid: true };
  },
  execute: async (params) => {
    return executeWriteFile(
      params.path as string,
      String(params.content),
      undefined, // vault injected at higher level
      params.workspaceRoot as string | undefined,
    );
  },
};

export const editFileTool: ToolDefinition = {
  name: 'edit_file',
  description: 'Edit an existing file with specified changes',
  safetyLevel: 'moderate',
  requiredRole: ['executor', 'butler'],
  validateParams: (params) => {
    if (!params.path || typeof params.path !== 'string') {
      return { valid: false, error: 'Parameter "path" is required and must be a string' };
    }
    if (!params.edits || !Array.isArray(params.edits)) {
      return { valid: false, error: 'Parameter "edits" is required and must be an array' };
    }
    return { valid: true };
  },
  execute: async (params) => {
    return executeEditFile(
      params.path as string,
      params.edits as Array<{ old_string: string; new_string: string }>,
      params.workspaceRoot as string | undefined,
    );
  },
};

export const execCommandTool: ToolDefinition = {
  name: 'exec_command',
  description:
    'Execute a shell command. DANGEROUS: Always requires butler approval.',
  safetyLevel: 'dangerous',
  requiredRole: ['executor'],
  validateParams: (params) => {
    if (!params.command || typeof params.command !== 'string') {
      return { valid: false, error: 'Parameter "command" is required and must be a string' };
    }
    if ((params.command as string).trim().length === 0) {
      return { valid: false, error: 'Parameter "command" must not be empty' };
    }
    return { valid: true };
  },
  execute: async (params) => {
    return executeCommand(params.command as string, _classifier, {
      timeout: (params.timeout as number) ?? undefined,
      workdir: (params.workdir as string) ?? undefined,
    });
  },
};

/**
 * All built-in tools. Register these with the ToolRegistry.
 */
export const builtinTools: ToolDefinition[] = [
  webSearchTool,
  webFetchTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  execCommandTool,
  ...browserTools,
  ...cronTools,
];

/**
 * Register all built-in tools with a ToolRegistry instance.
 */
export function registerBuiltinTools(
  registry: import('./tool-registry.js').ToolRegistry
): void {
  for (const tool of builtinTools) {
    registry.register(tool);
  }
}

/**
 * Register memory tools with a ToolRegistry instance.
 * Requires a MemoryManager instance to be passed in.
 */
export function registerMemoryTools(
  registry: import('./tool-registry.js').ToolRegistry,
  memoryManager: MemoryManager
): void {
  registry.register(createMemorySearchTool(memoryManager));
  registry.register(createMemoryGetTool(memoryManager));
  registry.register(createMemorySaveTool(memoryManager));
}
