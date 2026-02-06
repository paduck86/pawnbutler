// PawnButler Electron UI Test Suite - Transparency dashboard panels
// Tests panel rendering, IPC type contracts, event wiring, and preload channel validation

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// Helper: read source files for static analysis tests
// ============================================================

const appDir = path.resolve(__dirname, '..', 'app');
const rendererDir = path.join(appDir, 'renderer');
const panelsDir = path.join(rendererDir, 'panels');

function readFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(appDir, '..', relativePath), 'utf-8');
}

// ============================================================
// 1. HTML Structure - All panels and nav items present
// ============================================================

describe('index.html structure', () => {
  const html = readFile('app/renderer/index.html');

  const expectedPanels: string[] = [
    'dashboard', 'agent-mind', 'messages', 'approval',
    'memory', 'browser', 'cron', 'usage', 'audit', 'settings',
  ];

  it('should contain all 10 panel containers', () => {
    for (const panel of expectedPanels) {
      expect(html).toContain(`id="panel-${panel}"`);
    }
  });

  it('should contain all 10 nav items', () => {
    for (const panel of expectedPanels) {
      expect(html).toContain(`data-panel="${panel}"`);
    }
  });

  it('should have approval badge element', () => {
    expect(html).toContain('id="approval-badge"');
  });

  it('should have messages badge element', () => {
    expect(html).toContain('id="messages-badge"');
  });

  it('should have CSP with data: for img-src (screenshots)', () => {
    expect(html).toContain("img-src 'self' data:");
  });

  it('should load styles.css', () => {
    expect(html).toContain('href="./styles.css"');
  });

  it('should load index.js', () => {
    expect(html).toContain('src="./index.js"');
  });
});

// ============================================================
// 2. CSS - All required classes for new panels exist
// ============================================================

describe('styles.css coverage', () => {
  const css = readFile('app/renderer/styles.css');

  describe('Agent Mind panel styles', () => {
    const classes = [
      '.mind-phase-indicator', '.phase-dot', '.phase-idle',
      '.phase-thinking', '.phase-tool', '.phase-responding',
      '.phase-error', '.mind-steps', '.mind-step',
      '.mind-step-danger', '.mind-step-header', '.mind-step-icon',
      '.mind-step-phase', '.mind-step-agent', '.mind-step-time',
      '.mind-step-content', '.mind-raw', '.mind-approval-actions',
    ];

    for (const cls of classes) {
      it(`should define ${cls}`, () => {
        expect(css).toContain(cls);
      });
    }

    it('should have pulse animation', () => {
      expect(css).toContain('@keyframes pulse');
    });
  });

  describe('Messages panel styles', () => {
    const classes = [
      '.msg-filter-bar', '.msg-filter-btn', '.msg-timeline',
      '.msg-item', '.msg-incoming', '.msg-outgoing',
      '.msg-channel-badge', '.msg-item-body', '.msg-item-header',
      '.msg-sender', '.msg-direction', '.msg-time',
      '.msg-text', '.msg-reason', '.msg-pending-item',
      '.msg-pending-header', '.msg-edit-area',
    ];

    for (const cls of classes) {
      it(`should define ${cls}`, () => {
        expect(css).toContain(cls);
      });
    }
  });

  describe('Memory panel styles', () => {
    const classes = [
      '.memory-search-row', '.memory-method-select', '.memory-entry',
      '.memory-entry-header', '.memory-content-text', '.memory-tags-row',
      '.memory-tag', '.memory-score', '.memory-match-badge',
      '.memory-type-badge', '.memory-source', '.memory-agent-badge',
      '.memory-ref-badge',
    ];

    for (const cls of classes) {
      it(`should define ${cls}`, () => {
        expect(css).toContain(cls);
      });
    }
  });

  describe('Browser panel styles', () => {
    it('should define .browser-url-bar', () => {
      expect(css).toContain('.browser-url-bar');
    });

    it('should define .browser-screenshot', () => {
      expect(css).toContain('.browser-screenshot');
    });
  });

  describe('Usage panel styles', () => {
    const classes = [
      '.usage-budget-row', '.usage-budget-alert',
      '.usage-budget-exceeded', '.usage-budget-high',
      '.usage-token-bar', '.usage-token-bar-input',
      '.usage-token-bar-output',
    ];

    for (const cls of classes) {
      it(`should define ${cls}`, () => {
        expect(css).toContain(cls);
      });
    }
  });
});

