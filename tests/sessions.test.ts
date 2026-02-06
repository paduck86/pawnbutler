import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SessionManager } from '../src/sessions/session-manager.js';
import { ContextPruner } from '../src/sessions/context-pruning.js';
import { AgentLoop } from '../src/agents/agent-loop.js';
import { getSystemPrompt, BUTLER_SYSTEM_PROMPT, RESEARCHER_SYSTEM_PROMPT, EXECUTOR_SYSTEM_PROMPT } from '../src/agents/system-prompts.js';
import { LLMManager } from '../src/llm/llm-manager.js';
import { LLMProvider } from '../src/llm/provider.js';
import { PawnButlerEngine } from '../src/core/engine.js';
import { ButlerAgent } from '../src/agents/butler.js';
import { ResearcherAgent } from '../src/agents/researcher.js';
import { ExecutorAgent } from '../src/agents/executor.js';
import { defaultConfig } from '../src/config/default-config.js';
import type {
  ActionRequest,
  PawnButlerConfig,
} from '../src/core/types.js';
import type {
  Session,
  SessionMessage,
  SessionConfig,
} from '../src/sessions/types.js';
import type {
  LLMConfig,
  LLMProviderName,
  LLMMessage,
  LLMRequestOptions,
  LLMResponse,
  StreamChunk,
  TokenUsage,
} from '../src/llm/types.js';

// ---------------------------------------------------------------------------
// Mock LLM Provider
// ---------------------------------------------------------------------------

class MockLLMProvider extends LLMProvider {
  readonly name: LLMProviderName = 'anthropic';
  readonly defaultModel = 'claude-sonnet-4-5-20250929';
  responses: LLMResponse[] = [];
  private callIndex = 0;

  async chat(messages: LLMMessage[], options?: LLMRequestOptions): Promise<LLMResponse> {
    const model = options?.model ?? this.defaultModel;
    this.emitRequest(model, messages.length);

    if (this.callIndex < this.responses.length) {
      const response = this.responses[this.callIndex++];
      this.emitUsage(model, response.usage, 50);
      return response;
    }

    const defaultResp: LLMResponse = {
      content: 'Default mock response',
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      model,
      provider: this.name,
      finishReason: 'stop',
    };
    this.emitUsage(model, defaultResp.usage, 50);
    return defaultResp;
  }

  async *stream(): AsyncGenerator<StreamChunk> {
    yield { type: 'text', content: 'streaming' };
    yield { type: 'done' };
  }

