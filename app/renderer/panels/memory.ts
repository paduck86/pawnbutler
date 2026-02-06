// Memory Viewer Panel - Searchable memory list, semantic search test box, stats, delete

export interface MemoryItem {
  id: string;
  content: string;
  metadata: {
    source?: string;
    agentId?: string;
    tags?: string[];
    type?: string;
  };
  score?: number;
  matchType?: string;
  createdAt: number;
}

export interface MemoryStats {
  totalEntries: number;
  dbSizeBytes: number;
}

let memoryItems: MemoryItem[] = [];
let recentlyReferenced: Set<string> = new Set();
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export async function renderMemoryPanel(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <h2 class="panel-title">Memory Viewer</h2>
    <div id="memory-stats" class="stats-bar" style="margin-bottom:20px"></div>
    <div class="card">
      <div class="card-header">
        <span class="card-title">Semantic Search</span>
      </div>
      <div class="memory-search-row">
        <input type="text" id="memory-search-input" placeholder="Search agent memories..." />
        <select id="memory-search-method" class="memory-method-select">
          <option value="hybrid">Hybrid</option>
          <option value="semantic">Semantic</option>
          <option value="keyword">Keyword</option>
        </select>
        <button class="btn btn-primary btn-sm" id="memory-search-btn">Search</button>
      </div>
    </div>
    <div id="memory-search-results" style="margin-top:12px;"></div>
    <div class="card" style="margin-top:12px;">
      <div class="card-header">
        <span class="card-title">All Stored Memories</span>
        <span id="memory-count-label" style="font-size:12px;color:var(--text-muted);"></span>
      </div>
      <div id="memory-list"></div>
    </div>
  `;

  setupSearchHandlers();
  await refreshMemory();
}

function setupSearchHandlers(): void {
  const input = document.getElementById('memory-search-input') as HTMLInputElement | null;
  const btn = document.getElementById('memory-search-btn');

  if (!input || !btn) return;

  const doSearch = async () => {
    const query = input.value.trim();
    if (!query) {
      document.getElementById('memory-search-results')!.innerHTML = '';
      await loadAllMemories();
      return;
    }
    await searchMemories(query);
  };

  btn.addEventListener('click', doSearch);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });

  // Debounced auto-search
  input.addEventListener('input', () => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      if (input.value.trim().length >= 3) doSearch();
    }, 400);
  });
}

export async function refreshMemory(): Promise<void> {
  await renderStats();
  await loadAllMemories();
}

async function renderStats(): Promise<void> {
  const statsEl = document.getElementById('memory-stats');
  if (!statsEl) return;

  try {
    const stats = (await window.pawnbutler.memory.getStats()) as MemoryStats;
    statsEl.innerHTML = `
      <div class="stat-item">
        <div class="stat-value">${stats.totalEntries}</div>
        <div class="stat-label">Total Memories</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${formatBytes(stats.dbSizeBytes)}</div>
        <div class="stat-label">DB Size</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${recentlyReferenced.size}</div>
        <div class="stat-label">Recently Referenced</div>
      </div>
    `;
  } catch {
    statsEl.innerHTML = `
      <div class="stat-item">
        <div class="stat-value">--</div>
        <div class="stat-label">Total Memories</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">--</div>
        <div class="stat-label">DB Size</div>
      </div>
    `;
  }
}

async function loadAllMemories(): Promise<void> {
  try {
    const data = await window.pawnbutler.memory.list();
    if (Array.isArray(data)) {
      memoryItems = data as MemoryItem[];
    }
  } catch {
    memoryItems = [];
  }
  renderMemoryList();
}

async function searchMemories(query: string): Promise<void> {
  const resultsEl = document.getElementById('memory-search-results');
  if (!resultsEl) return;

  const method = (document.getElementById('memory-search-method') as HTMLSelectElement)?.value ?? 'hybrid';

  resultsEl.innerHTML = '<div class="card"><div style="padding:16px;color:var(--text-muted);">Searching...</div></div>';

  try {
    const response = await window.pawnbutler.memory.search(query, method, 10);
    const results = ((response as { results?: MemoryItem[] }).results ?? response) as MemoryItem[];

    if (!Array.isArray(results) || results.length === 0) {
      resultsEl.innerHTML = `
        <div class="card">
          <div class="empty-state" style="padding:24px">
            <div class="message">No results for "${escapeHtml(query)}"</div>
          </div>
        </div>
      `;
      return;
    }

    // Track recently referenced
    for (const r of results) {
      recentlyReferenced.add(r.id);
    }

    resultsEl.innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">Search Results (${results.length})</span>
          <span style="font-size:11px;color:var(--text-muted);">Method: ${escapeHtml(method)}</span>
        </div>
        ${results.map(renderSearchResult).join('')}
      </div>
    `;
  } catch {
    resultsEl.innerHTML = `
      <div class="card">
        <div class="empty-state" style="padding:24px">
          <div class="message">Search failed. Memory system may not be initialized.</div>
        </div>
      </div>
    `;
  }
}

