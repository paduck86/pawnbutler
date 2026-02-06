// Abstract LLM Provider Base Class

import { EventEmitter } from 'events';
import type {
  LLMProviderName,
  LLMMessage,
  LLMRequestOptions,
  LLMResponse,
  StreamChunk,
  TokenUsage,
} from './types.js';

export abstract class LLMProvider extends EventEmitter {
  abstract readonly name: LLMProviderName;
  abstract readonly defaultModel: string;

  abstract chat(
    messages: LLMMessage[],
    options?: LLMRequestOptions
  ): Promise<LLMResponse>;

  abstract stream(
    messages: LLMMessage[],
    options?: LLMRequestOptions
  ): AsyncGenerator<StreamChunk>;

  protected emitUsage(model: string, usage: TokenUsage, durationMs: number): void {
    this.emit('usage', {
      provider: this.name,
      model,
      usage,
      durationMs,
      timestamp: Date.now(),
    });
  }

  protected emitError(error: Error, model: string): void {
    this.emit('llm_error', {
      provider: this.name,
      model,
      error: error.message,
      timestamp: Date.now(),
    });
  }

  protected emitRequest(model: string, messageCount: number): void {
    this.emit('request', {
      provider: this.name,
      model,
      messageCount,
      timestamp: Date.now(),
    });
  }
}
