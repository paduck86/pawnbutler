// PawnButler Tool Events - Transparency event emitter for tool executions

import { EventEmitter } from 'node:events';

export interface ToolEvent {
  timestamp: number;
  toolName: string;
  phase: 'start' | 'complete' | 'error';
  params?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

class ToolEventBus extends EventEmitter {
  emitStart(toolName: string, params: Record<string, unknown>): void {
    const event: ToolEvent = {
      timestamp: Date.now(),
      toolName,
      phase: 'start',
      params,
    };
    this.emit('tool:start', event);
    this.emit('tool:event', event);
  }

  emitComplete(toolName: string, result: unknown, durationMs: number): void {
    const event: ToolEvent = {
      timestamp: Date.now(),
      toolName,
      phase: 'complete',
      result,
      durationMs,
    };
    this.emit('tool:complete', event);
    this.emit('tool:event', event);
  }

  emitError(toolName: string, error: string, durationMs: number): void {
    const event: ToolEvent = {
      timestamp: Date.now(),
      toolName,
      phase: 'error',
      error,
      durationMs,
    };
    this.emit('tool:error', event);
    this.emit('tool:event', event);
  }
}

export const toolEvents = new ToolEventBus();
