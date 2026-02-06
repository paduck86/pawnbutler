// LLM Provider Type System

export type LLMProviderName = 'anthropic' | 'openai' | 'google' | 'local';

export interface LLMConfig {
  defaultProvider: LLMProviderName;
  defaultModel: string;
  fallbackChain: LLMProviderName[];
  maxRetries: number;
  providers: {
    anthropic?: { apiKey: string; baseUrl?: string };
    openai?: { apiKey: string; baseUrl?: string; organization?: string };
    google?: { apiKey: string };
    local?: { baseUrl: string; model?: string };
  };
}

export type LLMMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface LLMMessage {
  role: LLMMessageRole;
  content: string;
  toolCalls?: ToolCall[];
  toolResult?: ToolResult;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface LLMRequestOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  stopSequences?: string[];
  systemPrompt?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LLMResponse {
  content: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  model: string;
  provider: LLMProviderName;
  finishReason: 'stop' | 'tool_use' | 'max_tokens' | 'error';
}

export interface StreamChunk {
  type: 'text' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_end' | 'usage' | 'done';
  content?: string;
  toolCall?: Partial<ToolCall>;
  usage?: TokenUsage;
}

export interface ModelInfo {
  id: string;
  provider: LLMProviderName;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputCostPer1kTokens: number;
  outputCostPer1kTokens: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsVision: boolean;
}

export interface UsageRecord {
  timestamp: number;
  provider: LLMProviderName;
  model: string;
  usage: TokenUsage;
  estimatedCost: number;
  durationMs: number;
}
