// PawnButler Guardian - Central safety orchestrator for all agent actions

import type {
  ActionRequest,
  ActionResult,
  ApprovalRequest,
  AuditEntry,
  PawnButlerConfig,
  SafetyLevel,
} from '../core/types.js';
import { UrlAllowlist } from './url-allowlist.js';
import { ActionClassifier } from './action-classifier.js';
import { SecretVault } from './secret-vault.js';
import { AuditLog } from './audit-log.js';
import { NotificationManager } from '../notifications/notification-manager.js';
import type {
  NotificationConfig,
  ApprovalNotification,
  NotificationChannelConfig,
} from '../notifications/types.js';

interface GuardianStatus {
  totalChecked: number;
  blocked: number;
  alerts: number;
  recentActivity: AuditEntry[];
}

export class Guardian {
  private urlAllowlist: UrlAllowlist;
  private classifier: ActionClassifier;
  private vault: SecretVault;
  private auditLog: AuditLog;
  private notificationManager: NotificationManager | null = null;
  private totalChecked = 0;
  private blockedCount = 0;

  constructor(config: PawnButlerConfig) {
    this.urlAllowlist = new UrlAllowlist({
      allow: config.urlAllowlist,
      block: config.urlBlocklist,
    });

    this.classifier = new ActionClassifier(config.safety);

    this.vault = new SecretVault(config.secretVault);

    this.auditLog = new AuditLog(config.auditLog);

    if (config.notifications?.enabled) {
      const notifConfig = config.notifications;
      const channelConfig = this.buildChannelConfig(notifConfig);
      if (channelConfig) {
        this.notificationManager = new NotificationManager({
          enabled: true,
          channelConfig,
          approvalTimeoutMs: notifConfig.approvalTimeoutMs,
          notifyOnBlocked: notifConfig.notifyOnBlocked,
        });
      }
    }
  }

  async validateAction(request: ActionRequest): Promise<ActionResult> {
    this.totalChecked++;

    const safetyLevel = this.classifier.classify(request);

    // 1. Forbidden actions are immediately blocked
    if (safetyLevel === 'forbidden') {
      return this.blockAction(request, safetyLevel, 'Action is forbidden by safety policy');
    }

    // 2. URL allowlist check for web actions
    if (request.actionType === 'web_search' || request.actionType === 'web_fetch') {
      const url = String(request.params.url ?? request.params.query ?? '');
      if (url.startsWith('http')) {
        const urlCheck = this.urlAllowlist.isAllowed(url);
        if (!urlCheck.allowed) {
          return this.blockAction(request, safetyLevel, urlCheck.reason ?? 'URL not allowed');
        }
      }
    }

    // 3. Secret leakage check
    const paramsText = JSON.stringify(request.params);
    const secretCheck = this.classifier.containsSecretPattern(paramsText);
    if (secretCheck.found) {
      return this.blockAction(
        request,
        'dangerous',
        `Potential secret exposure detected: ${secretCheck.type}`,
      );
    }

    // 4. Signup pattern check
    if (this.classifier.containsSignupPattern(request.params)) {
      return this.blockAction(request, 'forbidden', 'Signup/registration attempt detected');
    }

    // 5. Payment pattern check
    if (this.classifier.containsPaymentPattern(request.params)) {
      return this.blockAction(request, 'forbidden', 'Payment/billing attempt detected');
    }

    // 6. Handle by safety level
    if (safetyLevel === 'dangerous') {
      // If external notifications are configured, request approval via messaging channel
      if (this.notificationManager) {
        return this.requestExternalApproval(request, safetyLevel);
      }

      // Generate approval request for butler to review
      const approvalRequest: ApprovalRequest = {
        actionRequest: { ...request, safetyLevel },
        status: 'pending',
      };

      this.logEntry(request, safetyLevel, 'pending', 'success', 'Awaiting approval');

      return {
        requestId: request.id,
        success: false,
        data: approvalRequest,
        error: 'Action requires approval',
        blockedBy: 'guardian',
        blockedReason: 'Action classified as dangerous - requires butler approval',
      };
    }

    // 7. Safe and moderate actions are auto-approved
    this.logEntry(request, safetyLevel, 'auto_approved', 'success');

    return {
      requestId: request.id,
      success: true,
    };
  }

  maskSecrets(text: string): string {
    return this.vault.mask(text);
  }

  getStatus(): GuardianStatus {
    const summary = this.auditLog.getSummary();
    const recentAlerts = this.auditLog.getRecentAlerts(10);

    return {
      totalChecked: this.totalChecked,
      blocked: this.blockedCount,
      alerts: summary.alerts,
      recentActivity: recentAlerts,
    };
  }

