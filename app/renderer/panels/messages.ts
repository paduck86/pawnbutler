// Messages Panel - All channel messages timeline with review/approve/reject
// Covers WhatsApp, Telegram, Discord, Slack bidirectional messaging

export interface ChannelMessage {
  id: string;
  direction: 'incoming' | 'outgoing';
  channel: 'whatsapp' | 'telegram' | 'discord' | 'slack';
  senderId?: string;
  senderName?: string;
  recipientId?: string;
  text: string;
  status: 'received' | 'pending_review' | 'approved' | 'rejected' | 'sent' | 'blocked';
  reason?: string;
  timestamp: number;
}

let channelFilter: string = '';
let messages: ChannelMessage[] = [];

const CHANNEL_ICONS: Record<string, string> = {
  whatsapp: 'WA',
  telegram: 'TG',
  discord: 'DC',
  slack: 'SL',
};

const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: '#25d366',
  telegram: '#0088cc',
  discord: '#5865f2',
  slack: '#4a154b',
};

export async function renderMessagesPanel(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <h2 class="panel-title">Message Center</h2>
    <div class="card">
      <div class="card-header">
        <span class="card-title">Channel Messages</span>
        <div class="msg-filter-bar">
          <button class="btn btn-sm msg-filter-btn active" data-channel="">All</button>
          <button class="btn btn-sm msg-filter-btn" data-channel="whatsapp" style="border-left:3px solid #25d366;">WA</button>
          <button class="btn btn-sm msg-filter-btn" data-channel="telegram" style="border-left:3px solid #0088cc;">TG</button>
          <button class="btn btn-sm msg-filter-btn" data-channel="discord" style="border-left:3px solid #5865f2;">DC</button>
          <button class="btn btn-sm msg-filter-btn" data-channel="slack" style="border-left:3px solid #4a154b;">SL</button>
        </div>
      </div>
    </div>
    <div id="msg-pending-section"></div>
    <div id="msg-timeline" class="msg-timeline"></div>
    <div id="msg-search-bar" class="card" style="margin-top:12px;">
      <div class="add-input-group">
        <input type="text" id="msg-search-input" placeholder="Search messages..." />
        <button class="btn btn-primary btn-sm" id="msg-search-btn">Search</button>
      </div>
    </div>
  `;

  container.querySelectorAll('.msg-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.msg-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      channelFilter = (btn as HTMLElement).dataset.channel || '';
      renderMessages();
    });
  });

  document.getElementById('msg-search-btn')?.addEventListener('click', () => {
    const input = document.getElementById('msg-search-input') as HTMLInputElement;
    const query = input.value.trim().toLowerCase();
    renderMessages(query);
  });

  document.getElementById('msg-search-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('msg-search-btn')?.click();
  });

  await refreshMessages();
}

export async function refreshMessages(): Promise<void> {
  try {
    const data = await window.pawnbutler.messages.getAll();
    if (Array.isArray(data)) {
      messages = data as ChannelMessage[];
    }
  } catch {
    // use cached
  }
  renderMessages();
  renderPendingReview();
}

function renderMessages(searchQuery?: string): void {
  const container = document.getElementById('msg-timeline');
  if (!container) return;

  let filtered = messages;
  if (channelFilter) {
    filtered = filtered.filter(m => m.channel === channelFilter);
  }
  if (searchQuery) {
    filtered = filtered.filter(m =>
      m.text.toLowerCase().includes(searchQuery) ||
      (m.senderName || '').toLowerCase().includes(searchQuery)
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="message">No messages</div></div>';
    return;
  }

  container.innerHTML = filtered.slice(-100).map(renderMessageItem).join('');
  container.scrollTop = container.scrollHeight;
}

function renderPendingReview(): void {
  const section = document.getElementById('msg-pending-section');
  if (!section) return;

  const pending = messages.filter(m => m.status === 'pending_review');
  if (pending.length === 0) {
    section.innerHTML = '';
    return;
  }

  section.innerHTML = `
    <div class="card" style="border-left:3px solid var(--warning);">
      <div class="card-header">
        <span class="card-title">Pending Review (${pending.length})</span>
      </div>
      ${pending.map(renderPendingItem).join('')}
    </div>
  `;

  section.querySelectorAll('.msg-approve-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset.msgId!;
      const textarea = section.querySelector(`textarea[data-msg-id="${id}"]`) as HTMLTextAreaElement | null;
      const editedText = textarea?.value;
      try {
        await window.pawnbutler.messages.approve(id, editedText);
        await refreshMessages();
      } catch { /* retry */ }
    });
  });

  section.querySelectorAll('.msg-reject-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset.msgId!;
      try {
        await window.pawnbutler.messages.reject(id, 'Rejected by user');
        await refreshMessages();
      } catch { /* retry */ }
    });
  });
}

function renderPendingItem(msg: ChannelMessage): string {
  const color = CHANNEL_COLORS[msg.channel] || 'var(--text-muted)';
  const icon = CHANNEL_ICONS[msg.channel] || '??';

  return `
    <div class="msg-pending-item">
      <div class="msg-pending-header">
        <span class="msg-channel-badge" style="background:${color};">${icon}</span>
        <span style="font-size:12px;color:var(--text-muted);">To: ${escapeHtml(msg.recipientId || 'unknown')}</span>
      </div>
      <textarea class="msg-edit-area" data-msg-id="${msg.id}">${escapeHtml(msg.text)}</textarea>
      <div class="approval-actions" style="margin-top:8px;">
        <button class="btn btn-success btn-sm msg-approve-btn" data-msg-id="${msg.id}">Send</button>
        <button class="btn btn-danger btn-sm msg-reject-btn" data-msg-id="${msg.id}">Discard</button>
      </div>
    </div>
  `;
}

function renderMessageItem(msg: ChannelMessage): string {
  const color = CHANNEL_COLORS[msg.channel] || 'var(--text-muted)';
  const icon = CHANNEL_ICONS[msg.channel] || '??';
  const time = formatTime(msg.timestamp);
  const isIncoming = msg.direction === 'incoming';
  const dirClass = isIncoming ? 'msg-incoming' : 'msg-outgoing';

  let statusHtml = '';
  if (msg.status === 'blocked') {
    statusHtml = `<span class="timeline-result result-blocked">blocked</span>`;
  } else if (msg.status === 'rejected') {
    statusHtml = `<span class="timeline-result result-blocked">rejected</span>`;
  } else if (msg.status === 'sent') {
    statusHtml = `<span class="timeline-result result-success">sent</span>`;
  }

  return `
    <div class="msg-item ${dirClass}">
      <span class="msg-channel-badge" style="background:${color};">${icon}</span>
      <div class="msg-item-body">
        <div class="msg-item-header">
          <span class="msg-sender">${isIncoming ? escapeHtml(msg.senderName || msg.senderId || '?') : 'Agent'}</span>
          <span class="msg-direction">${isIncoming ? '&#x2192; Agent' : '&#x2192; ' + escapeHtml(msg.recipientId || '?')}</span>
          ${statusHtml}
          <span class="msg-time">${time}</span>
        </div>
        <div class="msg-text">${escapeHtml(msg.text)}</div>
        ${msg.reason ? `<div class="msg-reason">${escapeHtml(msg.reason)}</div>` : ''}
      </div>
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
