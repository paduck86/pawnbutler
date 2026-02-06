// Anthropic Claude LLM Provider

import Anthropic from '@anthropic-ai/sdk';
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

export class AnthropicProvider extends LLMProvider {
  readonly name: LLMProviderName = 'anthropic';
  readonly defaultModel = 'claude-sonnet-4-5-20250929';
  private client: Anthropic;

  constructor(config: { apiKey: string; baseUrl?: string }) {
    super();
    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseUrl && { baseURL: config.baseUrl }),
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
      const { system, anthropicMessages } = this.convertMessages(messages, options?.systemPrompt);

      const response = await this.client.messages.create({
        model,
        max_tokens: options?.maxTokens ?? 4096,
        messages: anthropicMessages,
        ...(system && { system }),
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
        ...(options?.stopSequences && { stop_sequences: options.stopSequences }),
        ...(options?.tools && { tools: this.convertTools(options.tools) }),
      });

      const toolCalls: ToolCall[] = [];
      let textContent = '';

      for (const block of response.content) {
        if (block.type === 'text') {
          textContent += block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input as Record<string, unknown>,
          });
        }
      }

      const usage: TokenUsage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      };

      this.emitUsage(model, usage, Date.now() - startTime);

      let finishReason: LLMResponse['finishReason'] = 'stop';
      if (response.stop_reason === 'tool_use') finishReason = 'tool_use';
      else if (response.stop_reason === 'max_tokens') finishReason = 'max_tokens';

      return {
        content: textContent,
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
      const { system, anthropicMessages } = this.convertMessages(messages, options?.systemPrompt);

      const stream = this.client.messages.stream({
        model,
        max_tokens: options?.maxTokens ?? 4096,
        messages: anthropicMessages,
        ...(system && { system }),
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
        ...(options?.stopSequences && { stop_sequences: options.stopSequences }),
        ...(options?.tools && { tools: this.convertTools(options.tools) }),
      });

      let currentToolId = '';
      let currentToolName = '';
      let toolArgsJson = '';

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          const block = event.content_block;
          if (block.type === 'tool_use') {
            currentToolId = block.id;
            currentToolName = block.name;
            toolArgsJson = '';
            yield {
              type: 'tool_call_start',
              toolCall: { id: block.id, name: block.name },
            };
          }
        } else if (event.type === 'content_block_delta') {
          const delta = event.delta;
          if (delta.type === 'text_delta') {
            yield { type: 'text', content: delta.text };
          } else if (delta.type === 'input_json_delta') {
            toolArgsJson += delta.partial_json;
            yield {
              type: 'tool_call_delta',
              content: delta.partial_json,
            };
          }
        } else if (event.type === 'content_block_stop') {
          if (currentToolId) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(toolArgsJson || '{}');
            } catch {
              // partial JSON - best effort
            }
            yield {
              type: 'tool_call_end',
              toolCall: { id: currentToolId, name: currentToolName, arguments: args },
            };
            currentToolId = '';
            currentToolName = '';
            toolArgsJson = '';
          }
        } else if (event.type === 'message_delta') {
          const msgDelta = event as unknown as { usage?: { output_tokens: number } };
          if (msgDelta.usage) {
            yield {
              type: 'usage',
              usage: {
                inputTokens: 0,
                outputTokens: msgDelta.usage.output_tokens,
                totalTokens: msgDelta.usage.output_tokens,
              },
            };
          }
        }
      }

      const finalMessage = await stream.finalMessage();
      const usage: TokenUsage = {
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
        totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
      };
      this.emitUsage(model, usage, Date.now() - startTime);

      yield { type: 'done', usage };
    } catch (error) {
      this.emitError(error as Error, model);
      throw error;
    }
  }

  private convertMessages(
    messages: LLMMessage[],
    systemPrompt?: string
  ): {
    system: string | undefined;
    anthropicMessages: Anthropic.Messages.MessageParam[];
  } {
    let system = systemPrompt;
    const anthropicMessages: Anthropic.Messages.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        system = system ? `${system}\n\n${msg.content}` : msg.content;
        continue;
      }

      if (msg.role === 'assistant') {
        const content: Anthropic.Messages.ContentBlockParam[] = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
        }
        anthropicMessages.push({ role: 'assistant', content });
      } else if (msg.role === 'tool' && msg.toolResult) {
        anthropicMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolResult.toolCallId,
              content: msg.toolResult.content,
              ...(msg.toolResult.isError && { is_error: true }),
            },
          ],
        });
      } else {
        anthropicMessages.push({
          role: 'user',
          content: msg.content,
        });
      }
    }

    return { system, anthropicMessages };
  }

  private convertTools(tools: ToolDefinition[]): Anthropic.Messages.Tool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object' as const,
        ...tool.parameters,
      },
    }));
  }
}