  reset(): void {
    this.callIndex = 0;
    this.responses = [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSessionConfig(tmpDir: string): SessionConfig {
  return {
    maxMessages: 100,
    contextWindow: 128000,
    pruningStrategy: 'sliding_window',
    storePath: tmpDir,
  };
}

function makeLLMConfig(): LLMConfig {
  return {
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    fallbackChain: [],
    maxRetries: 0,
    providers: { anthropic: { apiKey: 'test' } },
  };
}

function makeMessage(role: SessionMessage['role'], content: string, extra?: Partial<SessionMessage>): SessionMessage {
  return { role, content, timestamp: Date.now(), ...extra };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionManager', () => {
  let manager: SessionManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pawnbutler-test-'));
    manager = new SessionManager(makeSessionConfig(tmpDir));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create a new session', () => {
    const session = manager.createSession('butler');
    expect(session.id).toBeTruthy();
    expect(session.agentId).toBe('butler');
    expect(session.messages).toHaveLength(0);
    expect(session.status).toBe('active');
  });

  it('should get session by id', () => {
    const session = manager.createSession('butler');
    const retrieved = manager.getSession(session.id);
    expect(retrieved).toBe(session);
  });

  it('should return undefined for unknown session', () => {
    expect(manager.getSession('nonexistent')).toBeUndefined();
  });

  it('should get active session for agent', () => {
    const session = manager.createSession('researcher');
    const active = manager.getActiveSession('researcher');
    expect(active).toBe(session);
  });

  it('should not return completed session as active', () => {
    const session = manager.createSession('researcher');
    manager.updateStatus(session.id, 'completed');
    expect(manager.getActiveSession('researcher')).toBeUndefined();
  });

  it('should add messages to session', () => {
    const session = manager.createSession('butler');
    manager.addMessage(session.id, makeMessage('user', 'Hello'));
    manager.addMessage(session.id, makeMessage('assistant', 'Hi there'));

    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].role).toBe('user');
    expect(session.messages[1].role).toBe('assistant');
  });

  it('should throw when adding to nonexistent session', () => {
    expect(() => {
      manager.addMessage('invalid', makeMessage('user', 'test'));
    }).toThrow('Session invalid not found');
  });

  it('should update session status', () => {
    const session = manager.createSession('butler');
    manager.updateStatus(session.id, 'completed');
    expect(session.status).toBe('completed');
  });

  it('should convert messages to LLM format', () => {
    const session = manager.createSession('butler');
    manager.addMessage(session.id, makeMessage('system', 'You are a helper'));
    manager.addMessage(session.id, makeMessage('user', 'Hello'));

    const llmMessages = manager.toLLMMessages(session.id);
    expect(llmMessages).toHaveLength(2);
    expect(llmMessages[0].role).toBe('system');
    expect(llmMessages[1].role).toBe('user');
  });

  it('should return empty for nonexistent session toLLMMessages', () => {
    expect(manager.toLLMMessages('nonexistent')).toEqual([]);
  });

  describe('persistence', () => {
    it('should save and load session', async () => {
      const session = manager.createSession('butler', { topic: 'test' });
      manager.addMessage(session.id, makeMessage('user', 'Hello'));
      manager.addMessage(session.id, makeMessage('assistant', 'Hi'));

      await manager.saveSession(session.id);

      // Create a new manager and load
      const manager2 = new SessionManager(makeSessionConfig(tmpDir));
      const loaded = await manager2.loadSession(session.id);

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(session.id);
      expect(loaded!.agentId).toBe('butler');
      expect(loaded!.messages).toHaveLength(2);
      expect(loaded!.metadata).toEqual({ topic: 'test' });
    });

    it('should return null for nonexistent session file', async () => {
      const loaded = await manager.loadSession('nonexistent');
      expect(loaded).toBeNull();
    });

    it('should list saved sessions', async () => {
      const s1 = manager.createSession('butler');
      const s2 = manager.createSession('researcher');
      manager.addMessage(s1.id, makeMessage('user', 'msg1'));
      manager.addMessage(s2.id, makeMessage('user', 'msg2'));

      await manager.saveSession(s1.id);
      await manager.saveSession(s2.id);

      const saved = manager.listSavedSessions();
      expect(saved).toContain(s1.id);
      expect(saved).toContain(s2.id);
    });

    it('should preserve tool call/result messages', async () => {
      const session = manager.createSession('butler');
      manager.addMessage(session.id, makeMessage('assistant', '', {
        toolCalls: [{ id: 'tc1', name: 'web_search', arguments: { query: 'test' } }],
      }));
      manager.addMessage(session.id, makeMessage('tool', '', {
        toolResult: { toolCallId: 'tc1', content: 'search results' },
      }));

      await manager.saveSession(session.id);

      const manager2 = new SessionManager(makeSessionConfig(tmpDir));
      const loaded = await manager2.loadSession(session.id);

      expect(loaded!.messages[0].toolCalls![0].name).toBe('web_search');
      expect(loaded!.messages[1].toolResult!.toolCallId).toBe('tc1');
    });
  });

  it('should delete session', () => {
    const session = manager.createSession('butler');
    expect(manager.getSessionCount()).toBe(1);
    manager.deleteSession(session.id);
    expect(manager.getSessionCount()).toBe(0);
  });
});