function renderSearchResult(item: MemoryItem): string {
  const time = formatTime(item.createdAt);
  const score = item.score !== undefined ? (item.score * 100).toFixed(1) + '%' : '';
  const matchType = item.matchType ?? '';
  const tags = (item.metadata?.tags ?? []).map(t => `<span class="memory-tag">${escapeHtml(t)}</span>`).join('');

  return `
    <div class="memory-entry search-result">
      <div class="memory-entry-header">
        ${score ? `<span class="memory-score">${score}</span>` : ''}
        ${matchType ? `<span class="memory-match-badge">${escapeHtml(matchType)}</span>` : ''}
        <span class="memory-source">${escapeHtml(item.metadata?.source ?? '')}</span>
        ${item.metadata?.agentId ? `<span class="memory-agent-badge">${escapeHtml(item.metadata.agentId)}</span>` : ''}
        <span style="font-size:11px;color:var(--text-muted);margin-left:auto;">${time}</span>
      </div>
      <div class="memory-content-text">${escapeHtml(item.content.slice(0, 400))}${item.content.length > 400 ? '...' : ''}</div>
      ${tags ? `<div class="memory-tags-row">${tags}</div>` : ''}
    </div>
  `;
}

function renderMemoryList(): void {
  const container = document.getElementById('memory-list');
  const countLabel = document.getElementById('memory-count-label');
  if (!container) return;

  if (countLabel) {
    countLabel.textContent = `${memoryItems.length} entries`;
  }

  if (memoryItems.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:30px"><div class="message">No memories stored</div></div>';
    return;
  }

  container.innerHTML = memoryItems.map(renderMemoryItem).join('');

  // Setup delete handlers
  container.querySelectorAll('.memory-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset.memoryId!;
      if (!confirm('Delete this memory entry?')) return;
      try {
        await window.pawnbutler.memory.remove(id);
        recentlyReferenced.delete(id);
        await refreshMemory();
      } catch { /* silent */ }
    });
  });
}

function renderMemoryItem(item: MemoryItem): string {
  const time = formatTime(item.createdAt);
  const isRecent = recentlyReferenced.has(item.id);
  const typeLabel = item.metadata?.type ?? 'note';
  const tags = (item.metadata?.tags ?? []).map(t => `<span class="memory-tag">${escapeHtml(t)}</span>`).join('');

  return `
    <div class="memory-entry${isRecent ? ' memory-referenced' : ''}" data-memory-id="${item.id}">
      <div class="memory-entry-header">
        <span class="memory-type-badge memory-type-${typeLabel}">${escapeHtml(typeLabel)}</span>
        <span class="memory-source">${escapeHtml(item.metadata?.source ?? '')}</span>
        ${item.metadata?.agentId ? `<span class="memory-agent-badge">${escapeHtml(item.metadata.agentId)}</span>` : ''}
        ${isRecent ? '<span class="memory-ref-badge">Referenced</span>' : ''}
        <span style="font-size:11px;color:var(--text-muted);margin-left:auto;">${time}</span>
        <button class="btn btn-danger btn-sm memory-delete-btn" data-memory-id="${item.id}">Delete</button>
      </div>
      <div class="memory-content-text">${escapeHtml(item.content.slice(0, 300))}${item.content.length > 300 ? '...' : ''}</div>
      ${tags ? `<div class="memory-tags-row">${tags}</div>` : ''}
    </div>
  `;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
