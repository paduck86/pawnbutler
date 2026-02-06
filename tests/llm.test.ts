import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { LLMProvider } from '../src/llm/provider.js';
import { LLMManager } from '../src/llm/llm-manager.js';
import { ModelRegistry } from '../src/llm/model-registry.js';
import { ButlerAgent } from '../src/agents/butler.js';
import { ResearcherAgent } from '../src/agents/researcher.js';
import { ExecutorAgent } from '../src/agents/executor.js';
import type { AgentEngine } from '../src/agents/base-agent.js';
import type {
  LLMConfig,
  LLMProviderName,
  LLMMessage,
  LLMRequestOptions,
  LLMResponse,
  StreamChunk,
  TokenUsage,
  ToolCall,
  ToolDefinition,
  ModelInfo,
  UsageRecord,
} from '../src/llm/types.js';

// ---------------------------------------------------------------------------
// Mock Provider
// ---------------------------------------------------------------------------

class MockProvider extends LLMProvider {
  readonly name: LLMProviderName;
  readonly defaultModel: string;
  chatFn: (messages: LLMMessage[], options?: LLMRequestOptions) => Promise<LLMResponse>;
  streamChunks: StreamChunk[];
  shouldFail: boolean;

  constructor(name: LLMProviderName, model: string) {
    super();
    this.name = name;
    this.defaultModel = model;
    this.shouldFail = false;
    this.streamChunks = [];
    this.chatFn = async () => this.defaultResponse();
  }

  private defaultResponse(): LLMResponse {
    return {
      content: `Response from ${this.name}`,
      toolCalls: [],
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      model: this.defaultModel,
      provider: this.name,
      finishReason: 'stop',
    };
  }

  async chat(messages: LLMMessage[], options?: LLMRequestOptions): Promise<LLMResponse> {
    const model = options?.model ?? this.defaultModel;
    this.emitRequest(model, messages.length);

    if (this.shouldFail) {
      const err = new Error(`${this.name} provider error`);
      this.emitError(err, model);
      throw err;
    }

    const response = await this.chatFn(messages, options);
    this.emitUsage(model, response.usage, 100);
    return response;
  }

