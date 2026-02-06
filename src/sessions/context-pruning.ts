// Context Pruning - Manage conversation context within token limits

import type { SessionMessage } from './types.js';
import type { LLMManager } from '../llm/llm-manager.js';

export interface PruningResult {
  messages: SessionMessage[];
  pruned: boolean;
  removedCount: number;
  summary?: string;
}

export class ContextPruner {
  private maxTokens: number;
  private reserveTokens: number;

  constructor(contextWindow: number, reserveTokens = 4096) {
    this.maxTokens = contextWindow;
    this.reserveTokens = reserveTokens;
  }

  /** Estimate token count for a message (rough: ~4 chars per token) */
  estimateTokens(message: SessionMessage): number {
    let chars = message.content.length;
    if (message.toolCalls) {
      chars += JSON.stringify(message.toolCalls).length;
    }
    if (message.toolResult) {
      chars += message.toolResult.content.length;
    }
    return Math.ceil(chars / 4);
  }

  /** Estimate total tokens for all messages */
  estimateTotalTokens(messages: SessionMessage[]): number {
    return messages.reduce((sum, m) => sum + this.estimateTokens(m), 0);
  }

  /** Sliding window pruning: keep system messages + most recent messages within token limit */
  pruneSlidingWindow(messages: SessionMessage[]): PruningResult {
    const budget = this.maxTokens - this.reserveTokens;
    if (budget <= 0) {
      return { messages: [], pruned: true, removedCount: messages.length };
    }

    // Separate system messages from the rest
    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystem = messages.filter((m) => m.role !== 'system');

    const systemTokens = this.estimateTotalTokens(systemMessages);
    let remainingBudget = budget - systemTokens;

    if (remainingBudget <= 0) {
      return { messages: systemMessages, pruned: true, removedCount: nonSystem.length };
    }

    // Work backwards from the end, preserving tool call/result pairs
    const kept: SessionMessage[] = [];
    const paired = this.getToolPairIndices(nonSystem);

    for (let i = nonSystem.length - 1; i >= 0; i--) {
      const msg = nonSystem[i];
      const tokens = this.estimateTokens(msg);

      if (tokens > remainingBudget) break;

      // If this is a tool result, also include the preceding tool call
      if (paired.has(i)) {
        const pairIdx = paired.get(i)!;
        const pairMsg = nonSystem[pairIdx];
        const pairTokens = this.estimateTokens(pairMsg);

        if (tokens + pairTokens > remainingBudget) break;

        kept.unshift(msg);
        if (!kept.includes(pairMsg)) {
          kept.unshift(pairMsg);
          remainingBudget -= pairTokens;
        }
        remainingBudget -= tokens;
      } else {
        kept.unshift(msg);
        remainingBudget -= tokens;
      }
    }

    const result = [...systemMessages, ...kept];
    return {
      messages: result,
      pruned: result.length < messages.length,
      removedCount: messages.length - result.length,
    };
  }

  /** Summarize-and-prune: summarize old messages using LLM, then keep summary + recent */
  async pruneSummarize(
    messages: SessionMessage[],
    llm: LLMManager
  ): Promise<PruningResult> {
    const budget = this.maxTokens - this.reserveTokens;
    const totalTokens = this.estimateTotalTokens(messages);

    if (totalTokens <= budget) {
      return { messages, pruned: false, removedCount: 0 };
    }

    // Separate system and non-system
    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystem = messages.filter((m) => m.role !== 'system');

    if (nonSystem.length <= 4) {
      // Too few messages to summarize, fall back to sliding window
      return this.pruneSlidingWindow(messages);
    }

    // Split: old messages to summarize, recent messages to keep
    const splitPoint = Math.floor(nonSystem.length * 0.6);
    const oldMessages = nonSystem.slice(0, splitPoint);
    const recentMessages = nonSystem.slice(splitPoint);

    // Generate summary of old messages
    const oldText = oldMessages
      .map((m) => `[${m.role}]: ${m.content}`)
      .join('\n');

    try {
      const response = await llm.chat([
        {
          role: 'system',
          content: 'Summarize the following conversation concisely. Preserve key facts, decisions, tool results, and user preferences. Output only the summary.',
        },
        { role: 'user', content: oldText },
      ], { maxTokens: 500, temperature: 0 });

      const summaryMessage: SessionMessage = {
        role: 'system',
        content: `[Previous conversation summary]: ${response.content}`,
        timestamp: Date.now(),
      };

      const result = [...systemMessages, summaryMessage, ...recentMessages];
      return {
        messages: result,
        pruned: true,
        removedCount: oldMessages.length,
        summary: response.content,
      };
    } catch {
      // Fall back to sliding window if LLM summarization fails
      return this.pruneSlidingWindow(messages);
    }
  }

  /** Get pairs of tool call assistant messages and their corresponding tool result messages */
  private getToolPairIndices(messages: SessionMessage[]): Map<number, number> {
    const pairs = new Map<number, number>();

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === 'tool' && msg.toolResult) {
        // Find the preceding assistant message with matching tool call
        for (let j = i - 1; j >= 0; j--) {
          if (
            messages[j].role === 'assistant' &&
            messages[j].toolCalls?.some((tc) => tc.id === msg.toolResult!.toolCallId)
          ) {
            pairs.set(i, j); // tool result -> assistant tool call
            pairs.set(j, i); // assistant tool call -> tool result
            break;
          }
        }
      }
    }

    return pairs;
  }
}
