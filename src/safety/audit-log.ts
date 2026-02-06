// PawnButler Audit Log - Structured logging for all agent actions

import { appendFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  AuditEntry,
  AuditLogConfig,
  AgentRole,
  ActionType,
  SafetyLevel,
} from '../core/types.js';

interface AuditQueryFilter {
  agentId?: string;
  actionType?: ActionType;
  safetyLevel?: SafetyLevel;
  from?: number;
  to?: number;
}

interface AuditSummary {
  total: number;
  byAgent: Record<string, number>;
  byAction: Record<string, number>;
  byLevel: Record<string, number>;
  blocked: number;
  alerts: number;
}

export class AuditLog {
  private logPath: string;
  private alertLogPath: string;
  private config: AuditLogConfig;

  constructor(config: AuditLogConfig) {
    this.config = config;
    this.logPath = config.logPath;
    this.alertLogPath = config.alertLogPath;

    if (config.enabled) {
      mkdirSync(dirname(this.logPath), { recursive: true });
      mkdirSync(dirname(this.alertLogPath), { recursive: true });
    }
  }

  log(entry: AuditEntry): void {
    if (!this.config.enabled) return;

    const line = JSON.stringify(entry) + '\n';
    appendFileSync(this.logPath, line, 'utf-8');
  }

  logAlert(entry: AuditEntry, alertMessage: string): void {
    if (!this.config.enabled) return;

    // Write to main log
    this.log(entry);

    // Write to alert log with extra context
    const alertEntry = { ...entry, alertMessage, isAlert: true };
    const line = JSON.stringify(alertEntry) + '\n';
    appendFileSync(this.alertLogPath, line, 'utf-8');
  }

  query(filter: AuditQueryFilter): AuditEntry[] {
    const entries = this.readEntries(this.logPath);

    return entries.filter((entry) => {
      if (filter.agentId && entry.agentId !== filter.agentId) return false;
      if (filter.actionType && entry.actionType !== filter.actionType) return false;
      if (filter.safetyLevel && entry.safetyLevel !== filter.safetyLevel) return false;
      if (filter.from && entry.timestamp < filter.from) return false;
      if (filter.to && entry.timestamp > filter.to) return false;
      return true;
    });
  }

  getRecentAlerts(limit = 20): AuditEntry[] {
    const entries = this.readEntries(this.alertLogPath);
    return entries.slice(-limit);
  }

  getSummary(): AuditSummary {
    const entries = this.readEntries(this.logPath);

    const summary: AuditSummary = {
      total: entries.length,
      byAgent: {},
      byAction: {},
      byLevel: {},
      blocked: 0,
      alerts: 0,
    };

    for (const entry of entries) {
      summary.byAgent[entry.agentId] = (summary.byAgent[entry.agentId] ?? 0) + 1;
      summary.byAction[entry.actionType] = (summary.byAction[entry.actionType] ?? 0) + 1;
      summary.byLevel[entry.safetyLevel] = (summary.byLevel[entry.safetyLevel] ?? 0) + 1;

      if (entry.result === 'blocked') {
        summary.blocked++;
      }
    }

    const alertEntries = this.readEntries(this.alertLogPath);
    summary.alerts = alertEntries.length;

    return summary;
  }

  private readEntries(filePath: string): AuditEntry[] {
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      return [];
    }

    return content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as AuditEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is AuditEntry => entry !== null);
  }
}
