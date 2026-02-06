// PawnButler Channel Adapter - Abstract base for bidirectional messaging channels

import { EventEmitter } from 'node:events';
import type {
  Channel,
  ChannelStatus,
  IncomingMessage,
  OutgoingMessage,
  MessageCallback,
} from './types.js';

export abstract class ChannelAdapter extends EventEmitter {
  protected status: ChannelStatus = 'disconnected';
  protected messageCallbacks: MessageCallback[] = [];
  public abstract readonly channel: Channel;

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract sendMessage(msg: OutgoingMessage): Promise<string>;
  abstract formatForChannel(text: string): string;

  onMessage(callback: MessageCallback): void {
    this.messageCallbacks.push(callback);
  }

  removeMessageCallback(callback: MessageCallback): void {
    this.messageCallbacks = this.messageCallbacks.filter((cb) => cb !== callback);
  }

  getStatus(): ChannelStatus {
    return this.status;
  }

  protected setStatus(status: ChannelStatus): void {
    const previous = this.status;
    this.status = status;
    if (previous !== status) {
      this.emit('status', { channel: this.channel, status, previous });
    }
  }

  protected dispatchIncoming(message: IncomingMessage): void {
    for (const callback of this.messageCallbacks) {
      callback(message);
    }
    this.emit('message', message);
  }
}
