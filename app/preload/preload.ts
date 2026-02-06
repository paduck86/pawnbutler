// PawnButler - Preload script (contextBridge)
// Exposes a safe API to the renderer process via window.pawnbutler

import { contextBridge, ipcRenderer } from 'electron';

const VALID_EVENT_CHANNELS = [
  'agents:updated',
  'approval:new',
  'audit:alert',
  'guardian:blocked',
  'messages:updated',
  'agentMind:step',
  'memory:updated',
  'browser:updated',
  'cron:updated',
  'usage:updated',
] as const;

type ValidChannel = (typeof VALID_EVENT_CHANNELS)[number];

contextBridge.exposeInMainWorld('pawnbutler', {
  agents: {
    getStatus: () => ipcRenderer.invoke('agents:status'),
  },

  audit: {
    query: (filter: Record<string, unknown>) =>
      ipcRenderer.invoke('audit:query', filter),
    getAlerts: (limit?: number) =>
      ipcRenderer.invoke('audit:alerts', limit),
    getSummary: () => ipcRenderer.invoke('audit:summary'),
  },

  approval: {
    list: () => ipcRenderer.invoke('approval:list'),
    approve: (id: string) => ipcRenderer.invoke('approval:approve', id),
    reject: (id: string, reason?: string) =>
      ipcRenderer.invoke('approval:reject', id, reason),
  },

  config: {
    get: () => ipcRenderer.invoke('config:get'),
    update: (updates: Record<string, unknown>) =>
      ipcRenderer.invoke('config:update', updates),
  },

  url: {
    getAllowlist: () => ipcRenderer.invoke('url:allowlist'),
    getBlocklist: () => ipcRenderer.invoke('url:blocklist'),
    addAllowed: (domain: string) =>
      ipcRenderer.invoke('url:addAllowed', domain),
    addBlocked: (pattern: string) =>
      ipcRenderer.invoke('url:addBlocked', pattern),
  },

  vault: {
    getKeys: () => ipcRenderer.invoke('vault:keys'),
  },

  guardian: {
    getStatus: () => ipcRenderer.invoke('guardian:status'),
  },

  user: {
    sendRequest: (message: string) =>
      ipcRenderer.invoke('user:request', message),
  },

  // --- New panels ---

  agentMind: {
    getSteps: () => ipcRenderer.invoke('agentMind:steps'),
  },

  messages: {
    getAll: () => ipcRenderer.invoke('messages:getAll'),
    approve: (id: string, editedText?: string) =>
      ipcRenderer.invoke('messages:approve', id, editedText),
    reject: (id: string, reason?: string) =>
      ipcRenderer.invoke('messages:reject', id, reason),
  },

  memory: {
    list: () => ipcRenderer.invoke('memory:list'),
    search: (query: string, method?: string, limit?: number) =>
      ipcRenderer.invoke('memory:search', query, method, limit),
    remove: (id: string) => ipcRenderer.invoke('memory:remove', id),
    getStats: () => ipcRenderer.invoke('memory:stats'),
  },

  browser: {
    getState: () => ipcRenderer.invoke('browser:state'),
    getActions: () => ipcRenderer.invoke('browser:actions'),
    stop: () => ipcRenderer.invoke('browser:stop'),
  },

  cron: {
    list: () => ipcRenderer.invoke('cron:list'),
    add: (job: Record<string, unknown>) => ipcRenderer.invoke('cron:add', job),
    update: (id: string, updates: Record<string, unknown>) =>
      ipcRenderer.invoke('cron:update', id, updates),
    remove: (id: string) => ipcRenderer.invoke('cron:remove', id),
  },

  usage: {
    getStats: () => ipcRenderer.invoke('usage:stats'),
  },

  // Event listeners for real-time updates from main process
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    if (VALID_EVENT_CHANNELS.includes(channel as ValidChannel)) {
      ipcRenderer.on(channel, (_event, ...args) => callback(...args));
    }
  },

  off: (channel: string, callback: (...args: unknown[]) => void) => {
    if (VALID_EVENT_CHANNELS.includes(channel as ValidChannel)) {
      ipcRenderer.removeListener(channel, callback as (...args: unknown[]) => void);
    }
  },
});
