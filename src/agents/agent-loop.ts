// Agent Loop - ReAct (Reasoning + Acting) pattern implementation

import { EventEmitter } from 'events';
import type { LLMManager } from '../llm/llm-manager.js';
import type { LLMMessage, LLMRequestOptions, LLMResponse, ToolCall, ToolDefinition } from '../llm/types.js';
import type { SessionManager } from '../sessions/session-manager.js';
import type { SessionMessage } from '../sessions/types.js';
import { ContextPruner } from '../sessions/context-pruning.js';

export type LoopStepType = 'llm_call' | 'tool_call' | 'tool_result' | 'response' | 'error' | 'pruning';

export interface LoopStep {
  type: LoopStepType;
  iteration: number;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface AgentLoopConfig {
  maxIterations: number;
  systemPrompt: string;
  tools: ToolDefinition[];
  contextWindow?: number;
  model?: string;
}

export interface ToolExecutor {
  (name: string, args: Record<string, unknown>): Promise<{ content: string; isError?: boolean }>;
}

export interface AgentLoopResult {
  content: string;
  steps: LoopStep[];
  iterations: number;
  sessionId: string;
  finishReason: 'completed' | 'max_iterations' | 'error';
}

export class AgentLoop extends EventEmitter {
  private llm: LLMManager;
  private sessions: SessionManager;
  private pruner: ContextPruner;
  private config: AgentLoopConfig;
  private executeTool: ToolExecutor;

  constructor(
    llm: LLMManager,
    sessions: SessionManager,
    executeTool: ToolExecutor,
    config: AgentLoopConfig
  ) {
    super();
    this.llm = llm;
    this.sessions = sessions;
    this.executeTool = executeTool;
    this.config = config;
    this.pruner = new ContextPruner(config.contextWindow ?? 128000);
  }

  async run(
    userMessage: string,
    sessionId: string,
    context?: Record<string, unknown>
  ): Promise<AgentLoopResult> {
    const steps: LoopStep[] = [];
    let iteration = 0;

    // Add user message to session
    this.sessions.addMessage(sessionId, {
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    });

    // Convert tools to LLM format
    const llmTools = this.config.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    try {
      while (iteration < this.config.maxIterations) {
        iteration++;

        // 1. Get current messages and prune if needed
        let messages = this.sessions.toLLMMessages(sessionId);
        const totalTokens = this.pruner.estimateTotalTokens(
          messages.map((m) => ({ ...m, timestamp: 0 })) as SessionMessage[]
        );

        if (totalTokens > (this.config.contextWindow ?? 128000) * 0.8) {
          const pruned = this.pruner.pruneSlidingWindow(
            messages.map((m) => ({ ...m, timestamp: 0 })) as SessionMessage[]
          );
          if (pruned.pruned) {
            messages = pruned.messages.map((m) => ({
              role: m.role,
              content: m.content,
              toolCalls: m.toolCalls,
              toolResult: m.toolResult,
            }));
            this.emitStep(steps, 'pruning', iteration, {
              removedCount: pruned.removedCount,
            });
          }
        }

        // 2. Call LLM
        this.emitStep(steps, 'llm_call', iteration, {
          messageCount: messages.length,
          hasTools: llmTools.length > 0,
        });

        const requestOptions: LLMRequestOptions = {
          systemPrompt: this.config.systemPrompt,
          ...(this.config.model && { model: this.config.model }),
          ...(llmTools.length > 0 && { tools: llmTools }),
        };

        let response: LLMResponse;
        try {
          response = await this.llm.chat(messages, requestOptions);
        } catch (error) {
          this.emitStep(steps, 'error', iteration, {
            error: (error as Error).message,
          });
          return {
            content: `Error: ${(error as Error).message}`,
            steps,
            iterations: iteration,
            sessionId,
            finishReason: 'error',
          };
        }

        // 3. Process response
        if (response.finishReason === 'tool_use' && response.toolCalls.length > 0) {
          // Add assistant message with tool calls to session
          this.sessions.addMessage(sessionId, {
            role: 'assistant',
            content: response.content,
            toolCalls: response.toolCalls.map((tc) => ({
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
            })),
            timestamp: Date.now(),
          });

          // Execute each tool call
          for (const toolCall of response.toolCalls) {
            this.emitStep(steps, 'tool_call', iteration, {
              toolName: toolCall.name,
              toolId: toolCall.id,
              arguments: toolCall.arguments,
            });

            const result = await this.executeTool(toolCall.name, toolCall.arguments);

            this.emitStep(steps, 'tool_result', iteration, {
              toolName: toolCall.name,
              toolId: toolCall.id,
              isError: result.isError,
              contentLength: result.content.length,
            });

            // Add tool result to session
            this.sessions.addMessage(sessionId, {
              role: 'tool',
              content: '',
              toolResult: {
                toolCallId: toolCall.id,
                content: result.content,
                isError: result.isError,
              },
              timestamp: Date.now(),
            });
          }

          // Continue loop for next LLM call
          continue;
        }

        // 4. Text response - loop complete
        this.sessions.addMessage(sessionId, {
          role: 'assistant',
          content: response.content,
          timestamp: Date.now(),
        });

        this.emitStep(steps, 'response', iteration, {
          contentLength: response.content.length,
          finishReason: response.finishReason,
        });

        return {
          content: response.content,
          steps,
          iterations: iteration,
          sessionId,
          finishReason: 'completed',
        };
      }

      // Max iterations reached
      return {
        content: 'Maximum iterations reached. The task may require more steps than allowed.',
        steps,
        iterations: iteration,
        sessionId,
        finishReason: 'max_iterations',
      };
    } catch (error) {
      this.emitStep(steps, 'error', 0, { error: (error as Error).message });
      return {
        content: `Error: ${(error as Error).message}`,
        steps,
        iterations: iteration,
        sessionId,
        finishReason: 'error',
      };
    }
  }

  private emitStep(
    steps: LoopStep[],
    type: LoopStepType,
    iteration: number,
    data: Record<string, unknown>
  ): void {
    const step: LoopStep = {
      type,
      iteration,
      timestamp: Date.now(),
      data,
    };
    steps.push(step);
    this.emit('step', step);
  }
}
