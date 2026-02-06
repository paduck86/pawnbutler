// OpenAI LLM Provider

import OpenAI from 'openai';
import { LLMProvider } from './provider.js';
import type {
  LLMProviderName,
  LLMMessage,
  LLMRequestOptions,
  LLMResponse,
  StreamChunk,
  ToolCall,
  TokenUsage,
  ToolDefinition,
} from './types.js';

export class OpenAIProvider extends LLMProvider {
  readonly name: LLMProviderName = 'openai';
  readonly defaultModel = 'gpt-4o';
  private client: OpenAI;

  constructor(config: { apiKey: string; baseUrl?: string; organization?: string }) {
    super();
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseUrl && { baseURL: config.baseUrl }),
      ...(config.organization && { organization: config.organization }),
    });
  }

  async chat(
    messages: LLMMessage[],
    options?: LLMRequestOptions
  ): Promise<LLMResponse> {
    const model = options?.model ?? this.defaultModel;
    this.emitRequest(model, messages.length);
    const startTime = Date.now();

    try {
      const openaiMessages = this.convertMessages(messages, options?.systemPrompt);

      const response = await this.client.chat.completions.create({
        model,
        messages: openaiMessages,
        ...(options?.maxTokens && { max_tokens: options.maxTokens }),
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
        ...(options?.stopSequences && { stop: options.stopSequences }),
        ...(options?.tools && { tools: this.convertTools(options.tools) }),
      });

      const choice = response.choices[0];
      const toolCalls: ToolCall[] = [];

      if (choice.message.tool_calls) {
        for (const tc of choice.message.tool_calls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            // best effort
          }
          toolCalls.push({
            id: tc.id,
            name: tc.function.name,
            arguments: args,
          });
        }
      }

      const usage: TokenUsage = {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      };

      this.emitUsage(model, usage, Date.now() - startTime);

      let finishReason: LLMResponse['finishReason'] = 'stop';
      if (choice.finish_reason === 'tool_calls') finishReason = 'tool_use';
      else if (choice.finish_reason === 'length') finishReason = 'max_tokens';

      return {
        content: choice.message.content ?? '',
        toolCalls,
        usage,
        model,
        provider: this.name,
        finishReason,
      };
    } catch (error) {
      this.emitError(error as Error, model);
      throw error;
    }
  }

  async *stream(
    messages: LLMMessage[],
    options?: LLMRequestOptions
  ): AsyncGenerator<StreamChunk> {
    const model = options?.model ?? this.defaultModel;
    this.emitRequest(model, messages.length);
    const startTime = Date.now();

    try {
      const openaiMessages = this.convertMessages(messages, options?.systemPrompt);

      const stream = await this.client.chat.completions.create({
        model,
        messages: openaiMessages,
        stream: true,
        stream_options: { include_usage: true },
        ...(options?.maxTokens && { max_tokens: options.maxTokens }),
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
        ...(options?.stopSequences && { stop: options.stopSequences }),
        ...(options?.tools && { tools: this.convertTools(options.tools) }),
      });

      const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();
      let finalUsage: TokenUsage | undefined;

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) {
          // usage-only chunk at the end
          if (chunk.usage) {
            finalUsage = {
              inputTokens: chunk.usage.prompt_tokens ?? 0,
              outputTokens: chunk.usage.completion_tokens ?? 0,
              totalTokens: chunk.usage.total_tokens ?? 0,
            };
            yield { type: 'usage', usage: finalUsage };
          }
          continue;
        }

        if (delta.content) {
          yield { type: 'text', content: delta.content };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallBuffers.has(idx)) {
              toolCallBuffers.set(idx, { id: tc.id ?? '', name: tc.function?.name ?? '', args: '' });
              yield {
                type: 'tool_call_start',
                toolCall: { id: tc.id, name: tc.function?.name },
              };
            }
            const buffer = toolCallBuffers.get(idx)!;
            if (tc.function?.arguments) {
              buffer.args += tc.function.arguments;
              yield { type: 'tool_call_delta', content: tc.function.arguments };
            }
          }
        }

        if (chunk.choices?.[0]?.finish_reason) {
          // Emit completed tool calls
          for (const [, buffer] of toolCallBuffers) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(buffer.args || '{}');
            } catch {
              // partial
            }
            yield {
              type: 'tool_call_end',
              toolCall: { id: buffer.id, name: buffer.name, arguments: args },
            };
          }
          toolCallBuffers.clear();
        }
      }

      if (finalUsage) {
        this.emitUsage(model, finalUsage, Date.now() - startTime);
      }

      yield { type: 'done', usage: finalUsage };
    } catch (error) {
      this.emitError(error as Error, model);
      throw error;
    }
  }

  private convertMessages(
    messages: LLMMessage[],
    systemPrompt?: string
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === 'system') {
        result.push({ role: 'system', content: msg.content });
      } else if (msg.role === 'user') {
        result.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const toolCalls = msg.toolCalls?.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
        result.push({
          role: 'assistant',
          content: msg.content || null,
          ...(toolCalls && { tool_calls: toolCalls }),
        });
      } else if (msg.role === 'tool' && msg.toolResult) {
        result.push({
          role: 'tool',
          tool_call_id: msg.toolResult.toolCallId,
          content: msg.toolResult.content,
        });
      }
    }

    return result;
  }

  private convertTools(
    tools: ToolDefinition[]
  ): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }
}
