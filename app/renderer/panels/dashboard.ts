// Dashboard Panel - Agent status cards, message flow, user input

interface AgentStatus {
  id: string;
  role: string;
  name: string;
  status: 'idle' | 'working' | 'waiting' | 'stopped';
  currentTask?: string;
  stats?: { totalChecks?: number; blocked?: number; alerts?: number };
}

const ROLE_ICONS: Record<string, string> = {
  butler: '\u{1F3E0}',
  researcher: '\u{1F50D}',
  executor: '\u{2699}\uFE0F',
  guardian: '\u{1F6E1}\uFE0F',
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  butler: 'Task Orchestrator',
  researcher: 'Information Gatherer',
  executor: 'Action Performer',
  guardian: 'Safety Monitor',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export async function renderDashboard(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <h2 class="panel-title">Agent Dashboard</h2>
    <div class="agent-grid" id="agent-grid"></div>
    <div class="card">
      <div class="message-flow">
        <div class="message-flow-title">Recent Messages</div>
        <div id="message-list"><div class="empty-state"><div class="message">No recent messages</div></div></div>
      </div>
    </div>
    <div class="card">
      <div class="user-input-section">
        <input type="text" id="user-request-input" placeholder="Send a request to agents..." />
        <button class="btn btn-primary" id="send-request-btn">Send</button>
      </div>
    </div>
  `;

  await refreshAgents();
  setupUserInput();
}

export async function refreshAgents(): Promise<void> {
  const grid = document.getElementById('agent-grid');
  if (!grid) return;

  try {
    const agents = (await window.pawnbutler.agents.getStatus()) as AgentStatus[];
    if (!agents || agents.length === 0) {
      grid.innerHTML = renderDefaultAgents();
      return;
    }
    grid.innerHTML = agents.map(renderAgentCard).join('');
  } catch {
    grid.innerHTML = renderDefaultAgents();
  }
}

function renderDefaultAgents(): string {
  const defaults: AgentStatus[] = [
    { id: 'butler', role: 'butler', name: 'Butler', status: 'idle' },
    { id: 'researcher', role: 'researcher', name: 'Researcher', status: 'idle' },
    { id: 'executor', role: 'executor', name: 'Executor', status: 'idle' },
    { id: 'guardian', role: 'guardian', name: 'Guardian', status: 'idle' },
  ];
  return defaults.map(renderAgentCard).join('');
}

function renderAgentCard(agent: AgentStatus): string {
  const icon = ROLE_ICONS[agent.role] || '\u{1F916}';
  const desc = ROLE_DESCRIPTIONS[agent.role] || agent.role;
  const statusClass = `status-${agent.status}`;

  let statsHtml = '';
  if (agent.role === 'guardian' && agent.stats) {
    statsHtml = `
      <div class="agent-stats">
        <div class="agent-stat">
          <div class="stat-value">${agent.stats.totalChecks ?? 0}</div>
          <div class="stat-label">Checks</div>
        </div>
        <div class="agent-stat">
          <div class="stat-value">${agent.stats.blocked ?? 0}</div>
          <div class="stat-label">Blocked</div>
        </div>
        <div class="agent-stat">
          <div class="stat-value">${agent.stats.alerts ?? 0}</div>
          <div class="stat-label">Alerts</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="agent-card" data-agent-id="${agent.id}">
      <div class="agent-card-header">
        <div class="agent-icon">${icon}</div>
        <div>
          <div class="agent-name">${escapeHtml(agent.name)}</div>
          <div class="agent-role">${escapeHtml(desc)}</div>
        </div>
      </div>
      <span class="status-badge ${statusClass}">
        <span class="dot"></span>
        ${agent.status}
      </span>
      ${agent.currentTask ? `<div class="agent-task">${escapeHtml(agent.currentTask)}</div>` : ''}
      ${statsHtml}
    </div>
  `;
}

export function updateMessages(messages: Array<{ from: string; to: string; type: string; payload: unknown; timestamp?: number }>): void {
  const list = document.getElementById('message-list');
  if (!list) return;

  if (!messages || messages.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="message">No recent messages</div></div>';
    return;
  }

  const recent = messages.slice(-5);
  list.innerHTML = recent.map(msg => `
    <div class="message-item">
      <span class="message-from">${escapeHtml(String(msg.from))}</span>
      <span class="message-to">\u2192 ${escapeHtml(String(msg.to))}</span>
      <span class="message-content">[${escapeHtml(String(msg.type))}] ${escapeHtml(summarizePayload(msg.payload))}</span>
      <span class="message-time">${msg.timestamp ? formatTime(msg.timestamp) : ''}</span>
    </div>
  `).join('');
}

function setupUserInput(): void {
  const input = document.getElementById('user-request-input') as HTMLInputElement | null;
  const btn = document.getElementById('send-request-btn');
  if (!input || !btn) return;

  const send = async () => {
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    btn.setAttribute('disabled', 'true');
    try {
      await window.pawnbutler.user.sendRequest(message);
    } catch {
      // Silently handle - user will see result through agent updates
    } finally {
      btn.removeAttribute('disabled');
    }
  };

  btn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send();
  });
}

function summarizePayload(payload: unknown): string {
  if (typeof payload === 'string') return payload.slice(0, 80);
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    if (p.message) return String(p.message).slice(0, 80);
    if (p.actionType) return String(p.actionType);
    return JSON.stringify(payload).slice(0, 80);
  }
  return String(payload ?? '');
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
