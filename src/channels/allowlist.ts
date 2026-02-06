// PawnButler Sender Allowlist - Controls who can interact with the agent via channels

import type { Channel, AllowedSendersConfig, PairingRequest } from './types.js';

export class SenderAllowlist {
  private allowedSenders: Map<Channel, Set<string>>;
  private pendingPairings: Map<string, PairingRequest> = new Map();
  private pairingTtlMs: number;

  constructor(config: AllowedSendersConfig, pairingTtlMs = 300_000) {
    this.pairingTtlMs = pairingTtlMs;
    this.allowedSenders = new Map([
      ['whatsapp', new Set(config.whatsapp)],
      ['telegram', new Set(config.telegram)],
      ['discord', new Set(config.discord)],
      ['slack', new Set(config.slack)],
    ]);
  }

  isAllowed(channel: Channel, senderId: string): boolean {
    const channelSet = this.allowedSenders.get(channel);
    return channelSet?.has(senderId) ?? false;
  }

  generatePairingCode(channel: Channel, senderId: string, senderName: string): string {
    const code = String(Math.floor(100_000 + Math.random() * 900_000));
    const now = Date.now();

    this.pendingPairings.set(code, {
      code,
      channel,
      senderId,
      senderName,
      createdAt: now,
      expiresAt: now + this.pairingTtlMs,
    });

    return code;
  }

  validatePairingCode(code: string): PairingRequest | null {
    const request = this.pendingPairings.get(code);
    if (!request) return null;

    if (Date.now() >= request.expiresAt) {
      this.pendingPairings.delete(code);
      return null;
    }

    return request;
  }

  confirmPairing(code: string): boolean {
    const request = this.validatePairingCode(code);
    if (!request) return false;

    const channelSet = this.allowedSenders.get(request.channel);
    if (channelSet) {
      channelSet.add(request.senderId);
    }

    this.pendingPairings.delete(code);
    return true;
  }

  addSender(channel: Channel, senderId: string): void {
    const channelSet = this.allowedSenders.get(channel);
    if (channelSet) {
      channelSet.add(senderId);
    }
  }

  removeSender(channel: Channel, senderId: string): void {
    const channelSet = this.allowedSenders.get(channel);
    if (channelSet) {
      channelSet.delete(senderId);
    }
  }

  getAllowed(channel: Channel): string[] {
    const channelSet = this.allowedSenders.get(channel);
    return channelSet ? [...channelSet] : [];
  }

  getPendingPairings(): PairingRequest[] {
    const now = Date.now();
    const valid: PairingRequest[] = [];
    for (const [code, request] of this.pendingPairings) {
      if (now >= request.expiresAt) {
        this.pendingPairings.delete(code);
      } else {
        valid.push(request);
      }
    }
    return valid;
  }

  clearExpiredPairings(): number {
    const now = Date.now();
    let cleared = 0;
    for (const [code, request] of this.pendingPairings) {
      if (now >= request.expiresAt) {
        this.pendingPairings.delete(code);
        cleared++;
      }
    }
    return cleared;
  }
}
