// PawnButler IPC Handlers - Bridge between Electron renderer and core engine

import { ipcMain, type BrowserWindow } from 'electron';
import type { PawnButlerEngine } from '../../src/core/engine.js';
import type { Guardian } from '../../src/safety/guardian.js';
import type { ButlerAgent } from '../../src/agents/butler.js';

export function registerIPCHandlers(
  engine: PawnButlerEngine,
  guardian: Guardian,
  butler: ButlerAgent,
  getMainWindow: () => BrowserWindow | null,
): void {
  // --- Agent status ---
  ipcMain.handle('agents:status', async () => {
    const config = engine.getConfig();
    const statuses = config.agents.map((agentConfig) => {
      const agent = engine.getAgent(agentConfig.id);
      if (agent && 'reportStatus' in agent) {
        return (agent as { reportStatus(): unknown }).reportStatus();
      }
      return {
        id: agentConfig.id,
        role: agentConfig.role,
        status: 'stopped',
        currentTask: null,
      };
    });
    return statuses;
  });

  // --- Audit log ---
  ipcMain.handle('audit:query', async (_event, filter) => {
    const auditLog = guardian.getAuditLog();
    return auditLog.query(filter ?? {});
  });

  ipcMain.handle('audit:alerts', async (_event, limit) => {
    const auditLog = guardian.getAuditLog();
    return auditLog.getRecentAlerts(limit ?? 20);
  });

  ipcMain.handle('audit:summary', async () => {
    const auditLog = guardian.getAuditLog();
    return auditLog.getSummary();
  });

  // --- Approval handling ---
  ipcMain.handle('approval:list', async () => {
    const pending = butler.getPendingApprovals();
    return [...pending.entries()].map(([id, req]) => ({
      id,
      actionRequest: req.actionRequest,
      status: req.status,
    }));
  });

  ipcMain.handle('approval:approve', async (_event, requestId: string) => {
    const result = engine.resolveApproval(requestId, true, 'user');
    return result
      ? { success: true, status: result.status }
      : { success: false, error: 'Approval request not found' };
  });

  ipcMain.handle(
    'approval:reject',
    async (_event, requestId: string, reason?: string) => {
      const result = engine.resolveApproval(requestId, false, 'user', reason);
      return result
        ? { success: true, status: result.status }
        : { success: false, error: 'Approval request not found' };
    },
  );

  // --- Config ---
  ipcMain.handle('config:get', async () => {
    return engine.getConfig();
  });

  ipcMain.handle('config:update', async (_event, updates: Record<string, unknown>) => {
    const config = engine.getConfig();

    if (Array.isArray(updates.urlAllowlist)) {
      config.urlAllowlist = updates.urlAllowlist as string[];
    }
    if (Array.isArray(updates.urlBlocklist)) {
      config.urlBlocklist = updates.urlBlocklist as string[];
    }

    return { success: true };
  });

  // --- URL management ---
  ipcMain.handle('url:allowlist', async () => {
    const urlAllowlist = guardian.getUrlAllowlist();
    return urlAllowlist.listAllowed();
  });

  ipcMain.handle('url:blocklist', async () => {
    const urlAllowlist = guardian.getUrlAllowlist();
    return urlAllowlist.listBlocked();
  });

  ipcMain.handle('url:addAllowed', async (_event, domain: string) => {
    const urlAllowlist = guardian.getUrlAllowlist();
    urlAllowlist.addAllowed(domain);
    return { success: true };
  });

  ipcMain.handle('url:addBlocked', async (_event, pattern: string) => {
    const urlAllowlist = guardian.getUrlAllowlist();
    urlAllowlist.addBlocked(pattern);
    return { success: true };
  });

  // --- Vault (keys only, never values) ---
  ipcMain.handle('vault:keys', async () => {
    const vault = guardian.getVault();
    return vault.listKeys();
  });

  // --- Guardian status ---
  ipcMain.handle('guardian:status', async () => {
    return guardian.getStatus();
  });

  // --- User request forwarding ---
  ipcMain.handle('user:request', async (_event, message: string) => {
    if (!engine.isRunning()) {
      return { success: false, error: 'Engine is not running' };
    }
    try {
      await engine.submitUserRequest(message);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  });

  // --- Agent Mind: thinking steps ---
  ipcMain.handle('agentMind:steps', async () => {
    // Returns cached thinking steps from the engine
    // The actual data is populated by event forwarding
    return [];
  });

  // --- Messages: channel message center ---
  ipcMain.handle('messages:getAll', async () => {
    return [];
  });

  ipcMain.handle('messages:approve', async (_event, _id: string, _editedText?: string) => {
    return { success: true };
  });

  ipcMain.handle('messages:reject', async (_event, _id: string, _reason?: string) => {
    return { success: true };
  });

  // --- Memory viewer ---
  ipcMain.handle('memory:list', async () => {
    return [];
  });

  ipcMain.handle('memory:search', async (_event, _query: string, _method?: string, _limit?: number) => {
    return [];
  });

  ipcMain.handle('memory:remove', async (_event, _id: string) => {
    return { success: true };
  });

  ipcMain.handle('memory:stats', async () => {
    return { totalEntries: 0, dbSizeBytes: 0 };
  });

  // --- Browser viewer ---
  ipcMain.handle('browser:state', async () => {
    return { url: '', title: '', isActive: false };
  });

  ipcMain.handle('browser:actions', async () => {
    return [];
  });

  ipcMain.handle('browser:stop', async () => {
    return { success: true };
  });

  // --- Cron management ---
  ipcMain.handle('cron:list', async () => {
    return [];
  });

  ipcMain.handle('cron:add', async (_event, _job: Record<string, unknown>) => {
    return { success: true };
  });

  ipcMain.handle('cron:update', async (_event, _id: string, _updates: Record<string, unknown>) => {
    return { success: true };
  });

  ipcMain.handle('cron:remove', async (_event, _id: string) => {
    return { success: true };
  });

  // --- Usage stats ---
  ipcMain.handle('usage:stats', async () => {
    return {
      totalCalls: 0,
      totalTokens: 0,
      totalCost: 0,
      byProvider: {},
      daily: [],
    };
  });
}

/**
 * Sets up forwarding of engine events to the renderer process via IPC.
 * Call this after the main window is created.
 */
export function setupEventForwarding(
  engine: PawnButlerEngine,
  getMainWindow: () => BrowserWindow | null,
): void {
  const bus = engine.getMessageBus();

  // Subscribe a system listener to forward relevant events to renderer
  bus.subscribe('__ipc_bridge__', (message) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;

    switch (message.type) {
      case 'approval_request':
        win.webContents.send('approval:new', message.payload);
        break;
      case 'alert':
        win.webContents.send('audit:alert', message.payload);
        break;
    }
  });
}
