// PawnButler Channel Provider - Abstract base class for notification channels

import type { ApprovalNotification, ApprovalResponse } from './types.js';

export abstract class ChannelProvider {
  protected defaultTimeout: number;

  constructor(defaultTimeout = 60_000) {
    this.defaultTimeout = defaultTimeout;
  }

  abstract sendApprovalRequest(notification: ApprovalNotification): Promise<string>;

  abstract listenForResponse(requestId: string, timeout?: number): Promise<ApprovalResponse>;

  abstract sendAlert(message: string): Promise<void>;

  abstract formatMessage(notification: ApprovalNotification): string;

  destroy(): void {
    // Override in subclasses for cleanup
  }

  protected createTimeoutRejection(requestId: string): ApprovalResponse {
    return {
      requestId,
      approved: false,
      respondedBy: 'system:timeout',
      respondedAt: Date.now(),
      reason: 'Approval timed out - auto-rejected (fail-safe)',
    };
  }
}