describe('ContextPruner', () => {
  let pruner: ContextPruner;

  beforeEach(() => {
    // Small context window for testing: 1000 tokens, reserve 200
    pruner = new ContextPruner(1000, 200);
  });

  it('should estimate tokens for messages', () => {
    const msg = makeMessage('user', 'Hello world'); // 11 chars ~ 3 tokens
    const tokens = pruner.estimateTokens(msg);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(10);
  });

  it('should include tool calls in token estimate', () => {
    const plain = makeMessage('assistant', 'response');
    const withTools = makeMessage('assistant', 'response', {
      toolCalls: [{ id: 'tc1', name: 'web_search', arguments: { query: 'long query string' } }],
    });

    expect(pruner.estimateTokens(withTools)).toBeGreaterThan(pruner.estimateTokens(plain));
  });

  describe('sliding window pruning', () => {
    it('should not prune when within budget', () => {
      const messages = [
        makeMessage('system', 'You are a helper'),
        makeMessage('user', 'Hello'),
        makeMessage('assistant', 'Hi'),
      ];

      const result = pruner.pruneSlidingWindow(messages);
      expect(result.pruned).toBe(false);
      expect(result.messages).toHaveLength(3);
    });

    it('should prune old messages when over budget', () => {
      const messages: SessionMessage[] = [
        makeMessage('system', 'System prompt'),
      ];

      // Add many messages to exceed budget
      for (let i = 0; i < 100; i++) {
        messages.push(makeMessage('user', `Message ${i} with enough content to consume tokens rapidly `.repeat(5)));
        messages.push(makeMessage('assistant', `Response ${i} with substantial content `.repeat(5)));
      }

      const result = pruner.pruneSlidingWindow(messages);
      expect(result.pruned).toBe(true);
      expect(result.removedCount).toBeGreaterThan(0);
      expect(result.messages.length).toBeLessThan(messages.length);
    });

    it('should always preserve system messages', () => {
      const messages: SessionMessage[] = [
        makeMessage('system', 'Important system prompt'),
      ];
      for (let i = 0; i < 50; i++) {
        messages.push(makeMessage('user', `Long message ${i} `.repeat(20)));
        messages.push(makeMessage('assistant', `Long response ${i} `.repeat(20)));
      }

      const result = pruner.pruneSlidingWindow(messages);
      const systemMessages = result.messages.filter((m) => m.role === 'system');
      expect(systemMessages).toHaveLength(1);
      expect(systemMessages[0].content).toBe('Important system prompt');
    });

    it('should keep most recent messages', () => {
      const messages: SessionMessage[] = [];
      for (let i = 0; i < 50; i++) {
        messages.push(makeMessage('user', `Message ${i} `.repeat(20)));
        messages.push(makeMessage('assistant', `Response ${i} `.repeat(20)));
      }

      const result = pruner.pruneSlidingWindow(messages);
      const lastMsg = result.messages[result.messages.length - 1];
      expect(lastMsg.content).toContain('Response 49');
    });
  });

  describe('summarize pruning', () => {
    it('should not prune when within budget', async () => {
      const largePruner = new ContextPruner(100000, 4096);
      const messages = [
        makeMessage('user', 'Hello'),
        makeMessage('assistant', 'Hi'),
      ];

      const mockManager = createMockLLMManager();
      const result = await largePruner.pruneSummarize(messages, mockManager);
      expect(result.pruned).toBe(false);
    });

    it('should summarize old messages when over budget', async () => {
      const messages: SessionMessage[] = [];
      for (let i = 0; i < 100; i++) {
        messages.push(makeMessage('user', `Discussion point ${i} `.repeat(10)));
        messages.push(makeMessage('assistant', `Analysis of point ${i} `.repeat(10)));
      }

      const mockManager = createMockLLMManager();
      const result = await pruner.pruneSummarize(messages, mockManager);
      expect(result.pruned).toBe(true);
      expect(result.summary).toBeTruthy();
    });

    it('should fall back to sliding window for too few messages', async () => {
      const messages = [
        makeMessage('user', 'x'.repeat(4000)),
        makeMessage('assistant', 'y'.repeat(4000)),
      ];

      const mockManager = createMockLLMManager();
      const result = await pruner.pruneSummarize(messages, mockManager);
      // With only 2 non-system messages, should fall back
      expect(result.pruned).toBe(true);
    });
  });
});

