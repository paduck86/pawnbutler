import { EventEmitter } from 'node:events';
import type { AgentMessage } from './types.js';

type MessageHandler = (message: AgentMessage) => void;

export class MessageBus {
  private emitter: EventEmitter;
  private handlers: Map<string, MessageHandler>;
  private history: AgentMessage[];
  private maxHistory: number;

  constructor(maxHistory = 1000) {
    this.emitter = new EventEmitter();
    this.handlers = new Map();
    this.history = [];
    this.maxHistory = maxHistory;
  }

  send(message: AgentMessage): void {
    this.history.push(message);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    this.emitter.emit(`agent:${message.to}`, message);
  }

  broadcast(message: AgentMessage): void {
    this.history.push(message);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    for (const agentId of this.handlers.keys()) {
      if (agentId !== message.from) {
        this.emitter.emit(`agent:${agentId}`, message);
      }
    }
  }

  subscribe(agentId: string, handler: MessageHandler): void {
    this.handlers.set(agentId, handler);
    this.emitter.on(`agent:${agentId}`, handler);
  }

  unsubscribe(agentId: string): void {
    const handler = this.handlers.get(agentId);
    if (handler) {
      this.emitter.removeListener(`agent:${agentId}`, handler);
      this.handlers.delete(agentId);
    }
  }

  getHistory(agentId?: string, limit?: number): AgentMessage[] {
    let messages = this.history;
    if (agentId) {
      messages = messages.filter(
        (m) => m.from === agentId || m.to === agentId
      );
    }
    if (limit && limit > 0) {
      messages = messages.slice(-limit);
    }
    return messages;
  }

  clear(): void {
    this.emitter.removeAllListeners();
    this.handlers.clear();
    this.history = [];
  }
}