  getUrlAllowlist(): UrlAllowlist {
    return this.urlAllowlist;
  }

  getClassifier(): ActionClassifier {
    return this.classifier;
  }

  getVault(): SecretVault {
    return this.vault;
  }

  getAuditLog(): AuditLog {
    return this.auditLog;
  }

  getNotificationManager(): NotificationManager | null {
    return this.notificationManager;
  }

  destroy(): void {
    this.notificationManager?.destroy();
  }

  private async requestExternalApproval(
    request: ActionRequest,
    safetyLevel: SafetyLevel,
  ): Promise<ActionResult> {
    const sanitizedParams = this.sanitizeParams(request.params);

    const notification: ApprovalNotification = {
      requestId: request.id,
      agentName: `${request.agentId} (${request.agentRole})`,
      actionType: request.actionType,
      safetyLevel,
      description: `Agent "${request.agentId}" wants to execute "${request.actionType}"`,
      params: sanitizedParams,
    };

    this.logEntry(request, safetyLevel, 'pending', 'success', 'Awaiting external approval');

    try {
      const response = await this.notificationManager!.requestApproval(notification);

      if (response.approved) {
        this.logEntry(request, safetyLevel, 'auto_approved', 'success',
          `Approved externally by ${response.respondedBy}`);
        return { requestId: request.id, success: true };
      }

      this.blockedCount++;
      this.logEntry(request, safetyLevel, 'auto_blocked', 'blocked',
        `Rejected externally by ${response.respondedBy}: ${response.reason ?? 'No reason given'}`);
      return {
        requestId: request.id,
        success: false,
        blockedBy: 'guardian',
        blockedReason: `Action rejected via external approval: ${response.reason ?? 'No reason given'}`,
      };
    } catch {
      // On error, fail-safe: reject
      this.blockedCount++;
      this.logEntry(request, safetyLevel, 'auto_blocked', 'blocked',
        'External approval request failed - auto-rejected (fail-safe)');
      return {
        requestId: request.id,
        success: false,
        blockedBy: 'guardian',
        blockedReason: 'External approval request failed - auto-rejected (fail-safe)',
      };
    }
  }

  private blockAction(
    request: ActionRequest,
    level: SafetyLevel,
    reason: string,
  ): ActionResult {
    this.blockedCount++;

    this.logEntry(request, level, 'auto_blocked', 'blocked', reason);

    this.auditLog.logAlert(
      this.createAuditEntry(request, level, 'auto_blocked', 'blocked', reason),
      reason,
    );

    // Notify via external channel if configured
    this.notificationManager?.notifyBlocked(request.actionType, reason).catch(() => {
      // Silently ignore notification failures for blocked action alerts
    });

    return {
      requestId: request.id,
      success: false,
      blockedBy: 'guardian',
      blockedReason: reason,
    };
  }

  private logEntry(
    request: ActionRequest,
    level: SafetyLevel,
    approvalStatus: 'auto_approved' | 'auto_blocked' | 'pending',
    result: 'success' | 'blocked' | 'error',
    details?: string,
  ): void {
    const entry = this.createAuditEntry(request, level, approvalStatus, result, details);
    this.auditLog.log(entry);
  }

  private createAuditEntry(
    request: ActionRequest,
    level: SafetyLevel,
    approvalStatus: 'auto_approved' | 'auto_blocked' | 'pending',
    result: 'success' | 'blocked' | 'error',
    details?: string,
  ): AuditEntry {
    const sanitizedParams = this.sanitizeParams(request.params);

    return {
      timestamp: Date.now(),
      agentId: request.agentId,
      agentRole: request.agentRole,
      actionType: request.actionType,
      safetyLevel: level,
      approvalStatus,
      params: sanitizedParams,
      result,
      details,
    };
  }

  private sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') {
        sanitized[key] = this.vault.mask(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  private buildChannelConfig(
    notifConfig: NonNullable<PawnButlerConfig['notifications']>,
  ): NotificationChannelConfig | null {
    switch (notifConfig.channel) {
      case 'telegram':
        if (!notifConfig.telegram) return null;
        return { channel: 'telegram', ...notifConfig.telegram };
      case 'slack':
        if (!notifConfig.slack) return null;
        return { channel: 'slack', ...notifConfig.slack };
      case 'discord':
        if (!notifConfig.discord) return null;
        return { channel: 'discord', ...notifConfig.discord };
      case 'whatsapp':
        if (!notifConfig.whatsapp) return null;
        return { channel: 'whatsapp', ...notifConfig.whatsapp };
      default:
        return null;
    }
  }
}