  async *stream(
    messages: LLMMessage[],
    options?: LLMRequestOptions
  ): AsyncGenerator<StreamChunk> {
    const model = options?.model ?? this.defaultModel;
    this.emitRequest(model, messages.length);

    if (this.shouldFail) {
      const err = new Error(`${this.name} stream error`);
      this.emitError(err, model);
      throw err;
    }

    for (const chunk of this.streamChunks) {
      yield chunk;
    }

    const usage: TokenUsage = { inputTokens: 80, outputTokens: 40, totalTokens: 120 };
    this.emitUsage(model, usage, 200);
    yield { type: 'done', usage };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLLMConfig(overrides?: Partial<LLMConfig>): LLMConfig {
  return {
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    fallbackChain: ['openai', 'google'],
    maxRetries: 1,
    providers: {
      anthropic: { apiKey: 'test-key' },
      openai: { apiKey: 'test-key' },
      google: { apiKey: 'test-key' },
    },
    ...overrides,
  };
}

function makeSampleMessages(): LLMMessage[] {
  return [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' },
  ];
}

const sampleToolDef: ToolDefinition = {
  name: 'get_weather',
  description: 'Get weather for a location',
  parameters: {
    type: 'object',
    properties: {
      location: { type: 'string', description: 'City name' },
    },
    required: ['location'],
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LLM Types', () => {
  it('should define LLMMessage with all roles', () => {
    const messages: LLMMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi', toolCalls: [{ id: 'tc1', name: 'tool', arguments: {} }] },
      { role: 'tool', content: '', toolResult: { toolCallId: 'tc1', content: 'result' } },
    ];
    expect(messages).toHaveLength(4);
    expect(messages[2].toolCalls![0].id).toBe('tc1');
    expect(messages[3].toolResult!.toolCallId).toBe('tc1');
  });

  it('should define StreamChunk with all types', () => {
    const chunks: StreamChunk[] = [
      { type: 'text', content: 'Hello' },
      { type: 'tool_call_start', toolCall: { id: 'tc1', name: 'fn' } },
      { type: 'tool_call_delta', content: '{"x":' },
      { type: 'tool_call_end', toolCall: { id: 'tc1', name: 'fn', arguments: { x: 1 } } },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      { type: 'done' },
    ];
    expect(chunks).toHaveLength(6);
  });
});

describe('LLMProvider base class', () => {
  let provider: MockProvider;

  beforeEach(() => {
    provider = new MockProvider('anthropic', 'claude-sonnet-4-5-20250929');
  });

  it('should emit request event on chat', async () => {
    const events: unknown[] = [];
    provider.on('request', (data) => events.push(data));

    await provider.chat(makeSampleMessages());

    expect(events).toHaveLength(1);
    expect((events[0] as Record<string, unknown>).provider).toBe('anthropic');
    expect((events[0] as Record<string, unknown>).messageCount).toBe(2);
  });

  it('should emit usage event on chat', async () => {
    const events: unknown[] = [];
    provider.on('usage', (data) => events.push(data));

    await provider.chat(makeSampleMessages());

    expect(events).toHaveLength(1);
    const usage = events[0] as Record<string, unknown>;
    expect(usage.provider).toBe('anthropic');
    expect((usage.usage as TokenUsage).inputTokens).toBe(100);
    expect((usage.usage as TokenUsage).outputTokens).toBe(50);
  });

  it('should emit error event on failure', async () => {
    provider.shouldFail = true;
    const errors: unknown[] = [];
    provider.on('llm_error', (data) => errors.push(data));

    await expect(provider.chat(makeSampleMessages())).rejects.toThrow('anthropic provider error');
    expect(errors).toHaveLength(1);
    expect((errors[0] as Record<string, unknown>).provider).toBe('anthropic');
  });

  it('should emit events on stream', async () => {
    provider.streamChunks = [
      { type: 'text', content: 'Hello ' },
      { type: 'text', content: 'world' },
    ];

    const usageEvents: unknown[] = [];
    provider.on('usage', (data) => usageEvents.push(data));

    const chunks: StreamChunk[] = [];
    for await (const chunk of provider.stream(makeSampleMessages())) {
      chunks.push(chunk);
    }

    // text + text + done
    expect(chunks).toHaveLength(3);
    expect(chunks[0].content).toBe('Hello ');
    expect(chunks[1].content).toBe('world');
    expect(chunks[2].type).toBe('done');
    expect(usageEvents).toHaveLength(1);
  });
});

describe('ModelRegistry', () => {
  let registry: ModelRegistry;

  beforeEach(() => {
    registry = new ModelRegistry();
  });

  it('should have built-in models', () => {
    const all = registry.getAllModels();
    expect(all.length).toBeGreaterThan(5);
  });

  it('should get model by id', () => {
    const model = registry.getModel('gpt-4o');
    expect(model).toBeDefined();
    expect(model!.provider).toBe('openai');
    expect(model!.contextWindow).toBe(128_000);
  });

  it('should filter models by provider', () => {
    const anthropicModels = registry.getModelsByProvider('anthropic');
    expect(anthropicModels.length).toBeGreaterThan(0);
    expect(anthropicModels.every((m) => m.provider === 'anthropic')).toBe(true);
  });

  it('should register custom model', () => {
    const custom: ModelInfo = {
      id: 'custom-model',
      provider: 'local',
      displayName: 'Custom',
      contextWindow: 4096,
      maxOutputTokens: 2048,
      inputCostPer1kTokens: 0,
      outputCostPer1kTokens: 0,
      supportsTools: false,
      supportsStreaming: true,
      supportsVision: false,
    };

    registry.registerModel(custom);
    expect(registry.getModel('custom-model')).toEqual(custom);
  });

  it('should estimate cost correctly', () => {
    const cost = registry.estimateCost('gpt-4o', 1000, 500);
    // input: 1000/1000 * 0.0025 = 0.0025, output: 500/1000 * 0.01 = 0.005
    expect(cost).toBeCloseTo(0.0075, 6);
  });

  it('should return 0 cost for unknown model', () => {
    expect(registry.estimateCost('nonexistent', 1000, 500)).toBe(0);
  });

  it('should return 0 cost for local models', () => {
    const cost = registry.estimateCost('llama3.1', 10000, 5000);
    expect(cost).toBe(0);
  });
});

describe('LLMManager', () => {
  let manager: LLMManager;
  let mockAnthropic: MockProvider;
  let mockOpenAI: MockProvider;
  let mockGoogle: MockProvider;

  beforeEach(() => {
    const config = makeLLMConfig();
    manager = new LLMManager(config);

    // Replace the real providers with mocks
    mockAnthropic = new MockProvider('anthropic', 'claude-sonnet-4-5-20250929');
    mockOpenAI = new MockProvider('openai', 'gpt-4o');
    mockGoogle = new MockProvider('google', 'gemini-2.0-flash');

    manager.registerProvider('anthropic', mockAnthropic);
    manager.registerProvider('openai', mockOpenAI);
    manager.registerProvider('google', mockGoogle);
  });

  describe('provider management', () => {
    it('should list available providers', () => {
      const providers = manager.getAvailableProviders();
      expect(providers).toContain('anthropic');
      expect(providers).toContain('openai');
      expect(providers).toContain('google');
    });

    it('should get specific provider', () => {
      expect(manager.getProvider('openai')).toBe(mockOpenAI);
    });

    it('should get default provider when no name specified', () => {
      expect(manager.getProvider()).toBe(mockAnthropic);
    });

    it('should return undefined for unregistered provider', () => {
      expect(manager.getProvider('local')).toBeUndefined();
    });

    it('should expose the model registry', () => {
      const registry = manager.getRegistry();
      expect(registry).toBeInstanceOf(ModelRegistry);
      expect(registry.getModel('gpt-4o')).toBeDefined();
    });
  });

  describe('chat', () => {
    it('should call default provider', async () => {
      const result = await manager.chat(makeSampleMessages());
      expect(result.provider).toBe('anthropic');
      expect(result.content).toBe('Response from anthropic');
    });

    it('should call specific provider', async () => {
      const result = await manager.chat(makeSampleMessages(), { provider: 'openai' });
      expect(result.provider).toBe('openai');
      expect(result.content).toBe('Response from openai');
    });

    it('should pass options to provider', async () => {
      let receivedOptions: LLMRequestOptions | undefined;
      mockAnthropic.chatFn = async (_msgs, opts) => {
        receivedOptions = opts;
        return {
          content: 'ok',
          toolCalls: [],
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          model: 'claude-sonnet-4-5-20250929',
          provider: 'anthropic',
          finishReason: 'stop',
        };
      };

      await manager.chat(makeSampleMessages(), {
        temperature: 0.5,
        maxTokens: 1000,
        tools: [sampleToolDef],
      });

      expect(receivedOptions).toBeDefined();
      expect(receivedOptions!.temperature).toBe(0.5);
      expect(receivedOptions!.maxTokens).toBe(1000);
      expect(receivedOptions!.tools).toHaveLength(1);
    });
  });

  describe('tool call parsing', () => {
    it('should return tool calls in response', async () => {
      const toolCall: ToolCall = {
        id: 'tc_123',
        name: 'get_weather',
        arguments: { location: 'Seoul' },
      };

      mockAnthropic.chatFn = async () => ({
        content: '',
        toolCalls: [toolCall],
        usage: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        model: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        finishReason: 'tool_use',
      });

      const result = await manager.chat(makeSampleMessages(), { tools: [sampleToolDef] });
      expect(result.finishReason).toBe('tool_use');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('get_weather');
      expect(result.toolCalls[0].arguments).toEqual({ location: 'Seoul' });
    });

    it('should handle multi-turn tool use conversation', async () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: 'What is the weather in Seoul?' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'tc1', name: 'get_weather', arguments: { location: 'Seoul' } }],
        },
        {
          role: 'tool',
          content: '',
          toolResult: { toolCallId: 'tc1', content: '15C, sunny' },
        },
      ];

      mockAnthropic.chatFn = async () => ({
        content: 'The weather in Seoul is 15C and sunny.',
        toolCalls: [],
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        model: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        finishReason: 'stop',
      });

      const result = await manager.chat(messages);
      expect(result.content).toContain('Seoul');
      expect(result.finishReason).toBe('stop');
    });
  });

  describe('streaming', () => {
    it('should stream text chunks', async () => {
      mockAnthropic.streamChunks = [
        { type: 'text', content: 'Hello' },
        { type: 'text', content: ' world' },
      ];

      const chunks: StreamChunk[] = [];
      for await (const chunk of manager.stream(makeSampleMessages())) {
        chunks.push(chunk);
      }

      expect(chunks.filter((c) => c.type === 'text')).toHaveLength(2);
      expect(chunks.find((c) => c.type === 'done')).toBeDefined();
    });

    it('should stream tool call chunks', async () => {
      mockAnthropic.streamChunks = [
        { type: 'tool_call_start', toolCall: { id: 'tc1', name: 'get_weather' } },
        { type: 'tool_call_delta', content: '{"location":' },
        { type: 'tool_call_delta', content: '"Seoul"}' },
        { type: 'tool_call_end', toolCall: { id: 'tc1', name: 'get_weather', arguments: { location: 'Seoul' } } },
      ];

      const chunks: StreamChunk[] = [];
      for await (const chunk of manager.stream(makeSampleMessages())) {
        chunks.push(chunk);
      }

      const starts = chunks.filter((c) => c.type === 'tool_call_start');
      const ends = chunks.filter((c) => c.type === 'tool_call_end');
      expect(starts).toHaveLength(1);
      expect(ends).toHaveLength(1);
      expect(ends[0].toolCall!.arguments).toEqual({ location: 'Seoul' });
    });

    it('should stream from specific provider', async () => {
      mockOpenAI.streamChunks = [{ type: 'text', content: 'from openai' }];

      const chunks: StreamChunk[] = [];
      for await (const chunk of manager.stream(makeSampleMessages(), { provider: 'openai' })) {
        chunks.push(chunk);
      }

      expect(chunks[0].content).toBe('from openai');
    });
  });

  describe('fallback chain', () => {
    it('should fall back to next provider on failure', async () => {
      mockAnthropic.shouldFail = true;

      const result = await manager.chat(makeSampleMessages());
      expect(result.provider).toBe('openai');
    });

    it('should fall back through multiple providers', async () => {
      mockAnthropic.shouldFail = true;
      mockOpenAI.shouldFail = true;

      const result = await manager.chat(makeSampleMessages());
      expect(result.provider).toBe('google');
    });

    it('should throw if all providers fail', async () => {
      mockAnthropic.shouldFail = true;
      mockOpenAI.shouldFail = true;
      mockGoogle.shouldFail = true;

      await expect(manager.chat(makeSampleMessages())).rejects.toThrow();
    });

    it('should emit retry events', async () => {
      mockAnthropic.shouldFail = true;
      const retries: unknown[] = [];
      manager.on('retry', (data) => retries.push(data));

      await manager.chat(makeSampleMessages());

      // maxRetries=1, so 2 attempts on anthropic (initial + 1 retry)
      expect(retries.length).toBeGreaterThanOrEqual(1);
    });

    it('should fall back on stream failure', async () => {
      mockAnthropic.shouldFail = true;
      mockOpenAI.streamChunks = [{ type: 'text', content: 'fallback stream' }];

      const chunks: StreamChunk[] = [];
      for await (const chunk of manager.stream(makeSampleMessages())) {
        chunks.push(chunk);
      }

      expect(chunks[0].content).toBe('fallback stream');
    });

    it('should emit fallback event on stream', async () => {
      mockAnthropic.shouldFail = true;
      mockOpenAI.streamChunks = [{ type: 'text', content: 'ok' }];

      const fallbacks: unknown[] = [];
      manager.on('fallback', (data) => fallbacks.push(data));

      const chunks: StreamChunk[] = [];
      for await (const chunk of manager.stream(makeSampleMessages())) {
        chunks.push(chunk);
      }

      expect(fallbacks).toHaveLength(1);
      expect((fallbacks[0] as Record<string, unknown>).from).toBe('anthropic');
    });
  });

  describe('usage tracking', () => {
    it('should track usage from chat calls', async () => {
      await manager.chat(makeSampleMessages());
      await manager.chat(makeSampleMessages(), { provider: 'openai' });

      const history = manager.getUsageHistory();
      expect(history).toHaveLength(2);
      expect(history[0].provider).toBe('anthropic');
      expect(history[1].provider).toBe('openai');
    });

    it('should track usage from stream calls', async () => {
      mockAnthropic.streamChunks = [{ type: 'text', content: 'hi' }];

      // Consume the stream
      for await (const _ of manager.stream(makeSampleMessages())) {
        // consume
      }

      const history = manager.getUsageHistory();
      expect(history).toHaveLength(1);
      expect(history[0].usage.inputTokens).toBe(80);
    });

    it('should calculate usage summary', async () => {
      await manager.chat(makeSampleMessages());
      await manager.chat(makeSampleMessages());
      await manager.chat(makeSampleMessages(), { provider: 'openai' });

      const summary = manager.getUsageSummary();
      expect(summary.callCount).toBe(3);
      expect(summary.totalInputTokens).toBe(300); // 100 * 3
      expect(summary.totalOutputTokens).toBe(150); // 50 * 3
      expect(summary.byProvider['anthropic'].calls).toBe(2);
      expect(summary.byProvider['openai'].calls).toBe(1);
    });

    it('should include estimated cost in usage records', async () => {
      await manager.chat(makeSampleMessages());

      const history = manager.getUsageHistory();
      expect(history[0].estimatedCost).toBeGreaterThanOrEqual(0);
    });

    it('should clear usage history', async () => {
      await manager.chat(makeSampleMessages());
      expect(manager.getUsageHistory()).toHaveLength(1);

      manager.clearUsageHistory();
      expect(manager.getUsageHistory()).toHaveLength(0);
    });

    it('should emit usage events', async () => {
      const usageEvents: UsageRecord[] = [];
      manager.on('usage', (record: UsageRecord) => usageEvents.push(record));

      await manager.chat(makeSampleMessages());

      expect(usageEvents).toHaveLength(1);
      expect(usageEvents[0].provider).toBe('anthropic');
      expect(usageEvents[0].durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('transparency events', () => {
    it('should emit request events', async () => {
      const requests: unknown[] = [];
      manager.on('request', (data) => requests.push(data));

      await manager.chat(makeSampleMessages());

      expect(requests).toHaveLength(1);
      expect((requests[0] as Record<string, unknown>).provider).toBe('anthropic');
    });

    it('should emit error events', async () => {
      mockAnthropic.shouldFail = true;
      const errors: unknown[] = [];
      manager.on('llm_error', (data) => errors.push(data));

      // will fallback, but should still emit errors for anthropic
      await manager.chat(makeSampleMessages());

      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect((errors[0] as Record<string, unknown>).provider).toBe('anthropic');
    });
  });
});

describe('LLM secret scanning', () => {
  let manager: LLMManager;
  let mockAnthropic: MockProvider;

  beforeEach(() => {
    const config = makeLLMConfig();
    manager = new LLMManager(config);
    mockAnthropic = new MockProvider('anthropic', 'claude-sonnet-4-5-20250929');
    manager.registerProvider('anthropic', mockAnthropic);
  });

  it('should detect OpenAI API key in messages', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'My key is sk-abcdefghijklmnopqrstuvwxyz1234567890' },
    ];
    const found = manager.scanMessagesForSecrets(messages);
    expect(found.length).toBeGreaterThan(0);
  });

  it('should detect AWS access key in messages', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'Use AKIAIOSFODNN7EXAMPLE for AWS' },
    ];
    const found = manager.scanMessagesForSecrets(messages);
    expect(found.length).toBeGreaterThan(0);
  });

  it('should detect GitHub PAT in messages', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'Token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij' },
    ];
    const found = manager.scanMessagesForSecrets(messages);
    expect(found.length).toBeGreaterThan(0);
  });

  it('should detect Bearer token in messages', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test' },
    ];
    const found = manager.scanMessagesForSecrets(messages);
    expect(found.length).toBeGreaterThan(0);
  });

  it('should detect Slack token in messages', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'Use xoxb-1234567890-abcdefghij for Slack' },
    ];
    const found = manager.scanMessagesForSecrets(messages);
    expect(found.length).toBeGreaterThan(0);
  });

  it('should detect GitLab PAT in messages', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'glpat-ABCDEFGHIJKLMNOPQRSTx' },
    ];
    const found = manager.scanMessagesForSecrets(messages);
    expect(found.length).toBeGreaterThan(0);
  });

  it('should return empty array for clean messages', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'Hello, how are you?' },
      { role: 'system', content: 'You are a helpful assistant.' },
    ];
    const found = manager.scanMessagesForSecrets(messages);
    expect(found).toHaveLength(0);
  });

  it('should emit secret_warning event when secrets found', () => {
    const warnings: unknown[] = [];
    manager.on('secret_warning', (data) => warnings.push(data));

    const messages: LLMMessage[] = [
      { role: 'user', content: 'My key is sk-abcdefghijklmnopqrstuvwxyz1234567890' },
    ];
    manager.scanMessagesForSecrets(messages);

    expect(warnings).toHaveLength(1);
    expect((warnings[0] as Record<string, unknown>).patterns).toBeDefined();
    expect((warnings[0] as Record<string, unknown>).timestamp).toBeDefined();
  });

  it('should not emit secret_warning for clean messages', () => {
    const warnings: unknown[] = [];
    manager.on('secret_warning', (data) => warnings.push(data));

    const messages: LLMMessage[] = [
      { role: 'user', content: 'Just a normal message' },
    ];
    manager.scanMessagesForSecrets(messages);

    expect(warnings).toHaveLength(0);
  });

  it('should scan on chat()', async () => {
    const warnings: unknown[] = [];
    manager.on('secret_warning', (data) => warnings.push(data));

    await manager.chat([
      { role: 'user', content: 'Use AKIAIOSFODNN7EXAMPLE please' },
    ]);

    expect(warnings).toHaveLength(1);
  });

  it('should scan on stream()', async () => {
    const warnings: unknown[] = [];
    manager.on('secret_warning', (data) => warnings.push(data));

    mockAnthropic.streamChunks = [{ type: 'text', content: 'ok' }];
    for await (const _ of manager.stream([
      { role: 'user', content: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij' },
    ])) {
      // consume
    }

    expect(warnings).toHaveLength(1);
  });

  it('should skip messages with empty content', () => {
    const messages: LLMMessage[] = [
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'fn', arguments: {} }] },
    ];
    const found = manager.scanMessagesForSecrets(messages);
    expect(found).toHaveLength(0);
  });
});

