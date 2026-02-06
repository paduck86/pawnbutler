// Settings Panel - URL lists, agent permissions, vault, config

interface AgentConfig {
  id: string;
  role: string;
  name: string;
  allowedTools: string[];
  deniedTools: string[];
}

interface FullConfig {
  agents: AgentConfig[];
  urlAllowlist: string[];
  urlBlocklist: string[];
  [key: string]: unknown;
}

const ALL_TOOLS = [
  'web_search', 'web_fetch', 'read_file', 'write_file',
  'exec_command', 'edit_file', 'api_call', 'signup',
  'payment', 'send_message',
];

export async function renderSettings(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <h2 class="panel-title">Settings</h2>
    <div id="settings-allowlist" class="settings-section"></div>
    <div id="settings-blocklist" class="settings-section"></div>
    <div id="settings-agents" class="settings-section"></div>
    <div id="settings-vault" class="settings-section"></div>
    <div style="margin-top: 24px;">
      <button class="btn btn-success" id="save-settings-btn">Save Settings</button>
    </div>
  `;

  await Promise.all([
    renderUrlAllowlist(),
    renderUrlBlocklist(),
    renderAgentPermissions(),
    renderVault(),
  ]);

  document.getElementById('save-settings-btn')?.addEventListener('click', saveSettings);
}

async function renderUrlAllowlist(): Promise<void> {
  const section = document.getElementById('settings-allowlist');
  if (!section) return;

  let domains: string[] = [];
  try {
    domains = await window.pawnbutler.url.getAllowlist();
  } catch { /* empty */ }

  section.innerHTML = `
    <h2>URL Allowlist</h2>
    <div class="tag-list" id="allowlist-tags">
      ${(domains || []).map(d => renderTag(d, 'allowlist')).join('')}
    </div>
    <div class="add-input-group">
      <input type="text" id="add-allowlist-input" placeholder="Add allowed domain (e.g. github.com)" />
      <button class="btn btn-primary btn-sm" id="add-allowlist-btn">Add</button>
    </div>
  `;

  attachTagRemoveHandlers(section, 'allowlist');

  document.getElementById('add-allowlist-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('add-allowlist-input') as HTMLInputElement;
    const domain = input.value.trim();
    if (!domain) return;
    input.value = '';
    try {
      await window.pawnbutler.url.addAllowed(domain);
      await renderUrlAllowlist();
    } catch { /* retry on next refresh */ }
  });

  document.getElementById('add-allowlist-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('add-allowlist-btn')?.click();
  });
}

async function renderUrlBlocklist(): Promise<void> {
  const section = document.getElementById('settings-blocklist');
  if (!section) return;

  let patterns: string[] = [];
  try {
    patterns = await window.pawnbutler.url.getBlocklist();
  } catch { /* empty */ }

  section.innerHTML = `
    <h2>URL Blocklist</h2>
    <div class="tag-list" id="blocklist-tags">
      ${(patterns || []).map(p => renderTag(p, 'blocklist')).join('')}
    </div>
    <div class="add-input-group">
      <input type="text" id="add-blocklist-input" placeholder="Add blocked pattern (e.g. *.malware.com)" />
      <button class="btn btn-primary btn-sm" id="add-blocklist-btn">Add</button>
    </div>
  `;

  attachTagRemoveHandlers(section, 'blocklist');

  document.getElementById('add-blocklist-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('add-blocklist-input') as HTMLInputElement;
    const pattern = input.value.trim();
    if (!pattern) return;
    input.value = '';
    try {
      await window.pawnbutler.url.addBlocked(pattern);
      await renderUrlBlocklist();
    } catch { /* retry on next refresh */ }
  });

  document.getElementById('add-blocklist-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('add-blocklist-btn')?.click();
  });
}

async function renderAgentPermissions(): Promise<void> {
  const section = document.getElementById('settings-agents');
  if (!section) return;

  let config: FullConfig | null = null;
  try {
    config = (await window.pawnbutler.config.get()) as FullConfig;
  } catch { /* empty */ }

  const agents = config?.agents || [];

  section.innerHTML = `
    <h2>Agent Permissions</h2>
    <div class="accordion" id="agent-accordion">
      ${agents.map(renderAgentAccordion).join('')}
    </div>
  `;

  section.querySelectorAll('.accordion-header').forEach(header => {
    header.addEventListener('click', () => {
      const item = header.parentElement!;
      item.classList.toggle('open');
    });
  });
}

function renderAgentAccordion(agent: AgentConfig): string {
  const toolToggles = ALL_TOOLS.map(tool => {
    const isAllowed = agent.allowedTools.includes(tool) || (!agent.deniedTools.includes(tool) && agent.allowedTools.includes('*'));
    return `
      <div class="toggle-row">
        <span class="toggle-label">${escapeHtml(tool)}</span>
        <label class="toggle-switch">
          <input type="checkbox" ${isAllowed ? 'checked' : ''} data-agent="${agent.id}" data-tool="${tool}" class="tool-toggle" />
          <span class="toggle-slider"></span>
        </label>
      </div>
    `;
  }).join('');

  return `
    <div class="accordion-item" data-agent-id="${agent.id}">
      <div class="accordion-header">
        <span>${escapeHtml(agent.name)} (${escapeHtml(agent.role)})</span>
        <span class="arrow">\u25B6</span>
      </div>
      <div class="accordion-body">
        ${toolToggles}
      </div>
    </div>
  `;
}

async function renderVault(): Promise<void> {
  const section = document.getElementById('settings-vault');
  if (!section) return;

  let keys: string[] = [];
  try {
    keys = await window.pawnbutler.vault.getKeys();
  } catch { /* empty */ }

  section.innerHTML = `
    <h2>Secret Vault</h2>
    <div id="vault-keys">
      ${(keys || []).map(k => `
        <div class="vault-item">
          <span class="vault-key">${escapeHtml(k)}</span>
          <span class="vault-value">***</span>
        </div>
      `).join('')}
      ${(!keys || keys.length === 0) ? '<div style="color: var(--text-muted); font-size: 13px;">No secrets stored</div>' : ''}
    </div>
  `;
}

async function saveSettings(): Promise<void> {
  const btn = document.getElementById('save-settings-btn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const toggles = document.querySelectorAll('.tool-toggle') as NodeListOf<HTMLInputElement>;
    const agentTools: Record<string, string[]> = {};

    toggles.forEach(toggle => {
      const agentId = toggle.dataset.agent!;
      const tool = toggle.dataset.tool!;
      if (!agentTools[agentId]) agentTools[agentId] = [];
      if (toggle.checked) agentTools[agentId].push(tool);
    });

    const updates: Record<string, unknown> = {};
    for (const [agentId, tools] of Object.entries(agentTools)) {
      updates[`agent:${agentId}:allowedTools`] = tools;
    }

    await window.pawnbutler.config.update(updates);
    btn.textContent = 'Saved!';
    setTimeout(() => {
      btn.textContent = 'Save Settings';
      btn.disabled = false;
    }, 1500);
  } catch {
    btn.textContent = 'Save Failed';
    setTimeout(() => {
      btn.textContent = 'Save Settings';
      btn.disabled = false;
    }, 1500);
  }
}

function renderTag(value: string, listType: string): string {
  return `
    <span class="tag" data-value="${escapeAttr(value)}" data-list="${listType}">
      ${escapeHtml(value)}
      <span class="tag-remove">\u00D7</span>
    </span>
  `;
}

function attachTagRemoveHandlers(section: HTMLElement, _listType: string): void {
  section.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.parentElement as HTMLElement;
      tag.remove();
      // Note: actual removal from backend would require a remove API
      // For now, tags are removed from the UI only
    });
  });
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
