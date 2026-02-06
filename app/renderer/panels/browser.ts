// Browser Viewer Panel - Live view of agent browser automation
// Shows screenshots, current URL, action history, manual stop

export interface BrowserState {
  url: string;
  title: string;
  screenshot?: string; // base64 data URL
  isActive: boolean;
}

export interface BrowserAction {
  id: string;
  action: string;
  params: Record<string, unknown>;
  timestamp: number;
  result?: string;
}

let actions: BrowserAction[] = [];
let currentState: BrowserState = { url: '', title: '', isActive: false };

export async function renderBrowserPanel(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <h2 class="panel-title">Browser Viewer</h2>
    <div class="card">
      <div class="card-header">
        <span class="card-title">Agent Browser</span>
        <div style="display:flex;align-items:center;gap:8px;">
          <span id="browser-status-dot" class="phase-dot phase-idle"></span>
          <span id="browser-status-text" style="font-size:12px;color:var(--text-secondary);">Inactive</span>
          <button class="btn btn-danger btn-sm" id="browser-stop-btn">Stop Browser</button>
        </div>
      </div>
      <div id="browser-url-bar" class="browser-url-bar">
        <span style="color:var(--text-muted);font-size:12px;">URL:</span>
        <span id="browser-current-url" style="font-size:13px;font-family:monospace;color:var(--text-primary);word-break:break-all;">No page loaded</span>
      </div>
    </div>
    <div class="card" style="margin-top:12px;">
      <div class="card-header">
        <span class="card-title">Screenshot</span>
        <button class="btn btn-sm btn-primary" id="browser-refresh-btn">Refresh</button>
      </div>
      <div id="browser-screenshot" class="browser-screenshot">
        <div class="empty-state"><div class="message">No screenshot available</div></div>
      </div>
    </div>
    <div class="card" style="margin-top:12px;">
      <div class="card-header">
        <span class="card-title">Action History</span>
      </div>
      <div id="browser-actions" class="timeline"></div>
    </div>
  `;

  document.getElementById('browser-stop-btn')?.addEventListener('click', async () => {
    try {
      await window.pawnbutler.browser.stop();
      await refreshBrowser();
    } catch { /* retry */ }
  });

  document.getElementById('browser-refresh-btn')?.addEventListener('click', async () => {
    await refreshBrowser();
  });

  await refreshBrowser();
}

export async function refreshBrowser(): Promise<void> {
  try {
    const state = await window.pawnbutler.browser.getState();
    if (state && typeof state === 'object') {
      currentState = state as BrowserState;
    }
  } catch {
    currentState = { url: '', title: '', isActive: false };
  }

  try {
    const data = await window.pawnbutler.browser.getActions();
    if (Array.isArray(data)) {
      actions = data as BrowserAction[];
    }
  } catch {
    actions = [];
  }

  renderBrowserState();
  renderScreenshot();
  renderActions();
}

function renderBrowserState(): void {
  const urlEl = document.getElementById('browser-current-url');
  const dotEl = document.getElementById('browser-status-dot');
  const textEl = document.getElementById('browser-status-text');

  if (urlEl) {
    urlEl.textContent = currentState.url || 'No page loaded';
  }

  if (dotEl && textEl) {
    if (currentState.isActive) {
      dotEl.className = 'phase-dot phase-tool';
      textEl.textContent = 'Active';
    } else {
      dotEl.className = 'phase-dot phase-idle';
      textEl.textContent = 'Inactive';
    }
  }
}

function renderScreenshot(): void {
  const container = document.getElementById('browser-screenshot');
  if (!container) return;

  if (currentState.screenshot) {
    container.innerHTML = `<img src="${currentState.screenshot}" alt="Browser screenshot" style="max-width:100%;border-radius:4px;" />`;
  } else {
    container.innerHTML = '<div class="empty-state"><div class="message">No screenshot available</div></div>';
  }
}

function renderActions(): void {
  const container = document.getElementById('browser-actions');
  if (!container) return;

  if (actions.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="message">No browser actions recorded</div></div>';
    return;
  }

  container.innerHTML = actions.slice(-50).map(renderActionItem).join('');
}

function renderActionItem(action: BrowserAction): string {
  const time = formatTime(action.timestamp);
  const params = Object.entries(action.params)
    .map(([k, v]) => `${k}=${String(v).slice(0, 50)}`)
    .join(', ');

  return `
    <div class="timeline-item">
      <span class="timeline-time">${time}</span>
      <span class="timeline-action" style="font-weight:600;">${escapeHtml(action.action)}</span>
      <span class="timeline-details">${escapeHtml(params)}</span>
      ${action.result ? `<span class="timeline-result result-success">${escapeHtml(action.result.slice(0, 30))}</span>` : ''}
    </div>
  `;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
