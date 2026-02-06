// Google Gemini LLM Provider

import { GoogleGenerativeAI, type Content, type Part, type Tool, type FunctionDeclaration } from '@google/generative-ai';
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

export class GoogleProvider extends LLMProvider {
  readonly name: LLMProviderName = 'google';
  readonly defaultModel = 'gemini-2.0-flash';
  private client: GoogleGenerativeAI;

  constructor(config: { apiKey: string }) {
    super();
    this.client = new GoogleGenerativeAI(config.apiKey);
  }

  async chat(
    messages: LLMMessage[],
    options?: LLMRequestOptions
  ): Promise<LLMResponse> {
    const model = options?.model ?? this.defaultModel;
    this.emitRequest(model, messages.length);
    const startTime = Date.now();

    try {
      const { systemInstruction, contents } = this.convertMessages(messages, options?.systemPrompt);
      const tools = options?.tools ? this.convertTools(options.tools) : undefined;

      const genModel = this.client.getGenerativeModel({
        model,
        ...(systemInstruction && { systemInstruction }),
        ...(tools && { tools }),
      });

      const result = await genModel.generateContent({
        contents,
        generationConfig: {
          ...(options?.maxTokens && { maxOutputTokens: options.maxTokens }),
          ...(options?.temperature !== undefined && { temperature: options.temperature }),
          ...(options?.stopSequences && { stopSequences: options.stopSequences }),
        },
      });

      const response = result.response;
      const toolCalls: ToolCall[] = [];
      let textContent = '';

      for (const candidate of response.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if (part.text) {
            textContent += part.text;
          }
          if (part.functionCall) {
            toolCalls.push({
              id: `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              name: part.functionCall.name,
              arguments: (part.functionCall.args ?? {}) as Record<string, unknown>,
            });
          }
        }
      }

      const usageMetadata = response.usageMetadata;
      const usage: TokenUsage = {
        inputTokens: usageMetadata?.promptTokenCount ?? 0,
        outputTokens: usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: usageMetadata?.totalTokenCount ?? 0,
      };

      this.emitUsage(model, usage, Date.now() - startTime);

      const finishReason = response.candidates?.[0]?.finishReason;
      let mappedFinish: LLMResponse['finishReason'] = 'stop';
      if (toolCalls.length > 0) mappedFinish = 'tool_use';
      else if (finishReason === 'MAX_TOKENS') mappedFinish = 'max_tokens';

      return {
        content: textContent,
        toolCalls,
        usage,
        model,
        provider: this.name,
        finishReason: mappedFinish,
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
      const { systemInstruction, contents } = this.convertMessages(messages, options?.systemPrompt);
      const tools = options?.tools ? this.convertTools(options.tools) : undefined;

      const genModel = this.client.getGenerativeModel({
        model,
        ...(systemInstruction && { systemInstruction }),
        ...(tools && { tools }),
      });

      const result = await genModel.generateContentStream({
        contents,
        generationConfig: {
          ...(options?.maxTokens && { maxOutputTokens: options.maxTokens }),
          ...(options?.temperature !== undefined && { temperature: options.temperature }),
          ...(options?.stopSequences && { stopSequences: options.stopSequences }),
        },
      });

      let finalUsage: TokenUsage | undefined;

      for await (const chunk of result.stream) {
        for (const candidate of chunk.candidates ?? []) {
          for (const part of candidate.content?.parts ?? []) {
            if (part.text) {
              yield { type: 'text', content: part.text };
            }
            if (part.functionCall) {
              const tc: ToolCall = {
                id: `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: part.functionCall.name,
                arguments: (part.functionCall.args ?? {}) as Record<string, unknown>,
              };
              yield { type: 'tool_call_start', toolCall: tc };
              yield { type: 'tool_call_end', toolCall: tc };
            }
          }
        }

        const usageMetadata = chunk.usageMetadata;
        if (usageMetadata) {
          finalUsage = {
            inputTokens: usageMetadata.promptTokenCount ?? 0,
            outputTokens: usageMetadata.candidatesTokenCount ?? 0,
            totalTokens: usageMetadata.totalTokenCount ?? 0,
          };
        }
      }

      if (finalUsage) {
        yield { type: 'usage', usage: finalUsage };
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
  ): { systemInstruction: string | undefined; contents: Content[] } {
    let systemInstruction = systemPrompt;
    const contents: Content[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = systemInstruction
          ? `${systemInstruction}\n\n${msg.content}`
          : msg.content;
        continue;
      }

      if (msg.role === 'user') {
        contents.push({
          role: 'user',
          parts: [{ text: msg.content }],
        });
      } else if (msg.role === 'assistant') {
        const parts: Part[] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: { name: tc.name, args: tc.arguments },
            });
          }
        }
        contents.push({ role: 'model', parts });
      } else if (msg.role === 'tool' && msg.toolResult) {
        contents.push({
          role: 'function',
          parts: [
            {
              functionResponse: {
                name: 'tool_response',
                response: { result: msg.toolResult.content },
              },
            },
          ],
        });
      }
    }

    return { systemInstruction, contents };
  }

  private convertTools(tools: ToolDefinition[]): Tool[] {
    const functionDeclarations: FunctionDeclaration[] = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as FunctionDeclaration['parameters'],
    }));

    return [{ functionDeclarations }];
  }
}