describe('System Prompts', () => {
  it('should return butler prompt', () => {
    expect(getSystemPrompt('butler')).toBe(BUTLER_SYSTEM_PROMPT);
  });

  it('should return researcher prompt', () => {
    expect(getSystemPrompt('researcher')).toBe(RESEARCHER_SYSTEM_PROMPT);
  });

  it('should return executor prompt', () => {
    expect(getSystemPrompt('executor')).toBe(EXECUTOR_SYSTEM_PROMPT);
  });

  it('butler prompt should contain safety rules', () => {
    expect(BUTLER_SYSTEM_PROMPT).toContain('NEVER sign up');
    expect(BUTLER_SYSTEM_PROMPT).toContain('NEVER make purchases');
    expect(BUTLER_SYSTEM_PROMPT).toContain('NEVER expose API keys');
  });

  it('researcher prompt should mention read-only', () => {
    expect(RESEARCHER_SYSTEM_PROMPT).toContain('READ-ONLY');
    expect(RESEARCHER_SYSTEM_PROMPT).toContain('CANNOT use: write_file');
  });

  it('executor prompt should mention approval', () => {
    expect(EXECUTOR_SYSTEM_PROMPT).toContain('approval');
    expect(EXECUTOR_SYSTEM_PROMPT).toContain('requiresApproval');
  });

  it('all prompts should contain safety rules', () => {
    for (const role of ['butler', 'researcher', 'executor'] as const) {
      const prompt = getSystemPrompt(role);
      expect(prompt).toContain('NEVER sign up');
      expect(prompt).toContain('NEVER make purchases');
      expect(prompt).toContain('NEVER expose API keys');
    }
  });
});

