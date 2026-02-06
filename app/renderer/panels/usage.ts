// Usage Panel - LLM API usage tracking, token counts, costs
// Provider breakdown, daily/weekly charts, budget warnings

export interface UsageStats {
  totalCalls: number;
  totalTokens: number;
  totalCost: number;
  byProvider: Record<string, ProviderUsage>;
  daily: DailyUsage[];
}

export interface ProviderUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface DailyUsage {
  date: string;
  calls: number;
  tokens: number;
  cost: number;
}

let usageData: UsageStats = {
  totalCalls: 0,
  totalTokens: 0,
  totalCost: 0,
  byProvider: {},
  daily: [],
};

let budgetThreshold: number = 0;

export async function renderUsagePanel(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <h2 class="panel-title">Usage &amp; Costs</h2>
    <div id="usage-budget-warning"></div>
    <div id="usage-summary" class="stats-bar" style="margin-bottom:16px;"></div>
    <div id="usage-providers" style="margin-bottom:16px;"></div>
    <div id="usage-chart" class="card" style="margin-bottom:16px;"></div>
    <div class="card">
      <div class="card-header">
        <span class="card-title">Budget Warning Threshold</span>
      </div>
      <div class="usage-budget-row">
        <span style="font-size:13px;color:var(--text-secondary);">Monthly budget limit ($):</span>
        <div class="add-input-group" style="max-width:260px;">
          <input type="number" id="usage-budget-input" placeholder="e.g. 50.00" min="0" step="0.01" value="${budgetThreshold > 0 ? budgetThreshold.toFixed(2) : ''}" />
          <button class="btn btn-primary btn-sm" id="usage-budget-btn">Set</button>
        </div>
      </div>
      <div id="usage-budget-status" style="margin-top:8px;font-size:12px;color:var(--text-muted);"></div>
    </div>
  `;

  document.getElementById('usage-budget-btn')?.addEventListener('click', () => {
    const input = document.getElementById('usage-budget-input') as HTMLInputElement;
    const val = parseFloat(input.value);
    if (!isNaN(val) && val >= 0) {
      budgetThreshold = val;
      renderBudgetWarning();
      renderBudgetStatus();
    }
  });

  document.getElementById('usage-budget-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('usage-budget-btn')?.click();
  });

  await refreshUsage();
}

export async function refreshUsage(): Promise<void> {
  try {
    const data = await window.pawnbutler.usage.getStats();
    if (data && typeof data === 'object') {
      usageData = data as UsageStats;
    }
  } catch {
    // keep existing
  }
  renderBudgetWarning();
  renderSummary();
  renderProviders();
  renderChart();
  renderBudgetStatus();
}

function renderBudgetWarning(): void {
  const container = document.getElementById('usage-budget-warning');
  if (!container) return;

  if (budgetThreshold <= 0) {
    container.innerHTML = '';
    return;
  }

  const pct = (usageData.totalCost / budgetThreshold) * 100;

  if (pct >= 100) {
    container.innerHTML = `
      <div class="usage-budget-alert usage-budget-exceeded">
        Budget exceeded! $${usageData.totalCost.toFixed(2)} / $${budgetThreshold.toFixed(2)} (${pct.toFixed(0)}%)
      </div>
    `;
  } else if (pct >= 80) {
    container.innerHTML = `
      <div class="usage-budget-alert usage-budget-high">
        Approaching budget limit: $${usageData.totalCost.toFixed(2)} / $${budgetThreshold.toFixed(2)} (${pct.toFixed(0)}%)
      </div>
    `;
  } else {
    container.innerHTML = '';
  }
}

function renderBudgetStatus(): void {
  const el = document.getElementById('usage-budget-status');
  if (!el) return;

  if (budgetThreshold <= 0) {
    el.textContent = 'No budget limit set.';
    return;
  }

  const remaining = Math.max(budgetThreshold - usageData.totalCost, 0);
  const pct = (usageData.totalCost / budgetThreshold) * 100;
  el.textContent = `Budget: $${usageData.totalCost.toFixed(2)} / $${budgetThreshold.toFixed(2)} used (${pct.toFixed(1)}%) — $${remaining.toFixed(2)} remaining`;
}

function renderSummary(): void {
  const container = document.getElementById('usage-summary');
  if (!container) return;

  container.innerHTML = `
    <div class="stat-item">
      <div class="stat-value">${usageData.totalCalls.toLocaleString()}</div>
      <div class="stat-label">API Calls</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${formatTokens(usageData.totalTokens)}</div>
      <div class="stat-label">Total Tokens</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">$${usageData.totalCost.toFixed(2)}</div>
      <div class="stat-label">Total Cost</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${Object.keys(usageData.byProvider).length}</div>
      <div class="stat-label">Providers</div>
    </div>
  `;
}

function renderProviders(): void {
  const container = document.getElementById('usage-providers');
  if (!container) return;

  const providers = Object.entries(usageData.byProvider);
  if (providers.length === 0) {
    container.innerHTML = '<div class="card"><div class="empty-state"><div class="message">No provider usage data</div></div></div>';
    return;
  }

  container.innerHTML = providers.map(([name, usage]) => {
    const total = usage.inputTokens + usage.outputTokens;
    const inputPct = total > 0 ? ((usage.inputTokens / total) * 100).toFixed(0) : '0';
    const outputPct = total > 0 ? ((usage.outputTokens / total) * 100).toFixed(0) : '0';

    return `
      <div class="card" style="margin-bottom:8px;">
        <div class="card-header">
          <span class="card-title" style="font-size:14px;">${escapeHtml(name)}</span>
          <span style="font-size:13px;font-weight:600;color:var(--success);">$${usage.cost.toFixed(4)}</span>
        </div>
        <div style="display:flex;gap:16px;font-size:12px;color:var(--text-muted);">
          <span>Calls: ${usage.calls.toLocaleString()}</span>
          <span>Input: ${formatTokens(usage.inputTokens)} (${inputPct}%)</span>
          <span>Output: ${formatTokens(usage.outputTokens)} (${outputPct}%)</span>
        </div>
        <div class="usage-token-bar" style="margin-top:8px;">
          <div class="usage-token-bar-input" style="width:${inputPct}%;"></div>
          <div class="usage-token-bar-output" style="width:${outputPct}%;"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderChart(): void {
  const container = document.getElementById('usage-chart');
  if (!container) return;

  const daily = usageData.daily.slice(-7);
  if (daily.length === 0) {
    container.innerHTML = `
      <div class="card-header"><span class="card-title">Daily Usage (7 days)</span></div>
      <div class="empty-state"><div class="message">No daily data yet</div></div>
    `;
    return;
  }

  const maxTokens = Math.max(...daily.map(d => d.tokens), 1);
  const maxCost = Math.max(...daily.map(d => d.cost), 0.01);

  container.innerHTML = `
    <div class="card-header">
      <span class="card-title">Daily Usage (7 days)</span>
      <span style="font-size:11px;color:var(--text-muted);">Tokens + Cost</span>
    </div>
    <div class="bar-chart" style="height:100px;">
      ${daily.map(d => {
        const tokenH = Math.max((d.tokens / maxTokens) * 80, 4);
        const costH = Math.max((d.cost / maxCost) * 80, 4);
        return `
          <div class="bar-chart-item">
            <div style="display:flex;gap:2px;align-items:flex-end;height:80px;">
              <div class="bar" style="height:${tokenH}px;background:var(--accent);"></div>
              <div class="bar" style="height:${costH}px;background:var(--success);opacity:0.7;"></div>
            </div>
            <span class="bar-label">${d.date.slice(5)}</span>
          </div>
        `;
      }).join('')}
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:11px;color:var(--text-muted);">
      <span>Total: ${formatTokens(daily.reduce((s, d) => s + d.tokens, 0))} tokens</span>
      <span>Cost: $${daily.reduce((s, d) => s + d.cost, 0).toFixed(2)}</span>
    </div>
    <div style="display:flex;gap:16px;margin-top:4px;font-size:10px;color:var(--text-muted);">
      <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:var(--accent);border-radius:2px;display:inline-block;"></span>Tokens</span>
      <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:var(--success);opacity:0.7;border-radius:2px;display:inline-block;"></span>Cost</span>
    </div>
  `;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