// ============================================================
// 3. Preload - All IPC channels are exposed
// ============================================================

describe('preload.ts IPC channels', () => {
  const preload = readFile('app/preload/preload.ts');

  describe('valid event channels', () => {
    const requiredChannels = [
      'agents:updated', 'approval:new', 'audit:alert',
      'guardian:blocked', 'messages:updated', 'agentMind:step',
      'browser:updated', 'cron:updated', 'usage:updated',
    ];

    for (const channel of requiredChannels) {
      it(`should include '${channel}' in VALID_EVENT_CHANNELS`, () => {
        expect(preload).toContain(`'${channel}'`);
      });
    }
  });

  describe('IPC invoke channels', () => {
    const requiredInvokes = [
      // Original
      'agents:status', 'audit:query', 'audit:alerts', 'audit:summary',
      'approval:list', 'approval:approve', 'approval:reject',
      'config:get', 'config:update',
      'url:allowlist', 'url:blocklist', 'url:addAllowed', 'url:addBlocked',
      'vault:keys', 'guardian:status', 'user:request',
      // New panels
      'agentMind:steps',
      'messages:getAll', 'messages:approve', 'messages:reject',
      'memory:list', 'memory:search', 'memory:remove', 'memory:stats',
      'browser:state', 'browser:actions', 'browser:stop',
      'cron:list', 'cron:add', 'cron:update', 'cron:remove',
      'usage:stats',
    ];

    for (const channel of requiredInvokes) {
      it(`should expose ipcRenderer.invoke('${channel}')`, () => {
        expect(preload).toContain(`'${channel}'`);
      });
    }
  });

  describe('API namespace methods', () => {
    it('should expose agentMind.getSteps', () => {
      expect(preload).toContain('getSteps');
    });

    it('should expose messages.getAll', () => {
      expect(preload).toContain('getAll');
    });

    it('should expose memory.list', () => {
      expect(preload).toMatch(/memory:\s*\{[\s\S]*?list/);
    });

    it('should expose memory.search with method and limit params', () => {
      expect(preload).toContain('search: (query: string, method?: string, limit?: number)');
    });

    it('should expose memory.getStats', () => {
      expect(preload).toContain('getStats');
    });

    it('should expose browser.getState', () => {
      expect(preload).toContain('getState');
    });

    it('should expose browser.getActions', () => {
      expect(preload).toContain('getActions');
    });

    it('should expose browser.stop', () => {
      expect(preload).toMatch(/browser:\s*\{[\s\S]*?stop/);
    });

    it('should expose cron.list', () => {
      expect(preload).toMatch(/cron:\s*\{[\s\S]*?list/);
    });

    it('should expose cron.add', () => {
      expect(preload).toContain("ipcRenderer.invoke('cron:add'");
    });

    it('should expose cron.update', () => {
      expect(preload).toContain("ipcRenderer.invoke('cron:update'");
    });

    it('should expose cron.remove', () => {
      expect(preload).toContain("ipcRenderer.invoke('cron:remove'");
    });

    it('should expose usage.getStats', () => {
      expect(preload).toMatch(/usage:\s*\{[\s\S]*?getStats/);
    });
  });

  describe('security', () => {
    it('should validate channels before registering listeners', () => {
      expect(preload).toContain('VALID_EVENT_CHANNELS.includes(channel as ValidChannel)');
    });

    it('should use contextBridge.exposeInMainWorld', () => {
      expect(preload).toContain("contextBridge.exposeInMainWorld('pawnbutler'");
    });
  });
});

// ============================================================
// 4. IPC Handlers - All handlers registered
// ============================================================

describe('ipc-handlers.ts', () => {
  const handlers = readFile('app/main/ipc-handlers.ts');

  describe('handler registration', () => {
    const requiredHandlers = [
      'agents:status', 'audit:query', 'audit:alerts', 'audit:summary',
      'approval:list', 'approval:approve', 'approval:reject',
      'config:get', 'config:update',
      'url:allowlist', 'url:blocklist', 'url:addAllowed', 'url:addBlocked',
      'vault:keys', 'guardian:status', 'user:request',
      'agentMind:steps',
      'messages:getAll', 'messages:approve', 'messages:reject',
      'memory:list', 'memory:search', 'memory:remove', 'memory:stats',
      'browser:state', 'browser:actions', 'browser:stop',
      'cron:list', 'cron:add', 'cron:update', 'cron:remove',
      'usage:stats',
    ];

    for (const handler of requiredHandlers) {
      it(`should register ipcMain.handle('${handler}')`, () => {
        expect(handlers).toContain(`'${handler}'`);
      });
    }
  });

  it('should export registerIPCHandlers function', () => {
    expect(handlers).toContain('export function registerIPCHandlers');
  });

  it('should export setupEventForwarding function', () => {
    expect(handlers).toContain('export function setupEventForwarding');
  });

  it('should forward approval:new events', () => {
    expect(handlers).toContain("'approval:new'");
  });

  it('should forward audit:alert events', () => {
    expect(handlers).toContain("'audit:alert'");
  });
});

// ============================================================
// 5. Global Type Definitions
// ============================================================

describe('global.d.ts type definitions', () => {
  const types = readFile('app/global.d.ts');

  it('should define PawnButlerAPI interface', () => {
    expect(types).toContain('interface PawnButlerAPI');
  });

  it('should declare window.pawnbutler', () => {
    expect(types).toContain('pawnbutler: PawnButlerAPI');
  });

  describe('API namespaces', () => {
    const namespaces = [
      'agents', 'audit', 'approval', 'config', 'url',
      'vault', 'guardian', 'user', 'agentMind', 'messages',
      'memory', 'browser', 'cron', 'usage',
    ];

    for (const ns of namespaces) {
      it(`should define ${ns} namespace`, () => {
        expect(types).toContain(`${ns}:`);
      });
    }
  });

  it('should define on/off event methods', () => {
    expect(types).toContain('on: (channel: string');
    expect(types).toContain('off: (channel: string');
  });

  it('should define memory.search with method and limit params', () => {
    expect(types).toContain('search: (query: string, method?: string, limit?: number)');
  });

  it('should define memory.getStats', () => {
    expect(types).toContain('getStats: () => Promise<unknown>');
  });
});

// ============================================================
// 6. Renderer index.ts - Panel routing and event wiring
// ============================================================

describe('renderer index.ts', () => {
  const index = readFile('app/renderer/index.ts');

  describe('panel imports', () => {
    const expectedImports = [
      'renderDashboard', 'renderApprovalPanel', 'renderAuditLog',
      'renderSettings', 'renderAgentMindPanel', 'renderMessagesPanel',
      'renderMemoryPanel', 'renderBrowserPanel', 'renderCronPanel',
      'renderUsagePanel',
    ];

    for (const importName of expectedImports) {
      it(`should import ${importName}`, () => {
        expect(index).toContain(importName);
      });
    }
  });

  describe('refresh function imports', () => {
    const expectedRefreshes = [
      'refreshAgents', 'refreshApprovals', 'refreshAuditLog',
      'refreshAgentMind', 'refreshMessages', 'refreshMemory',
      'refreshBrowser', 'refreshCron', 'refreshUsage',
    ];

    for (const fn of expectedRefreshes) {
      it(`should import ${fn}`, () => {
        expect(index).toContain(fn);
      });
    }
  });

  describe('PanelName type', () => {
    it('should include all 10 panel names', () => {
      const panels = [
        'dashboard', 'agent-mind', 'messages', 'approval',
        'memory', 'browser', 'cron', 'usage', 'audit', 'settings',
      ];
      for (const panel of panels) {
        expect(index).toContain(`'${panel}'`);
      }
    });
  });

  describe('event listeners', () => {
    const events = [
      'agents:updated', 'approval:new', 'audit:alert',
      'guardian:blocked', 'messages:updated', 'agentMind:step',
      'browser:updated', 'cron:updated', 'usage:updated',
    ];

    for (const event of events) {
      it(`should listen for '${event}' event`, () => {
        expect(index).toContain(`'${event}'`);
      });
    }
  });

  it('should import pushStep for real-time agent mind updates', () => {
    expect(index).toContain('pushStep');
  });

  it('should import updateMessages for dashboard message updates', () => {
    expect(index).toContain('updateMessages');
  });

  it('should poll every 2 seconds', () => {
    expect(index).toContain('2000');
  });

  it('should update approval badge', () => {
    expect(index).toContain('updateApprovalBadge');
  });

  it('should update messages badge', () => {
    expect(index).toContain('updateMessagesBadge');
  });
});

// ============================================================
// 7. Panel source file structure
// ============================================================

describe('panel source files', () => {
  const panels = [
    { file: 'agent-mind.ts', render: 'renderAgentMindPanel', refresh: 'refreshAgentMind' },
    { file: 'messages.ts', render: 'renderMessagesPanel', refresh: 'refreshMessages' },
    { file: 'memory.ts', render: 'renderMemoryPanel', refresh: 'refreshMemory' },
    { file: 'browser.ts', render: 'renderBrowserPanel', refresh: 'refreshBrowser' },
    { file: 'cron.ts', render: 'renderCronPanel', refresh: 'refreshCron' },
    { file: 'usage.ts', render: 'renderUsagePanel', refresh: 'refreshUsage' },
  ];

  for (const panel of panels) {
    describe(panel.file, () => {
      const src = readFile(`app/renderer/panels/${panel.file}`);

      it(`should export ${panel.render}`, () => {
        expect(src).toContain(`export async function ${panel.render}`);
      });

      it(`should export ${panel.refresh}`, () => {
        expect(src).toContain(`export async function ${panel.refresh}`);
      });

      it('should accept HTMLElement container parameter', () => {
        expect(src).toContain('container: HTMLElement');
      });

      it('should return Promise<void>', () => {
        expect(src).toContain('Promise<void>');
      });

      it('should have escapeHtml function for XSS prevention', () => {
        expect(src).toContain('function escapeHtml');
      });
    });
  }
});

// ============================================================
// 8. Agent Mind panel specifics
// ============================================================

describe('Agent Mind panel', () => {
  const src = readFile('app/renderer/panels/agent-mind.ts');

  it('should export ThinkingStep interface', () => {
    expect(src).toContain('export interface ThinkingStep');
  });

  it('should export pushStep function for real-time updates', () => {
    expect(src).toContain('export function pushStep');
  });

  it('should support all 5 phases: thinking, tool_call, tool_result, responding, error', () => {
    expect(src).toContain("'thinking'");
    expect(src).toContain("'tool_call'");
    expect(src).toContain("'tool_result'");
    expect(src).toContain("'responding'");
    expect(src).toContain("'error'");
  });

  it('should highlight dangerous actions', () => {
    expect(src).toContain('mind-step-danger');
  });

  it('should have raw prompt toggle', () => {
    expect(src).toContain('showRawPrompts');
    expect(src).toContain('raw-prompt-toggle');
  });

  it('should limit steps buffer to 200', () => {
    expect(src).toContain('200');
  });

  it('should render approval buttons for steps requiring approval', () => {
    expect(src).toContain('requiresApproval');
    expect(src).toContain('mind-approve-btn');
    expect(src).toContain('mind-reject-btn');
  });

  it('should call window.pawnbutler.agentMind.getSteps', () => {
    expect(src).toContain('window.pawnbutler.agentMind.getSteps');
  });
});

// ============================================================
// 9. Messages panel specifics
// ============================================================

describe('Messages panel', () => {
  const src = readFile('app/renderer/panels/messages.ts');

  it('should export ChannelMessage interface', () => {
    expect(src).toContain('export interface ChannelMessage');
  });

  it('should support all 4 channels', () => {
    expect(src).toContain("'whatsapp'");
    expect(src).toContain("'telegram'");
    expect(src).toContain("'discord'");
    expect(src).toContain("'slack'");
  });

  it('should have channel filter buttons', () => {
    expect(src).toContain('msg-filter-btn');
  });

  it('should have channel color definitions', () => {
    expect(src).toContain('#25d366'); // whatsapp
    expect(src).toContain('#0088cc'); // telegram
    expect(src).toContain('#5865f2'); // discord
    expect(src).toContain('#4a154b'); // slack
  });

  it('should render pending review section', () => {
    expect(src).toContain('pending_review');
    expect(src).toContain('msg-pending-section');
  });

  it('should have approve/reject buttons for pending messages', () => {
    expect(src).toContain('msg-approve-btn');
    expect(src).toContain('msg-reject-btn');
  });

  it('should support editable outgoing message text', () => {
    expect(src).toContain('msg-edit-area');
  });

  it('should have search functionality', () => {
    expect(src).toContain('msg-search-input');
    expect(src).toContain('msg-search-btn');
  });

  it('should call window.pawnbutler.messages.getAll', () => {
    expect(src).toContain('window.pawnbutler.messages.getAll');
  });

  it('should call window.pawnbutler.messages.approve', () => {
    expect(src).toContain('window.pawnbutler.messages.approve');
  });

  it('should call window.pawnbutler.messages.reject', () => {
    expect(src).toContain('window.pawnbutler.messages.reject');
  });
});

// ============================================================
// 10. Memory panel specifics
// ============================================================

describe('Memory panel', () => {
  const src = readFile('app/renderer/panels/memory.ts');

  it('should export MemoryItem interface', () => {
    expect(src).toContain('export interface MemoryItem');
  });

  it('should export MemoryStats interface', () => {
    expect(src).toContain('export interface MemoryStats');
  });

  it('should support semantic search with method selection', () => {
    expect(src).toContain('memory-search-method');
    expect(src).toContain('hybrid');
    expect(src).toContain('semantic');
    expect(src).toContain('keyword');
  });

  it('should have debounced auto-search', () => {
    expect(src).toContain('searchDebounceTimer');
  });

  it('should track recently referenced memories', () => {
    expect(src).toContain('recentlyReferenced');
  });

  it('should display memory stats', () => {
    expect(src).toContain('memory-stats');
    expect(src).toContain('window.pawnbutler.memory.getStats');
  });

  it('should support memory deletion', () => {
    expect(src).toContain('memory-delete-btn');
    expect(src).toContain('window.pawnbutler.memory.remove');
  });

  it('should render tags', () => {
    expect(src).toContain('memory-tag');
    expect(src).toContain('memory-tags-row');
  });

  it('should have formatBytes utility', () => {
    expect(src).toContain('function formatBytes');
  });
});

// ============================================================
// 11. Browser panel specifics
// ============================================================

describe('Browser panel', () => {
  const src = readFile('app/renderer/panels/browser.ts');

  it('should export BrowserState interface', () => {
    expect(src).toContain('export interface BrowserState');
  });

  it('should export BrowserAction interface', () => {
    expect(src).toContain('export interface BrowserAction');
  });

  it('should display URL bar', () => {
    expect(src).toContain('browser-url-bar');
    expect(src).toContain('browser-current-url');
  });

  it('should display screenshots', () => {
    expect(src).toContain('browser-screenshot');
    expect(src).toContain('screenshot');
  });

  it('should have stop button', () => {
    expect(src).toContain('browser-stop-btn');
    expect(src).toContain('window.pawnbutler.browser.stop');
  });

  it('should show action history', () => {
    expect(src).toContain('browser-actions');
    expect(src).toContain('window.pawnbutler.browser.getActions');
  });

  it('should show active/inactive status', () => {
    expect(src).toContain('isActive');
    expect(src).toContain('browser-status-dot');
    expect(src).toContain('browser-status-text');
  });

  it('should limit action history to 50 items', () => {
    expect(src).toContain('50');
  });
});

// ============================================================
// 12. Cron panel specifics
// ============================================================

describe('Cron panel', () => {
  const src = readFile('app/renderer/panels/cron.ts');

  it('should export CronJob interface', () => {
    expect(src).toContain('export interface CronJob');
  });

  it('should have add job button', () => {
    expect(src).toContain('cron-add-btn');
  });

  it('should have add job modal', () => {
    expect(src).toContain('modal-overlay');
    expect(src).toContain('cron-name');
    expect(src).toContain('cron-schedule');
    expect(src).toContain('cron-agent');
    expect(src).toContain('cron-description');
  });

  it('should support enable/disable toggle', () => {
    expect(src).toContain('cron-toggle');
    expect(src).toContain('enabled');
  });

  it('should support job deletion', () => {
    expect(src).toContain('cron-delete-btn');
    expect(src).toContain('window.pawnbutler.cron.remove');
  });

  it('should show last run and next run times', () => {
    expect(src).toContain('lastRun');
    expect(src).toContain('nextRun');
  });

  it('should call cron IPC APIs', () => {
    expect(src).toContain('window.pawnbutler.cron.list');
    expect(src).toContain('window.pawnbutler.cron.add');
    expect(src).toContain('window.pawnbutler.cron.update');
    expect(src).toContain('window.pawnbutler.cron.remove');
  });
});

// ============================================================
// 13. Usage panel specifics
// ============================================================

describe('Usage panel', () => {
  const src = readFile('app/renderer/panels/usage.ts');

  it('should export UsageStats interface', () => {
    expect(src).toContain('export interface UsageStats');
  });

  it('should export ProviderUsage interface', () => {
    expect(src).toContain('export interface ProviderUsage');
  });

  it('should export DailyUsage interface', () => {
    expect(src).toContain('export interface DailyUsage');
  });

  it('should display summary stats', () => {
    expect(src).toContain('usage-summary');
    expect(src).toContain('API Calls');
    expect(src).toContain('Total Tokens');
    expect(src).toContain('Total Cost');
  });

  it('should show provider breakdown', () => {
    expect(src).toContain('usage-providers');
    expect(src).toContain('inputTokens');
    expect(src).toContain('outputTokens');
  });

  it('should render 7-day daily chart', () => {
    expect(src).toContain('usage-chart');
    expect(src).toContain('Daily Usage (7 days)');
  });

  it('should have budget warning system', () => {
    expect(src).toContain('budgetThreshold');
    expect(src).toContain('usage-budget-warning');
    expect(src).toContain('usage-budget-alert');
  });

  it('should warn at 80% budget', () => {
    expect(src).toContain('80');
    expect(src).toContain('usage-budget-high');
  });

  it('should alert at 100% budget', () => {
    expect(src).toContain('100');
    expect(src).toContain('usage-budget-exceeded');
  });

  it('should have formatTokens utility', () => {
    expect(src).toContain('function formatTokens');
  });

  it('should call window.pawnbutler.usage.getStats', () => {
    expect(src).toContain('window.pawnbutler.usage.getStats');
  });
});

// ============================================================
// 14. Cross-panel consistency
// ============================================================

describe('cross-panel consistency', () => {
  const panelFiles = [
    'agent-mind.ts', 'messages.ts', 'memory.ts',
    'browser.ts', 'cron.ts', 'usage.ts',
  ];

  it('all panels should use escapeHtml for XSS prevention', () => {
    for (const file of panelFiles) {
      const src = readFile(`app/renderer/panels/${file}`);
      expect(src).toContain('escapeHtml');
    }
  });

  it('panels with timestamps should use korean time format', () => {
    // usage.ts uses formatTokens but not formatTime with ko-KR
    const panelsWithTime = ['agent-mind.ts', 'messages.ts', 'memory.ts', 'browser.ts', 'cron.ts'];
    for (const file of panelsWithTime) {
      const src = readFile(`app/renderer/panels/${file}`);
      expect(src).toContain('ko-KR');
    }
  });

  it('all panel exports should be async', () => {
    for (const file of panelFiles) {
      const src = readFile(`app/renderer/panels/${file}`);
      expect(src).toMatch(/export async function render\w+Panel/);
    }
  });

  it('all panels should handle API errors with try/catch', () => {
    for (const file of panelFiles) {
      const src = readFile(`app/renderer/panels/${file}`);
      expect(src).toContain('catch');
    }
  });
});

// ============================================================
// 15. Preload-to-Handler channel alignment
// ============================================================

describe('preload-to-handler alignment', () => {
  const preload = readFile('app/preload/preload.ts');
  const handlers = readFile('app/main/ipc-handlers.ts');

  // Extract all ipcRenderer.invoke channel names from preload
  const preloadChannels = [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(m => m[1]);
  // Extract all ipcMain.handle channel names from handlers (may be on next line)
  const handlerChannels = [...handlers.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map(m => m[1]);

  it('should have matching channel count', () => {
    // Every preload invoke should have a matching handler
    const preloadSet = new Set(preloadChannels);
    const handlerSet = new Set(handlerChannels);
    const missingHandlers = [...preloadSet].filter(c => !handlerSet.has(c));
    expect(missingHandlers).toEqual([]);
  });

  it('every preload channel should have a handler', () => {
    const handlerSet = new Set(handlerChannels);
    for (const channel of preloadChannels) {
      expect(handlerSet.has(channel)).toBe(true);
    }
  });

  it('every handler should be exposed in preload', () => {
    const preloadSet = new Set(preloadChannels);
    for (const channel of handlerChannels) {
      expect(preloadSet.has(channel)).toBe(true);
    }
  });
});

// ============================================================
// 16. Renderer-to-Preload API alignment
// ============================================================

describe('renderer panels call valid preload APIs', () => {
  const preload = readFile('app/preload/preload.ts');

  it('agent-mind calls agentMind.getSteps which exists in preload', () => {
    expect(preload).toContain('getSteps');
    expect(preload).toContain("'agentMind:steps'");
  });

  it('messages panel calls messages.getAll/approve/reject which exist in preload', () => {
    expect(preload).toContain("'messages:getAll'");
    expect(preload).toContain("'messages:approve'");
    expect(preload).toContain("'messages:reject'");
  });

  it('memory panel calls memory.list/search/remove/stats which exist in preload', () => {
    expect(preload).toContain("'memory:list'");
    expect(preload).toContain("'memory:search'");
    expect(preload).toContain("'memory:remove'");
    expect(preload).toContain("'memory:stats'");
  });

  it('browser panel calls browser.getState/getActions/stop which exist in preload', () => {
    expect(preload).toContain("'browser:state'");
    expect(preload).toContain("'browser:actions'");
    expect(preload).toContain("'browser:stop'");
  });

  it('cron panel calls cron.list/add/update/remove which exist in preload', () => {
    expect(preload).toContain("'cron:list'");
    expect(preload).toContain("'cron:add'");
    expect(preload).toContain("'cron:update'");
    expect(preload).toContain("'cron:remove'");
  });

  it('usage panel calls usage.getStats which exists in preload', () => {
    expect(preload).toContain("'usage:stats'");
  });
});