describe('AgentLoop (ReAct)', () => {
  let llmManager: LLMManager;
  let mockProvider: MockLLMProvider;
  let sessionManager: SessionManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pawnbutler-loop-'));
    llmManager = new LLMManager(makeLLMConfig());
    mockProvider = new MockLLMProvider();
    llmManager.registerProvider('anthropic', mockProvider);
    sessionManager = new SessionManager(makeSessionConfig(tmpDir));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeLoop(executeTool?: (name: string, args: Record<string, unknown>) => Promise<{ content: string; isError?: boolean }>) {
    return new AgentLoop(
      llmManager,
      sessionManager,
      executeTool ?? (async () => ({ content: 'tool result' })),
      {
        maxIterations: 10,
        systemPrompt: 'You are a test assistant.',
        tools: [
          {
            name: 'web_search',
            description: 'Search the web',
            parameters: { type: 'object', properties: { query: { type: 'string' } } },
          },
        ],
      }
    );
  }

  it('should complete with direct text response', async () => {
    mockProvider.responses = [{
      content: 'Hello! How can I help?',
      toolCalls: [],
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      model: 'claude-sonnet-4-5-20250929',
      provider: 'anthropic',
      finishReason: 'stop',
    }];

    const session = sessionManager.createSession('butler');
    const loop = makeLoop();
    const result = await loop.run('Hello', session.id);

    expect(result.content).toBe('Hello! How can I help?');
    expect(result.finishReason).toBe('completed');
    expect(result.iterations).toBe(1);
  });

  it('should execute tool calls and continue', async () => {
    mockProvider.responses = [
      // First: tool call
      {
        content: '',
        toolCalls: [{ id: 'tc1', name: 'web_search', arguments: { query: 'test' } }],
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        model: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        finishReason: 'tool_use',
      },
      // Second: final response
      {
        content: 'Based on the search, here is the answer.',
        toolCalls: [],
        usage: { inputTokens: 30, outputTokens: 15, totalTokens: 45 },
        model: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        finishReason: 'stop',
      },
    ];

    const session = sessionManager.createSession('butler');
    const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const loop = makeLoop(async (name, args) => {
      toolCalls.push({ name, args });
      return { content: 'Search results: found 3 items' };
    });

    const result = await loop.run('Search for something', session.id);

    expect(result.finishReason).toBe('completed');
    expect(result.iterations).toBe(2);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe('web_search');
  });

  it('should handle multiple tool calls in one response', async () => {
    mockProvider.responses = [
      {
        content: '',
        toolCalls: [
          { id: 'tc1', name: 'web_search', arguments: { query: 'query1' } },
          { id: 'tc2', name: 'web_search', arguments: { query: 'query2' } },
        ],
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        model: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        finishReason: 'tool_use',
      },
      {
        content: 'Combined results.',
        toolCalls: [],
        usage: { inputTokens: 40, outputTokens: 20, totalTokens: 60 },
        model: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        finishReason: 'stop',
      },
    ];

    const session = sessionManager.createSession('butler');
    let toolCallCount = 0;
    const loop = makeLoop(async () => {
      toolCallCount++;
      return { content: `result ${toolCallCount}` };
    });

    const result = await loop.run('Search two things', session.id);
    expect(result.finishReason).toBe('completed');
    expect(toolCallCount).toBe(2);
  });

  it('should stop at max iterations', async () => {
    // Make every response a tool call so it never stops
    mockProvider.responses = Array(15).fill({
      content: '',
      toolCalls: [{ id: 'tc1', name: 'web_search', arguments: { query: 'loop' } }],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      model: 'claude-sonnet-4-5-20250929',
      provider: 'anthropic',
      finishReason: 'tool_use',
    });

    const session = sessionManager.createSession('butler');
    const loop = new AgentLoop(
      llmManager,
      sessionManager,
      async () => ({ content: 'result' }),
      {
        maxIterations: 3,
        systemPrompt: 'test',
        tools: [{ name: 'web_search', description: 'Search', parameters: {} }],
      }
    );

    const result = await loop.run('infinite task', session.id);
    expect(result.finishReason).toBe('max_iterations');
    expect(result.iterations).toBe(3);
  });

  it('should handle LLM errors gracefully', async () => {
    mockProvider.responses = [];
    // Make the provider throw
    const originalChat = mockProvider.chat.bind(mockProvider);
    mockProvider.chat = async () => {
      throw new Error('API rate limited');
    };

    const session = sessionManager.createSession('butler');
    const loop = makeLoop();
    const result = await loop.run('test', session.id);

    expect(result.finishReason).toBe('error');
    expect(result.content).toContain('rate limited');

    mockProvider.chat = originalChat;
  });

  it('should handle tool execution errors', async () => {
    mockProvider.responses = [
      {
        content: '',
        toolCalls: [{ id: 'tc1', name: 'web_search', arguments: { query: 'test' } }],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        model: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        finishReason: 'tool_use',
      },
      {
        content: 'The search failed, but I can still help.',
        toolCalls: [],
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        model: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        finishReason: 'stop',
      },
    ];

    const session = sessionManager.createSession('butler');
    const loop = makeLoop(async () => ({
      content: 'Tool execution error: connection failed',
      isError: true,
    }));

    const result = await loop.run('search something', session.id);
    expect(result.finishReason).toBe('completed');

    // Verify tool error was recorded in session
    const messages = sessionManager.toLLMMessages(session.id);
    const toolResults = messages.filter((m) => m.role === 'tool');
    expect(toolResults[0].toolResult!.isError).toBe(true);
  });

  it('should emit step events for transparency', async () => {
    mockProvider.responses = [{
      content: 'Done',
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      model: 'claude-sonnet-4-5-20250929',
      provider: 'anthropic',
      finishReason: 'stop',
    }];

    const session = sessionManager.createSession('butler');
    const loop = makeLoop();

    const emittedSteps: unknown[] = [];
    loop.on('step', (step) => emittedSteps.push(step));

    await loop.run('test', session.id);

    expect(emittedSteps.length).toBeGreaterThanOrEqual(2); // llm_call + response
    const types = emittedSteps.map((s: any) => s.type);
    expect(types).toContain('llm_call');
    expect(types).toContain('response');
  });

  it('should emit tool events for transparency', async () => {
    mockProvider.responses = [
      {
        content: '',
        toolCalls: [{ id: 'tc1', name: 'web_search', arguments: { query: 'test' } }],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        model: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        finishReason: 'tool_use',
      },
      {
        content: 'Done',
        toolCalls: [],
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        model: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        finishReason: 'stop',
      },
    ];

    const session = sessionManager.createSession('butler');
    const loop = makeLoop();

    const emittedSteps: unknown[] = [];
    loop.on('step', (step) => emittedSteps.push(step));

    await loop.run('search', session.id);

    const types = emittedSteps.map((s: any) => s.type);
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
  });

  it('should store all messages in session', async () => {
    mockProvider.responses = [
      {
        content: '',
        toolCalls: [{ id: 'tc1', name: 'web_search', arguments: { query: 'test' } }],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        model: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        finishReason: 'tool_use',
      },
      {
        content: 'Final answer',
        toolCalls: [],
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        model: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        finishReason: 'stop',
      },
    ];

    const session = sessionManager.createSession('butler');
    const loop = makeLoop();
    await loop.run('test query', session.id);

    // Should have: user, assistant (tool call), tool result, assistant (final)
    expect(session.messages).toHaveLength(4);
    expect(session.messages[0].role).toBe('user');
    expect(session.messages[1].role).toBe('assistant');
    expect(session.messages[1].toolCalls).toHaveLength(1);
    expect(session.messages[2].role).toBe('tool');
    expect(session.messages[3].role).toBe('assistant');
    expect(session.messages[3].content).toBe('Final answer');
  });

  it('should include step details in result', async () => {
    mockProvider.responses = [{
      content: 'Response',
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      model: 'claude-sonnet-4-5-20250929',
      provider: 'anthropic',
      finishReason: 'stop',
    }];

    const session = sessionManager.createSession('butler');
    const loop = makeLoop();
    const result = await loop.run('test', session.id);

    expect(result.steps.length).toBeGreaterThanOrEqual(2);
    const llmStep = result.steps.find((s) => s.type === 'llm_call');
    expect(llmStep).toBeDefined();
    expect(llmStep!.data.messageCount).toBeDefined();
  });
});