describe('Config integration', () => {
  it('should create manager with empty providers', () => {
    const config: LLMConfig = {
      defaultProvider: 'local',
      defaultModel: 'llama3.1',
      fallbackChain: [],
      maxRetries: 0,
      providers: {
        local: { baseUrl: 'http://localhost:11434' },
      },
    };

    const manager = new LLMManager(config);
    expect(manager.getAvailableProviders()).toContain('local');
    expect(manager.getAvailableProviders()).not.toContain('anthropic');
  });

  it('should initialize only providers with API keys', () => {
    const config: LLMConfig = {
      defaultProvider: 'anthropic',
      defaultModel: 'claude-sonnet-4-5-20250929',
      fallbackChain: ['openai'],
      maxRetries: 1,
      providers: {
        anthropic: { apiKey: 'test' },
        // openai not configured - no api key
        // google not configured
      },
    };

    const manager = new LLMManager(config);
    expect(manager.getAvailableProviders()).toContain('anthropic');
    expect(manager.getAvailableProviders()).not.toContain('openai');
    expect(manager.getAvailableProviders()).not.toContain('google');
  });
});

describe('Schema validation', () => {
  // Build a minimal valid base config without optional fields that may have
  // broken defaults from other subsystems (e.g. channels with empty tokens).
  function minimalBaseConfig() {
    return {
      agents: [
        {
          id: 'butler',
          role: 'butler',
          name: 'Butler',
          description: 'test',
          allowedTools: [],
          deniedTools: [],
          maxConcurrentActions: 1,
          requirePlanApproval: false,
        },
      ],
      safety: {
        defaultLevel: 'moderate',
        forbiddenActions: [],
        dangerousActions: [],
        secretPatterns: [],
      },
      urlAllowlist: [],
      urlBlocklist: [],
      secretVault: { enabled: false, storePath: '.vault' },
      auditLog: { enabled: false, logPath: '.log', alertLogPath: '.alert', retentionDays: 30 },
      sandbox: {
        enabled: false,
        image: 'test:latest',
        networkMode: 'none' as const,
        memoryLimit: '256m',
        cpuLimit: 1,
        timeout: 10000,
        mountPaths: [],
        allowWriteMount: false,
      },
    };
  }

  it('should validate config with default LLM settings', async () => {
    const { validateConfig } = await import('../src/config/schema.js');

    const config = {
      ...minimalBaseConfig(),
      llm: {
        defaultProvider: 'anthropic',
        defaultModel: 'claude-sonnet-4-5-20250929',
        fallbackChain: ['openai', 'google', 'local'],
        maxRetries: 2,
        providers: {},
      },
    };

    const result = validateConfig(config);
    expect(result.success).toBe(true);
  });

  it('should validate LLM config with all providers', async () => {
    const { validateConfig } = await import('../src/config/schema.js');

    const config = {
      ...minimalBaseConfig(),
      llm: {
        defaultProvider: 'anthropic',
        defaultModel: 'claude-sonnet-4-5-20250929',
        fallbackChain: ['openai', 'google'],
        maxRetries: 2,
        providers: {
          anthropic: { apiKey: 'sk-test' },
          openai: { apiKey: 'sk-test', organization: 'org-123' },
          google: { apiKey: 'AIza-test' },
          local: { baseUrl: 'http://localhost:11434', model: 'llama3.1' },
        },
      },
    };

    const result = validateConfig(config);
    expect(result.success).toBe(true);
  });

  it('should reject invalid LLM provider name', async () => {
    const { validateConfig } = await import('../src/config/schema.js');

    const config = {
      ...minimalBaseConfig(),
      llm: {
        defaultProvider: 'invalid_provider',
        defaultModel: 'test',
        fallbackChain: [],
        maxRetries: 0,
        providers: {},
      },
    };

    const result = validateConfig(config);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Agent LLM Integration Tests
// ---------------------------------------------------------------------------

describe('Agent LLM Integration', () => {
  function makeMockLLMManager(): LLMManager {
    const config = makeLLMConfig();
    const manager = new LLMManager(config);
    const mock = new MockProvider('anthropic', 'claude-sonnet-4-5-20250929');
    manager.registerProvider('anthropic', mock);
    return manager;
  }

  function makeMockEngine(): AgentEngine {
    return {
      validateAndExecute: vi.fn().mockResolvedValue({ requestId: 'r1', success: true }),
      routeMessage: vi.fn(),
      requestApproval: vi.fn().mockResolvedValue({ requestId: 'r1', success: true }),
    };
  }

  describe('BaseAgent LLM methods', () => {
    it('should report no LLM by default', () => {
      const butler = new ButlerAgent({ id: 'butler' });
      expect(butler.hasLLM()).toBe(false);
    });

    it('should report LLM after setLLM', () => {
      const butler = new ButlerAgent({ id: 'butler' });
      butler.setLLM(makeMockLLMManager());
      expect(butler.hasLLM()).toBe(true);
    });
  });

  describe('ButlerAgent with LLM', () => {
    it('should work without LLM (heuristic fallback)', async () => {
      const butler = new ButlerAgent({ id: 'butler' });
      butler.setEngine(makeMockEngine());

      const result = await butler.handleTask('search for TypeScript tutorials');
      expect(result).toHaveProperty('delegated', true);
      expect(result).toHaveProperty('to', 'researcher');
    });

    it('should use LLM for routing when available', async () => {
      const manager = makeMockLLMManager();
      const mock = manager.getProvider('anthropic') as MockProvider;

      // Make the LLM return a routing decision
      mock.chatFn = async () => ({
        content: '{"delegateTo": "executor", "type": "execution"}',
        toolCalls: [],
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        model: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        finishReason: 'stop',
      });

      const butler = new ButlerAgent({ id: 'butler' });
      butler.setEngine(makeMockEngine());
      butler.setLLM(manager);

      const result = await butler.handleTask('please help me organize my files');
      expect(result).toHaveProperty('delegated', true);
      expect(result).toHaveProperty('to', 'executor');
    });

    it('should handle direct tasks with LLM response', async () => {
      const manager = makeMockLLMManager();
      const mock = manager.getProvider('anthropic') as MockProvider;

      let callCount = 0;
      mock.chatFn = async () => {
        callCount++;
        if (callCount === 1) {
          // First call: routing decision (direct)
          return {
            content: '{"delegateTo": null, "type": "direct"}',
            toolCalls: [],
            usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
            model: 'claude-sonnet-4-5-20250929',
            provider: 'anthropic',
            finishReason: 'stop',
          };
        }
        // Second call: direct response
        return {
          content: 'The capital of France is Paris.',
          toolCalls: [],
          usage: { inputTokens: 30, outputTokens: 15, totalTokens: 45 },
          model: 'claude-sonnet-4-5-20250929',
          provider: 'anthropic',
          finishReason: 'stop',
        };
      };

      const butler = new ButlerAgent({ id: 'butler' });
      butler.setEngine(makeMockEngine());
      butler.setLLM(manager);

      const result = await butler.handleTask('What is the capital of France?') as Record<string, unknown>;
      expect(result.handled).toBe(true);
      expect(result.response).toBe('The capital of France is Paris.');
    });

    it('should fall back to heuristics if LLM returns invalid JSON', async () => {
      const manager = makeMockLLMManager();
      const mock = manager.getProvider('anthropic') as MockProvider;

      mock.chatFn = async () => ({
        content: 'not valid json at all',
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        model: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        finishReason: 'stop',
      });

      const butler = new ButlerAgent({ id: 'butler' });
      butler.setEngine(makeMockEngine());
      butler.setLLM(manager);

      // "search" keyword triggers heuristic fallback to researcher
      const result = await butler.handleTask('search for Node.js best practices');
      expect(result).toHaveProperty('delegated', true);
      expect(result).toHaveProperty('to', 'researcher');
    });

    it('should use LLM for plan review when available', async () => {
      const manager = makeMockLLMManager();
      const mock = manager.getProvider('anthropic') as MockProvider;

      mock.chatFn = async () => ({
        content: '{"approved": true, "feedback": "Plan looks safe."}',
        toolCalls: [],
        usage: { inputTokens: 30, outputTokens: 15, totalTokens: 45 },
        model: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        finishReason: 'stop',
      });

      const butler = new ButlerAgent({ id: 'butler' });
      butler.setLLM(manager);

      const review = await butler.reviewPlanWithLLM(
        'Step 1: read_file config.json\nStep 2: edit_file config.json',
        'executor'
      );
      expect(review.approved).toBe(true);
      expect(review.feedback).toBe('Plan looks safe.');
    });
  });

  describe('ResearcherAgent with LLM', () => {
    it('should work without LLM (heuristic query building)', async () => {
      const researcher = new ResearcherAgent({ id: 'researcher' });
      const engine = makeMockEngine();
      researcher.setEngine(engine);

      const result = await researcher.handleTask('TypeScript tutorials', { topic: 'programming' });
      expect(result.query).toBe('TypeScript tutorials');
    });

    it('should enhance queries with LLM when available', async () => {
      const manager = makeMockLLMManager();
      const mock = manager.getProvider('anthropic') as MockProvider;

      mock.chatFn = async () => ({
        content: 'TypeScript advanced generics tutorial 2024',
        toolCalls: [],
        usage: { inputTokens: 15, outputTokens: 8, totalTokens: 23 },
        model: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        finishReason: 'stop',
      });

      const researcher = new ResearcherAgent({ id: 'researcher' });
      const engine = makeMockEngine();
      // web_search returns mock results
      (engine.validateAndExecute as ReturnType<typeof vi.fn>).mockResolvedValue({
        requestId: 'r1',
        success: true,
        data: [{ url: 'https://example.com', title: 'TS Tutorial' }],
      });
      researcher.setEngine(engine);
      researcher.setLLM(manager);

      const result = await researcher.handleTask('TypeScript tutorials');
      // The LLM-enhanced query should have been used for web_search
      expect(engine.validateAndExecute).toHaveBeenCalled();
    });
  });

  describe('ExecutorAgent with LLM', () => {
    it('should create plans without LLM (heuristic)', async () => {
      const executor = new ExecutorAgent({ id: 'executor' });
      const plan = await executor.createPlan('write a file at /tmp/test.txt');
      expect(plan.steps.some((s) => s.action === 'write_file')).toBe(true);
    });

    it('should create plans with LLM when available', async () => {
      const manager = makeMockLLMManager();
      const mock = manager.getProvider('anthropic') as MockProvider;

      mock.chatFn = async () => ({
        content: JSON.stringify({
          steps: [
            { action: 'read_file', params: { path: '/tmp/input.txt' }, description: 'Read input' },
            { action: 'write_file', params: { path: '/tmp/output.txt', content: 'processed' }, description: 'Write output' },
          ],
          description: 'Process input and write output',
          requiresApproval: true,
        }),
        toolCalls: [],
        usage: { inputTokens: 40, outputTokens: 30, totalTokens: 70 },
        model: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        finishReason: 'stop',
      });

      const executor = new ExecutorAgent({ id: 'executor' });
      executor.setLLM(manager);

      const plan = await executor.createPlan('process input.txt and save to output.txt');
      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[0].action).toBe('read_file');
      expect(plan.steps[1].action).toBe('write_file');
      expect(plan.requiresApproval).toBe(true);
    });

    it('should fall back to heuristics if LLM plan creation fails', async () => {
      const manager = makeMockLLMManager();
      const mock = manager.getProvider('anthropic') as MockProvider;

      mock.chatFn = async () => ({
        content: 'this is not valid json',
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        model: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        finishReason: 'stop',
      });

      const executor = new ExecutorAgent({ id: 'executor' });
      executor.setLLM(manager);

      const plan = await executor.createPlan('write a file at /tmp/test.txt');
      // Should fall back to heuristic plan
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.steps.some((s) => s.action === 'write_file')).toBe(true);
    });
  });
});
