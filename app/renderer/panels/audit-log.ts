// Audit Log Panel - Filterable timeline, alerts tab, stats

interface AuditEntry {
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

interface AuditFilter {
  agentId?: string;
  actionType?: string;
  safetyLevel?: string;
  startTime?: number;
  endTime?: number;
}

interface AuditSummary {
  totalActions: number;
  blockedCount: number;
  byAgent: Record<string, number>;
}

let currentAuditTab: 'all' | 'alerts' = 'all';
let currentFilter: AuditFilter = {};

export async function renderAuditLog(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <h2 class="panel-title">Audit Log</h2>
    <div class="filter-bar" id="audit-filters">
      <select id="filter-agent">
        <option value="">All Agents</option>
        <option value="butler">Butler</option>
        <option value="researcher">Researcher</option>
        <option value="executor">Executor</option>
        <option value="guardian">Guardian</option>
      </select>
      <select id="filter-action">
        <option value="">All Actions</option>
        <option value="web_search">Web Search</option>
        <option value="web_fetch">Web Fetch</option>
        <option value="read_file">Read File</option>
        <option value="write_file">Write File</option>
        <option value="exec_command">Exec Command</option>
        <option value="edit_file">Edit File</option>
        <option value="api_call">API Call</option>
        <option value="signup">Signup</option>
        <option value="payment">Payment</option>
        <option value="send_message">Send Message</option>
      </select>
      <select id="filter-safety">
        <option value="">All Levels</option>
        <option value="safe">Safe</option>
        <option value="moderate">Moderate</option>
        <option value="dangerous">Dangerous</option>
        <option value="forbidden">Forbidden</option>
      </select>
      <select id="filter-time">
        <option value="">All Time</option>
        <option value="1h">Last 1 Hour</option>
        <option value="24h">Last 24 Hours</option>
        <option value="7d">Last 7 Days</option>
      </select>
    </div>
    <div class="audit-tabs">
      <div class="audit-tab active" data-tab="all">All Logs</div>
      <div class="audit-tab" data-tab="alerts">Alerts Only</div>
    </div>
    <div id="audit-timeline" class="timeline"></div>
    <div id="audit-stats"></div>
  `;

  setupFilterHandlers(container);
  setupAuditTabs(container);
  currentAuditTab = 'all';
  currentFilter = {};
  await refreshAuditLog();
}

function setupFilterHandlers(container: HTMLElement): void {
  const agentSel = container.querySelector('#filter-agent') as HTMLSelectElement;
  const actionSel = container.querySelector('#filter-action') as HTMLSelectElement;
  const safetySel = container.querySelector('#filter-safety') as HTMLSelectElement;
  const timeSel = container.querySelector('#filter-time') as HTMLSelectElement;

  const onChange = () => {
    currentFilter = {};
    if (agentSel.value) currentFilter.agentId = agentSel.value;
    if (actionSel.value) currentFilter.actionType = actionSel.value;
    if (safetySel.value) currentFilter.safetyLevel = safetySel.value;
    if (timeSel.value) {
      const now = Date.now();
      const ms: Record<string, number> = { '1h': 3600000, '24h': 86400000, '7d': 604800000 };
      currentFilter.startTime = now - (ms[timeSel.value] || 0);
    }
    refreshAuditLog();
  };

  agentSel.addEventListener('change', onChange);
  actionSel.addEventListener('change', onChange);
  safetySel.addEventListener('change', onChange);
  timeSel.addEventListener('change', onChange);
}

function setupAuditTabs(container: HTMLElement): void {
  container.querySelectorAll('.audit-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.audit-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentAuditTab = (tab as HTMLElement).dataset.tab as 'all' | 'alerts';
      refreshAuditLog();
    });
  });
}

export async function refreshAuditLog(): Promise<void> {
  const timeline = document.getElementById('audit-timeline');
  const statsEl = document.getElementById('audit-stats');
  if (!timeline) return;

  try {
    let entries: AuditEntry[];

    if (currentAuditTab === 'alerts') {
      entries = (await window.pawnbutler.audit.getAlerts(50)) as AuditEntry[];
    } else {
      entries = (await window.pawnbutler.audit.query(currentFilter as Record<string, unknown>)) as AuditEntry[];
    }

    if (!entries || entries.length === 0) {
      timeline.innerHTML = `
        <div class="empty-state">
          <div class="message">${currentAuditTab === 'alerts' ? 'No alerts' : 'No log entries found'}</div>
        </div>
      `;
      if (statsEl) statsEl.innerHTML = '';
      return;
    }

    timeline.innerHTML = entries.map(renderTimelineItem).join('');

    if (statsEl) {
      try {
        const summary = (await window.pawnbutler.audit.getSummary()) as AuditSummary;
        statsEl.innerHTML = renderStats(summary);
      } catch {
        statsEl.innerHTML = '';
      }
    }
  } catch {
    timeline.innerHTML = '<div class="empty-state"><div class="message">Failed to load audit logs</div></div>';
  }
}

function renderTimelineItem(entry: AuditEntry): string {
  const time = formatTime(entry.timestamp);
  const resultClass = `result-${entry.result}`;
  const isBlocked = entry.result === 'blocked';

  return `
    <div class="timeline-item${isBlocked ? ' blocked' : ''}">
      <span class="timeline-time">${time}</span>
      <span class="timeline-agent">${escapeHtml(entry.agentId)}</span>
      <span class="timeline-action">${escapeHtml(entry.actionType)}</span>
      <span class="safety-badge safety-${entry.safetyLevel}" style="font-size:10px;padding:2px 6px;">${escapeHtml(entry.safetyLevel)}</span>
      <span class="timeline-result ${resultClass}">${entry.result}</span>
      <span class="timeline-details">${entry.details ? escapeHtml(entry.details) : ''}</span>
    </div>
  `;
}

function renderStats(summary: AuditSummary): string {
  const blockRate = summary.totalActions > 0
    ? ((summary.blockedCount / summary.totalActions) * 100).toFixed(1)
    : '0.0';

  const agentEntries = Object.entries(summary.byAgent || {});
  const maxCount = Math.max(...agentEntries.map(([, c]) => c), 1);

  return `
    <div class="stats-bar">
      <div class="stat-item">
        <div class="stat-value">${summary.totalActions}</div>
        <div class="stat-label">Total Actions</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${summary.blockedCount}</div>
        <div class="stat-label">Blocked</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${blockRate}%</div>
        <div class="stat-label">Block Rate</div>
      </div>
    </div>
    ${agentEntries.length > 0 ? `
      <div class="card" style="margin-top:16px">
        <div class="message-flow-title">Activity by Agent</div>
        <div class="bar-chart">
          ${agentEntries.map(([agent, count]) => `
            <div class="bar-chart-item">
              <div class="bar" style="height:${Math.max((count / maxCount) * 50, 4)}px"></div>
              <span class="bar-label">${escapeHtml(agent)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
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
