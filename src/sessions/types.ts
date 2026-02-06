// Session Management Types

import type { LLMMessageRole } from '../llm/types.js';

export type SessionStatus = 'active' | 'paused' | 'completed' | 'expired';

export interface SessionMessage {
  role: LLMMessageRole;
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  toolResult?: { toolCallId: string; content: string; isError?: boolean };
  timestamp: number;
}

export interface Session {
  id: string;
  agentId: string;
  messages: SessionMessage[];
  createdAt: number;
  updatedAt: number;
  status: SessionStatus;
  metadata?: Record<string, unknown>;
}

export interface SessionConfig {
  maxMessages: number;
  contextWindow: number;
  pruningStrategy: 'sliding_window' | 'summarize' | 'none';
  storePath: string;
}
