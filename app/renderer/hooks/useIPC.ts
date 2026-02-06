// PawnButler IPC Client - Typed wrapper for window.pawnbutler API
// Provides a centralized, type-safe interface for renderer<->main IPC communication.
// Designed as a utility module (the app uses vanilla TS, not React).

export interface AgentStatusInfo {
  id: string;
  role: string;
  name: string;
  status: 'idle' | 'working' | 'waiting' | 'stopped';
  currentTask?: string;
  stats?: { totalChecks?: number; blocked?: number; alerts?: number };
}

export interface AuditEntryInfo {
  timestamp: number;
  agentId: string;
  agentRole: string;
  actionType: string;
  safetyLevel: string;
  approvalStatus: string;
  params: Record<string, unknown>;
  result: 'success' | 'blocked' | 'error';
  details?: string;
}

export interface AuditSummaryInfo {
  totalActions: number;
  blockedCount: number;
  byAgent: Record<string, number>;
}

export interface ApprovalItemInfo {
  actionRequest: {
    id: string;
    agentId: string;
    agentRole: string;
    actionType: string;
    params: Record<string, unknown>;
    safetyLevel: string;
    timestamp: number;
    requiresApproval: boolean;
  };
  status: string;
  reviewedBy?: string;
  reviewedAt?: number;
  reason?: string;
}

export interface ConfigInfo {
  agents: Array<{
    id: string;
    role: string;
    name: string;
    allowedTools: string[];
    deniedTools: string[];
  }>;
  urlAllowlist: string[];
  urlBlocklist: string[];
  [key: string]: unknown;
}

type EventChannel = 'agents:updated' | 'approval:new' | 'audit:alert' | 'guardian:blocked';

/**
 * Returns the IPC API exposed by the preload script.
 * Falls back to null if not running inside Electron.
 */
function getAPI(): typeof window.pawnbutler | null {
  if (typeof window !== 'undefined' && window.pawnbutler) {
    return window.pawnbutler;
  }
  return null;
}

/**
 * IPCClient wraps the preload-exposed IPC bridge with error handling
 * and provides a single entry point for all renderer->main communication.
 */
export class IPCClient {
  private api = getAPI();

  get isConnected(): boolean {
    return this.api !== null;
  }

  // --- Agents ---
  async getAgentStatus(): Promise<AgentStatusInfo[]> {
    if (!this.api) return [];
    try {
      return (await this.api.agents.getStatus()) as AgentStatusInfo[];
    } catch {
      return [];
    }
  }

  // --- Audit ---
  async queryAuditLog(filter: Record<string, unknown> = {}): Promise<AuditEntryInfo[]> {
    if (!this.api) return [];
    try {
      return (await this.api.audit.query(filter)) as AuditEntryInfo[];
    } catch {
      return [];
    }
  }

  async getAlerts(limit = 20): Promise<AuditEntryInfo[]> {
    if (!this.api) return [];
    try {
      return (await this.api.audit.getAlerts(limit)) as AuditEntryInfo[];
    } catch {
      return [];
    }
  }

  async getAuditSummary(): Promise<AuditSummaryInfo | null> {
    if (!this.api) return null;
    try {
      return (await this.api.audit.getSummary()) as AuditSummaryInfo;
    } catch {
      return null;
    }
  }

  // --- Approvals ---
  async listApprovals(): Promise<ApprovalItemInfo[]> {
    if (!this.api) return [];
    try {
      return (await this.api.approval.list()) as ApprovalItemInfo[];
    } catch {
      return [];
    }
  }

  async approveAction(id: string): Promise<boolean> {
    if (!this.api) return false;
    try {
      await this.api.approval.approve(id);
      return true;
    } catch {
      return false;
    }
  }

  async rejectAction(id: string, reason: string): Promise<boolean> {
    if (!this.api) return false;
    try {
      await this.api.approval.reject(id, reason);
      return true;
    } catch {
      return false;
    }
  }

  // --- Config ---
  async getConfig(): Promise<ConfigInfo | null> {
    if (!this.api) return null;
    try {
      return (await this.api.config.get()) as ConfigInfo;
    } catch {
      return null;
    }
  }

  async updateConfig(updates: Record<string, unknown>): Promise<boolean> {
    if (!this.api) return false;
    try {
      await this.api.config.update(updates);
      return true;
    } catch {
      return false;
    }
  }

  // --- URL management ---
  async getUrlAllowlist(): Promise<string[]> {
    if (!this.api) return [];
    try {
      return await this.api.url.getAllowlist();
    } catch {
      return [];
    }
  }

  async addAllowedDomain(domain: string): Promise<boolean> {
    if (!this.api) return false;
    try {
      await this.api.url.addAllowed(domain);
      return true;
    } catch {
      return false;
    }
  }

  async getUrlBlocklist(): Promise<string[]> {
    if (!this.api) return [];
    try {
      return await this.api.url.getBlocklist();
    } catch {
      return [];
    }
  }

  async addBlockedPattern(pattern: string): Promise<boolean> {
    if (!this.api) return false;
    try {
      await this.api.url.addBlocked(pattern);
      return true;
    } catch {
      return false;
    }
  }

  // --- Vault ---
  async getVaultKeys(): Promise<string[]> {
    if (!this.api) return [];
    try {
      return await this.api.vault.getKeys();
    } catch {
      return [];
    }
  }

  // --- Guardian ---
  async getGuardianStatus(): Promise<{ totalChecks: number; blocked: number; alerts: number } | null> {
    if (!this.api) return null;
    try {
      return (await this.api.guardian.getStatus()) as { totalChecks: number; blocked: number; alerts: number };
    } catch {
      return null;
    }
  }

  // --- User requests ---
  async sendUserRequest(message: string): Promise<boolean> {
    if (!this.api) return false;
    try {
      await this.api.user.sendRequest(message);
      return true;
    } catch {
      return false;
    }
  }

  // --- Events ---
  on(channel: EventChannel, callback: (...args: unknown[]) => void): void {
    this.api?.on(channel, callback);
  }

  off(channel: EventChannel, callback: (...args: unknown[]) => void): void {
    this.api?.off(channel, callback);
  }
}

/**
 * Singleton IPC client instance.
 * Import and use across the renderer process.
 */
export const ipcClient = new IPCClient();

/**
 * Simple polling helper - calls a function at a regular interval
 * and returns a stop function.
 */
export function startPolling(
  fn: () => Promise<void>,
  intervalMs: number,
): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  fn(); // initial call
  timer = setInterval(() => {
    fn().catch(() => {/* silently ignore poll errors */});
  }, intervalMs);

  return () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