describe('Schema validation with sessions', () => {
  it('should validate config with session settings', async () => {
    const { validateConfig } = await import('../src/config/schema.js');

    const config = {
      agents: [{
        id: 'butler', role: 'butler', name: 'Butler', description: 'test',
        allowedTools: [], deniedTools: [], maxConcurrentActions: 1, requirePlanApproval: false,
      }],
      safety: { defaultLevel: 'moderate', forbiddenActions: [], dangerousActions: [], secretPatterns: [] },
      urlAllowlist: [], urlBlocklist: [],
      secretVault: { enabled: false, storePath: '.vault' },
      auditLog: { enabled: false, logPath: '.log', alertLogPath: '.alert', retentionDays: 30 },
      sandbox: {
        enabled: false, image: 'test:latest', networkMode: 'none' as const,
        memoryLimit: '256m', cpuLimit: 1, timeout: 10000, mountPaths: [], allowWriteMount: false,
      },
      sessions: {
        maxMessages: 100,
        contextWindow: 128000,
        pruningStrategy: 'sliding_window',
        storePath: '.pawnbutler/sessions',
      },
    };

    const result = validateConfig(config);
    expect(result.success).toBe(true);
  });

  it('should reject invalid pruning strategy', async () => {
    const { validateConfig } = await import('../src/config/schema.js');

    const config = {
      agents: [{
        id: 'butler', role: 'butler', name: 'Butler', description: 'test',
        allowedTools: [], deniedTools: [], maxConcurrentActions: 1, requirePlanApproval: false,
      }],
      safety: { defaultLevel: 'moderate', forbiddenActions: [], dangerousActions: [], secretPatterns: [] },
      urlAllowlist: [], urlBlocklist: [],
      secretVault: { enabled: false, storePath: '.vault' },
      auditLog: { enabled: false, logPath: '.log', alertLogPath: '.alert', retentionDays: 30 },
      sandbox: {
        enabled: false, image: 'test:latest', networkMode: 'none' as const,
        memoryLimit: '256m', cpuLimit: 1, timeout: 10000, mountPaths: [], allowWriteMount: false,
      },
      sessions: {
        maxMessages: 100,
        contextWindow: 128000,
        pruningStrategy: 'invalid_strategy',
        storePath: '.pawnbutler/sessions',
      },
    };

    const result = validateConfig(config);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Helper to create mock LLM manager for pruning tests
// ---------------------------------------------------------------------------

function createMockLLMManager(): LLMManager {
  const manager = new LLMManager(makeLLMConfig());
  const mock = new MockLLMProvider();
  mock.responses = [{
    content: 'Summary: The conversation discussed various topics including search results and analysis.',
    toolCalls: [],
    usage: { inputTokens: 100, outputTokens: 30, totalTokens: 130 },
    model: 'claude-sonnet-4-5-20250929',
    provider: 'anthropic',
    finishReason: 'stop',
  }];
  manager.registerProvider('anthropic', mock);
  return manager;
}

// ---------------------------------------------------------------------------
// Engine validateAndExecute + LLM/Session integration tests
// ---------------------------------------------------------------------------

function testEngineConfig(overrides: Partial<PawnButlerConfig> = {}): PawnButlerConfig {
  return {
    ...defaultConfig,
    auditLog: { ...defaultConfig.auditLog, enabled: false },
    ...overrides,
  };
}

describe('Engine validateAndExecute (Guardian integration)', () => {
  let engine: PawnButlerEngine;

  beforeEach(() => {
    engine = new PawnButlerEngine(testEngineConfig());
  });

  it('should auto-approve safe actions via Guardian', async () => {
    const request: ActionRequest = {
      id: 'safe-1',
      agentId: 'researcher',
      agentRole: 'researcher',
      actionType: 'web_search',
      params: { query: 'TypeScript docs' },
      safetyLevel: 'safe',
      timestamp: Date.now(),
      requiresApproval: false,
    };

    const result = await engine.validateAndExecute(request);
    expect(result.success).toBe(true);
    expect(result.requestId).toBe('safe-1');
  });

  it('should block forbidden actions (signup)', async () => {
    const request: ActionRequest = {
      id: 'forbidden-1',
      agentId: 'executor',
      agentRole: 'executor',
      actionType: 'signup',
      params: { email: 'test@evil.com', password: 'pass123' },
      safetyLevel: 'forbidden',
      timestamp: Date.now(),
      requiresApproval: true,
    };

    const result = await engine.validateAndExecute(request);
    expect(result.success).toBe(false);
    expect(result.blockedBy).toBe('guardian');
    expect(result.blockedReason).toContain('forbidden');
  });

  it('should block forbidden actions (payment)', async () => {
    const request: ActionRequest = {
      id: 'forbidden-2',
      agentId: 'executor',
      agentRole: 'executor',
      actionType: 'payment',
      params: { amount: 100 },
      safetyLevel: 'forbidden',
      timestamp: Date.now(),
      requiresApproval: true,
    };

    const result = await engine.validateAndExecute(request);
    expect(result.success).toBe(false);
    expect(result.blockedBy).toBe('guardian');
  });

  it('should flag dangerous actions for approval', async () => {
    const request: ActionRequest = {
      id: 'dangerous-1',
      agentId: 'executor',
      agentRole: 'executor',
      actionType: 'exec_command',
      params: { command: 'npm test' },
      safetyLevel: 'dangerous',
      timestamp: Date.now(),
      requiresApproval: true,
    };

    const result = await engine.validateAndExecute(request);
    expect(result.success).toBe(false);
    expect(result.blockedReason).toContain('dangerous');
  });

  it('should block secret leakage in params', async () => {
    const request: ActionRequest = {
      id: 'secret-1',
      agentId: 'researcher',
      agentRole: 'researcher',
      actionType: 'web_fetch',
      params: { url: 'https://google.com', data: 'key=sk-abcdefghijklmnopqrstuvwxyz' },
      safetyLevel: 'moderate',
      timestamp: Date.now(),
      requiresApproval: false,
    };

    const result = await engine.validateAndExecute(request);
    expect(result.success).toBe(false);
    expect(result.blockedReason).toContain('secret');
  });

  it('should block blocked URLs', async () => {
    const request: ActionRequest = {
      id: 'url-block-1',
      agentId: 'researcher',
      agentRole: 'researcher',
      actionType: 'web_fetch',
      params: { url: 'https://casino-online.com/game' },
      safetyLevel: 'moderate',
      timestamp: Date.now(),
      requiresApproval: false,
    };

    const result = await engine.validateAndExecute(request);
    expect(result.success).toBe(false);
    expect(result.blockedBy).toBe('guardian');
  });

  it('should expose Guardian via getGuardian()', () => {
    const guardian = engine.getGuardian();
    expect(guardian).toBeDefined();
    expect(guardian.getStatus().totalChecked).toBe(0);
  });

  it('should track Guardian status across multiple validations', async () => {
    await engine.validateAndExecute({
      id: 'v1', agentId: 'r', agentRole: 'researcher', actionType: 'web_search',
      params: { query: 'test' }, safetyLevel: 'safe', timestamp: Date.now(), requiresApproval: false,
    });
    await engine.validateAndExecute({
      id: 'v2', agentId: 'e', agentRole: 'executor', actionType: 'signup',
      params: {}, safetyLevel: 'forbidden', timestamp: Date.now(), requiresApproval: true,
    });

    const status = engine.getGuardian().getStatus();
    expect(status.totalChecked).toBe(2);
    expect(status.blocked).toBe(1);
  });
});

describe('Engine LLM + Session injection on start', () => {
  it('should inject LLM manager into agents on start', async () => {
    const engine = new PawnButlerEngine(testEngineConfig());
    const butler = new ButlerAgent({ id: 'butler' });
    const researcher = new ResearcherAgent({ id: 'researcher' });

    engine.registerAgent(butler);
    engine.registerAgent(researcher);

    const llm = new LLMManager(makeLLMConfig());
    const mock = new MockLLMProvider();
    llm.registerProvider('anthropic', mock);
    engine.setLLMManager(llm);

    expect(butler.hasLLM()).toBe(false);
    expect(researcher.hasLLM()).toBe(false);

    await engine.start();

    expect(butler.hasLLM()).toBe(true);
    expect(researcher.hasLLM()).toBe(true);

    await engine.shutdown();
  });

  it('should set engine reference on agents during start', async () => {
    const engine = new PawnButlerEngine(testEngineConfig());
    const butler = new ButlerAgent({ id: 'butler' });
    engine.registerAgent(butler);

    await engine.start();

    // Verify the agent can call engine.validateAndExecute through requestAction
    const result = await butler.requestAction('web_search', { query: 'test' });
    // Should succeed because web_search is allowed for butler and is auto-approved
    expect(result.success).toBe(true);

    await engine.shutdown();
  });

  it('should work without LLM manager (agents have heuristic fallback)', async () => {
    const engine = new PawnButlerEngine(testEngineConfig());
    const butler = new ButlerAgent({ id: 'butler' });
    engine.registerAgent(butler);

    await engine.start();

    expect(butler.hasLLM()).toBe(false);
    // Butler should still work with heuristic routing
    const result = await butler.handleTask('search for TypeScript tutorials');
    expect(result).toHaveProperty('delegated', true);

    await engine.shutdown();
  });

  it('should set and get session manager', () => {
    const engine = new PawnButlerEngine(testEngineConfig());
    expect(engine.getSessionManager()).toBeNull();

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pawnbutler-engine-'));
    const sm = new SessionManager(makeSessionConfig(tmpDir));
    engine.setSessionManager(sm);

    expect(engine.getSessionManager()).toBe(sm);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should set and get LLM manager', () => {
    const engine = new PawnButlerEngine(testEngineConfig());
    expect(engine.getLLMManager()).toBeNull();

    const llm = new LLMManager(makeLLMConfig());
    engine.setLLMManager(llm);

    expect(engine.getLLMManager()).toBe(llm);
  });

  it('should clean up Guardian on shutdown', async () => {
    const engine = new PawnButlerEngine(testEngineConfig());
    const butler = new ButlerAgent({ id: 'butler' });
    engine.registerAgent(butler);
    await engine.start();

    // Verify guardian is accessible before shutdown
    expect(engine.getGuardian()).toBeDefined();

    await engine.shutdown();
    expect(engine.isRunning()).toBe(false);
  });

  it('should connect agent to real Guardian pipeline end-to-end', async () => {
    const engine = new PawnButlerEngine(testEngineConfig());
    const researcher = new ResearcherAgent({ id: 'researcher' });
    engine.registerAgent(researcher);

    await engine.start();

    // Allowed action: web_search to safe domain
    const allowed = await researcher.requestAction('web_search', { query: 'TypeScript' });
    expect(allowed.success).toBe(true);

    // Blocked action at agent level: write_file denied for researcher
    const agentBlocked = await researcher.requestAction('write_file', { path: '/tmp/x' });
    expect(agentBlocked.success).toBe(false);
    expect(agentBlocked.blockedBy).toBe('agent_policy');

    // Blocked action at Guardian level: secret in params
    const secretBlocked = await researcher.requestAction('web_fetch', {
      url: 'https://google.com',
      data: 'sk-abcdefghijklmnopqrstuvwxyz',
    });
    expect(secretBlocked.success).toBe(false);
    expect(secretBlocked.blockedBy).toBe('guardian');

    await engine.shutdown();
  });
});
