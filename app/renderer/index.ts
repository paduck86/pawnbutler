// PawnButler Renderer - Main App Entry Point
// Pure TypeScript + DOM API, no frameworks
// Types are declared in app/global.d.ts (PawnButlerAPI on window.pawnbutler)

import { renderDashboard, refreshAgents, updateMessages } from './panels/dashboard.js';
import { renderApprovalPanel, refreshApprovals } from './panels/approval.js';
import { renderAuditLog, refreshAuditLog } from './panels/audit-log.js';
import { renderSettings } from './panels/settings.js';
import { renderAgentMindPanel, refreshAgentMind, pushStep } from './panels/agent-mind.js';
import { renderMessagesPanel, refreshMessages } from './panels/messages.js';
import { renderMemoryPanel, refreshMemory } from './panels/memory.js';
import { renderBrowserPanel, refreshBrowser } from './panels/browser.js';
import { renderCronPanel, refreshCron } from './panels/cron.js';
import { renderUsagePanel, refreshUsage } from './panels/usage.js';

type PanelName = 'dashboard' | 'agent-mind' | 'messages' | 'approval' | 'memory' | 'browser' | 'cron' | 'usage' | 'audit' | 'settings';

class PawnButlerApp {
  private currentPanel: PanelName = 'dashboard';
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private pendingCount = 0;

  init(): void {
    this.setupNavigation();
    this.loadPanel('dashboard');
    this.startPolling();
    this.setupEventListeners();
  }

  private setupNavigation(): void {
    document.querySelectorAll('.nav-item[data-panel]').forEach(item => {
      item.addEventListener('click', () => {
        const panel = (item as HTMLElement).dataset.panel as PanelName;
        if (panel) this.loadPanel(panel);
      });
    });
  }

  private async loadPanel(panel: PanelName): Promise<void> {
    this.currentPanel = panel;

    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', (item as HTMLElement).dataset.panel === panel);
    });

    // Update panel visibility
    document.querySelectorAll('.panel').forEach(p => {
      p.classList.toggle('active', p.id === `panel-${panel}`);
    });

    const container = document.getElementById(`panel-${panel}`);
    if (!container) return;

    switch (panel) {
      case 'dashboard':
        await renderDashboard(container);
        break;
      case 'agent-mind':
        await renderAgentMindPanel(container);
        break;
      case 'messages':
        await renderMessagesPanel(container);
        break;
      case 'approval':
        await renderApprovalPanel(container);
        break;
      case 'memory':
        await renderMemoryPanel(container);
        break;
      case 'browser':
        await renderBrowserPanel(container);
        break;
      case 'cron':
        await renderCronPanel(container);
        break;
      case 'usage':
        await renderUsagePanel(container);
        break;
      case 'audit':
        await renderAuditLog(container);
        break;
      case 'settings':
        await renderSettings(container);
        break;
    }
  }

  private startPolling(): void {
    this.pollInterval = setInterval(async () => {
      try {
        await this.pollUpdate();
      } catch {
        // Silent failure - will retry next interval
      }
    }, 2000);
  }

  private async pollUpdate(): Promise<void> {
    switch (this.currentPanel) {
      case 'dashboard':
        await refreshAgents();
        break;
      case 'agent-mind':
        await refreshAgentMind();
        break;
      case 'messages':
        await refreshMessages();
        break;
      case 'approval':
        await refreshApprovals();
        break;
      case 'memory':
        await refreshMemory();
        break;
      case 'browser':
        await refreshBrowser();
        break;
      case 'cron':
        await refreshCron();
        break;
      case 'usage':
        await refreshUsage();
        break;
      case 'audit':
        await refreshAuditLog();
        break;
      // settings: no auto-refresh needed
    }

    // Always check pending approvals for badge
    await this.updateApprovalBadge();
    await this.updateMessagesBadge();
  }

  private async updateApprovalBadge(): Promise<void> {
    try {
      const items = await window.pawnbutler.approval.list();
      const pending = (items || []).filter((i) => (i as Record<string, unknown>).status === 'pending');
      this.pendingCount = pending.length;

      const badge = document.getElementById('approval-badge');
      if (badge) {
        if (this.pendingCount > 0) {
          badge.textContent = String(this.pendingCount);
          badge.style.display = 'inline';
        } else {
          badge.style.display = 'none';
        }
      }
    } catch {
      // silent
    }
  }

  private async updateMessagesBadge(): Promise<void> {
    try {
      const msgs = await window.pawnbutler.messages.getAll();
      const pending = (msgs || []).filter((m) => (m as Record<string, unknown>).status === 'pending_review');

      const badge = document.getElementById('messages-badge');
      if (badge) {
        if (pending.length > 0) {
          badge.textContent = String(pending.length);
          badge.style.display = 'inline';
        } else {
          badge.style.display = 'none';
        }
      }
    } catch {
      // silent
    }
  }

  private setupEventListeners(): void {
    if (!window.pawnbutler?.on) return;

    window.pawnbutler.on('agents:updated', () => {
      if (this.currentPanel === 'dashboard') {
        refreshAgents();
      }
    });

    window.pawnbutler.on('approval:new', () => {
      this.updateApprovalBadge();
      if (this.currentPanel === 'approval') {
        refreshApprovals();
      }
    });

    window.pawnbutler.on('audit:alert', () => {
      if (this.currentPanel === 'audit') {
        refreshAuditLog();
      }
    });

    window.pawnbutler.on('guardian:blocked', () => {
      this.updateApprovalBadge();
      if (this.currentPanel === 'dashboard') {
        refreshAgents();
      }
    });

    window.pawnbutler.on('messages:updated', (data: unknown) => {
      if (this.currentPanel === 'dashboard' && Array.isArray(data)) {
        updateMessages(data);
      }
      if (this.currentPanel === 'messages') {
        refreshMessages();
      }
      this.updateMessagesBadge();
    });

    window.pawnbutler.on('agentMind:step', (step: unknown) => {
      if (step && typeof step === 'object') {
        pushStep(step as Parameters<typeof pushStep>[0]);
      }
    });

    window.pawnbutler.on('browser:updated', () => {
      if (this.currentPanel === 'browser') {
        refreshBrowser();
      }
    });

    window.pawnbutler.on('cron:updated', () => {
      if (this.currentPanel === 'cron') {
        refreshCron();
      }
    });

    window.pawnbutler.on('usage:updated', () => {
      if (this.currentPanel === 'usage') {
        refreshUsage();
      }
    });
  }

  destroy(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}

// Boot
document.addEventListener('DOMContentLoaded', () => {
  const app = new PawnButlerApp();
  app.init();

  // Expose for debugging
  (window as unknown as Record<string, unknown>).__pawnbutlerApp = app;
});

export {};
