// PawnButler Memory Tools - Agent-facing tools for memory operations

import type { ToolDefinition } from './tool-registry.js';
import type { MemoryManager } from '../memory/memory-manager.js';

/**
 * Create memory_search tool that queries the memory system.
 */
export function createMemorySearchTool(
  memoryManager: MemoryManager
): ToolDefinition {
  return {
    name: 'memory_search',
    description:
      'Search through stored memories using semantic similarity, keyword matching, or hybrid search',
    safetyLevel: 'safe',
    requiredRole: ['butler', 'researcher', 'executor'],
    validateParams: (params) => {
      if (!params.query || typeof params.query !== 'string') {
        return { valid: false, error: 'Parameter "query" is required and must be a string' };
      }
      if (params.method && !['semantic', 'keyword', 'hybrid'].includes(params.method as string)) {
        return {
          valid: false,
          error: 'Parameter "method" must be "semantic", "keyword", or "hybrid"',
        };
      }
      if (params.topK !== undefined && (typeof params.topK !== 'number' || params.topK < 1)) {
        return { valid: false, error: 'Parameter "topK" must be a positive number' };
      }
      return { valid: true };
    },
    execute: async (params) => {
      const query = params.query as string;
      const method = (params.method as string) ?? 'hybrid';
      const topK = (params.topK as number) ?? undefined;

      let results;
      if (method === 'semantic') {
        results = await memoryManager.semanticSearch(query, topK);
      } else if (method === 'keyword') {
        results = memoryManager.keywordSearch(query, topK);
      } else {
        results = await memoryManager.hybridSearch(query, topK);
      }

      return {
        query,
        method,
        results: results.map((r) => ({
          id: r.entry.id,
          content: r.entry.content,
          score: r.score,
          matchType: r.matchType,
          metadata: r.entry.metadata,
          createdAt: r.entry.createdAt,
        })),
        totalResults: results.length,
      };
    },
  };
}

/**
 * Create memory_get tool that retrieves a specific memory entry by id.
 */
export function createMemoryGetTool(
  memoryManager: MemoryManager
): ToolDefinition {
  return {
    name: 'memory_get',
    description: 'Retrieve a specific memory entry by its ID',
    safetyLevel: 'safe',
    requiredRole: ['butler', 'researcher', 'executor'],
    validateParams: (params) => {
      if (!params.id || typeof params.id !== 'string') {
        return { valid: false, error: 'Parameter "id" is required and must be a string' };
      }
      return { valid: true };
    },
    execute: async (params) => {
      const id = params.id as string;
      const entry = memoryManager.get(id);
      if (!entry) {
        return { found: false, id, message: `Memory entry "${id}" not found` };
      }
      return {
        found: true,
        id: entry.id,
        content: entry.content,
        metadata: entry.metadata,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      };
    },
  };
}

/**
 * Create memory_save tool that stores information in memory.
 */
export function createMemorySaveTool(
  memoryManager: MemoryManager
): ToolDefinition {
  return {
    name: 'memory_save',
    description: 'Save important information to long-term memory for future retrieval',
    safetyLevel: 'safe',
    requiredRole: ['butler', 'researcher', 'executor'],
    validateParams: (params) => {
      if (!params.content || typeof params.content !== 'string') {
        return {
          valid: false,
          error: 'Parameter "content" is required and must be a string',
        };
      }
      if (!params.source || typeof params.source !== 'string') {
        return {
          valid: false,
          error: 'Parameter "source" is required and must be a string',
        };
      }
      return { valid: true };
    },
    execute: async (params) => {
      const content = params.content as string;
      const source = params.source as string;
      const tags = (params.tags as string[]) ?? [];
      const type = (params.type as string) ?? 'note';

      const entries = await memoryManager.save(content, {
        source,
        agentId: (params.agentId as string) ?? undefined,
        sessionId: (params.sessionId as string) ?? undefined,
        tags,
        type: type as 'conversation' | 'fact' | 'task' | 'note',
      });

      return {
        saved: entries.length,
        ids: entries.map((e) => e.id),
        message: `Saved ${entries.length} memory entries`,
      };
    },
  };
}
