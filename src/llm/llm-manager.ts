// LLM Manager - Provider initialization, selection, fallback chain, usage tracking

import { EventEmitter } from 'events';
import type {
  LLMConfig,
  LLMProviderName,
  LLMMessage,
  LLMRequestOptions,
  LLMResponse,
  StreamChunk,
  UsageRecord,
  TokenUsage,
} from './types.js';
import { LLMProvider } from './provider.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { GoogleProvider } from './google.js';
import { LocalProvider } from './local.js';
import { ModelRegistry } from './model-registry.js';
import { DEFAULT_SECRET_PATTERNS } from '../config/default-config.js';

const SECRET_REGEXPS: RegExp[] = DEFAULT_SECRET_PATTERNS.map((p) => new RegExp(p));

export class LLMManager extends EventEmitter {
  private providers = new Map<LLMProviderName, LLMProvider>();
  private config: LLMConfig;
  private registry: ModelRegistry;
  private usageHistory: UsageRecord[] = [];

  constructor(config: LLMConfig) {
    super();
    this.config = config;
    this.registry = new ModelRegistry();
    this.initProviders();
  }

  private initProviders(): void {
    const { providers } = this.config;

    if (providers.anthropic?.apiKey) {
      const provider = new AnthropicProvider(providers.anthropic);
      this.wireProviderEvents(provider);
      this.providers.set('anthropic', provider);
    }

    if (providers.openai?.apiKey) {
      const provider = new OpenAIProvider(providers.openai);
      this.wireProviderEvents(provider);
      this.providers.set('openai', provider);
    }

    if (providers.google?.apiKey) {
      const provider = new GoogleProvider(providers.google);
      this.wireProviderEvents(provider);
      this.providers.set('google', provider);
    }

    if (providers.local) {
      const provider = new LocalProvider(providers.local);
      this.wireProviderEvents(provider);
      this.providers.set('local', provider);
    }
  }

  private wireProviderEvents(provider: LLMProvider): void {
    provider.on('usage', (data) => {
      const cost = this.registry.estimateCost(
        data.model,
        data.usage.inputTokens,
        data.usage.outputTokens
      );
      const record: UsageRecord = {
        timestamp: data.timestamp,
        provider: data.provider,
        model: data.model,
        usage: data.usage,
        estimatedCost: cost,
        durationMs: data.durationMs,
      };
      this.usageHistory.push(record);
      this.emit('usage', record);
    });

    provider.on('llm_error', (data) => {
      this.emit('llm_error', data);
    });

    provider.on('request', (data) => {
      this.emit('request', data);
    });
  }

  getProvider(name?: LLMProviderName): LLMProvider | undefined {
    return this.providers.get(name ?? this.config.defaultProvider);
  }

  getRegistry(): ModelRegistry {
    return this.registry;
  }

  /**
   * Scan messages for secret patterns and emit a warning event.
   * Returns the matched pattern sources (empty array = clean).
   */
  scanMessagesForSecrets(messages: LLMMessage[]): string[] {
    const found: string[] = [];
    for (const msg of messages) {
      if (!msg.content) continue;
      for (const pattern of SECRET_REGEXPS) {
        if (pattern.test(msg.content)) {
          found.push(pattern.source);
        }
      }
    }
    if (found.length > 0) {
      this.emit('secret_warning', {
        patterns: found,
        timestamp: Date.now(),
      });
    }
    return found;
  }

  async chat(
    messages: LLMMessage[],
    options?: LLMRequestOptions & { provider?: LLMProviderName }
  ): Promise<LLMResponse> {
    this.scanMessagesForSecrets(messages);

    const providerName = options?.provider ?? this.config.defaultProvider;
    const chain = [providerName, ...this.config.fallbackChain.filter((p) => p !== providerName)];

    let lastError: Error | undefined;

    for (const name of chain) {
      const provider = this.providers.get(name);
      if (!provider) continue;

      for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
        try {
          return await provider.chat(messages, options);
        } catch (error) {
          lastError = error as Error;
          this.emit('retry', {
            provider: name,
            attempt: attempt + 1,
            error: lastError.message,
          });
          if (attempt < this.config.maxRetries) {
            await this.delay(Math.min(1000 * 2 ** attempt, 10000));
          }
        }
      }
    }

    throw lastError ?? new Error('No LLM providers available');
  }

  async *stream(
    messages: LLMMessage[],
    options?: LLMRequestOptions & { provider?: LLMProviderName }
  ): AsyncGenerator<StreamChunk> {
    this.scanMessagesForSecrets(messages);

    const providerName = options?.provider ?? this.config.defaultProvider;
    const chain = [providerName, ...this.config.fallbackChain.filter((p) => p !== providerName)];

    let lastError: Error | undefined;

    for (const name of chain) {
      const provider = this.providers.get(name);
      if (!provider) continue;

      try {
        yield* provider.stream(messages, options);
        return;
      } catch (error) {
        lastError = error as Error;
        this.emit('fallback', {
          from: name,
          error: lastError.message,
        });
      }
    }

    throw lastError ?? new Error('No LLM providers available');
  }

  getUsageHistory(): UsageRecord[] {
    return [...this.usageHistory];
  }

  getUsageSummary(): {
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    callCount: number;
    byProvider: Record<string, { cost: number; calls: number }>;
  } {
    const summary = {
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      callCount: this.usageHistory.length,
      byProvider: {} as Record<string, { cost: number; calls: number }>,
    };

    for (const record of this.usageHistory) {
      summary.totalCost += record.estimatedCost;
      summary.totalInputTokens += record.usage.inputTokens;
      summary.totalOutputTokens += record.usage.outputTokens;

      if (!summary.byProvider[record.provider]) {
        summary.byProvider[record.provider] = { cost: 0, calls: 0 };
      }
      summary.byProvider[record.provider].cost += record.estimatedCost;
      summary.byProvider[record.provider].calls += 1;
    }

    return summary;
  }

  clearUsageHistory(): void {
    this.usageHistory = [];
  }

  getAvailableProviders(): LLMProviderName[] {
    return Array.from(this.providers.keys());
  }

  /** Register an external provider instance (useful for testing) */
  registerProvider(name: LLMProviderName, provider: LLMProvider): void {
    this.wireProviderEvents(provider);
    this.providers.set(name, provider);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
