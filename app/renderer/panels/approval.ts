// Approval Panel - Pending requests, approve/reject with modal

interface ApprovalItem {
  actionRequest: {
    id: string;
    agentId: string;
    agentRole: string;
    actionType: string;
    params: Record<string, unknown>;
    safetyLevel: string;
    timestamp: number;
    requiresApproval: boolean;
  };
  status: string;
  reviewedBy?: string;
  reviewedAt?: number;
  reason?: string;
}

let currentTab: 'pending' | 'history' = 'pending';

export async function renderApprovalPanel(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <h2 class="panel-title">Approval Queue</h2>
    <div class="approval-tabs">
      <div class="approval-tab active" data-tab="pending">Pending</div>
      <div class="approval-tab" data-tab="history">History</div>
    </div>
    <div id="approval-content"></div>
  `;

  container.querySelectorAll('.approval-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.approval-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = (tab as HTMLElement).dataset.tab as 'pending' | 'history';
      refreshApprovals();
    });
  });

  currentTab = 'pending';
  await refreshApprovals();
}

export async function refreshApprovals(): Promise<void> {
  const content = document.getElementById('approval-content');
  if (!content) return;

  try {
    const items = (await window.pawnbutler.approval.list()) as ApprovalItem[];
    if (!items || items.length === 0) {
      content.innerHTML = renderEmpty();
      return;
    }

    const filtered = currentTab === 'pending'
      ? items.filter(i => i.status === 'pending')
      : items.filter(i => i.status !== 'pending');

    if (filtered.length === 0) {
      content.innerHTML = currentTab === 'pending'
        ? renderEmpty()
        : '<div class="empty-state"><div class="message">No approval history yet</div></div>';
      return;
    }

    content.innerHTML = filtered.map(renderApprovalCard).join('');
    attachApprovalHandlers(content);
  } catch {
    content.innerHTML = renderEmpty();
  }
}

function renderEmpty(): string {
  return `
    <div class="empty-state">
      <div class="icon">\u2705</div>
      <div class="message">No pending approval requests</div>
    </div>
  `;
}

function renderApprovalCard(item: ApprovalItem): string {
  const req = item.actionRequest;
  const safetyClass = `safety-${req.safetyLevel}`;
  const isPending = item.status === 'pending';

  let paramsHtml = '';
  if (req.params) {
    if (req.params.url) {
      paramsHtml += renderDetail('URL', String(req.params.url));
    }
    if (req.params.file || req.params.path) {
      paramsHtml += renderDetail('File', String(req.params.file || req.params.path));
    }
    if (req.params.command) {
      paramsHtml += renderDetail('Command', String(req.params.command));
    }
  }

  let planHtml = '';
  if (req.params && req.params.plan && Array.isArray(req.params.plan)) {
    const steps = req.params.plan as Array<{ action?: string; description?: string }>;
    planHtml = `
      <div class="plan-steps">
        ${steps.map((step, i) => `
          <div class="step">
            <span class="step-num">${i + 1}.</span>
            <span>${escapeHtml(step.description || step.action || String(step))}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  let statusHtml = '';
  if (!isPending) {
    statusHtml = `
      <div style="margin-top: 12px; display: flex; align-items: center; gap: 8px;">
        <span class="approval-status status-${item.status}">${item.status}</span>
        ${item.reason ? `<span style="font-size: 12px; color: var(--text-muted);">- ${escapeHtml(item.reason)}</span>` : ''}
        ${item.reviewedAt ? `<span style="font-size: 11px; color: var(--text-muted);">${formatTime(item.reviewedAt)}</span>` : ''}
      </div>
    `;
  }

  return `
    <div class="approval-card" data-request-id="${req.id}">
      <div class="approval-card-header">
        <span class="approval-agent">${escapeHtml(req.agentId)} (${escapeHtml(req.agentRole)})</span>
        <span class="safety-badge ${safetyClass}">${escapeHtml(req.safetyLevel)}</span>
      </div>
      <div class="approval-body">
        ${renderDetail('Action', req.actionType)}
        ${paramsHtml}
        ${planHtml}
      </div>
      ${isPending ? `
        <div class="approval-actions">
          <button class="btn btn-success btn-sm approve-btn" data-id="${req.id}">Approve</button>
          <button class="btn btn-danger btn-sm reject-btn" data-id="${req.id}">Reject</button>
        </div>
      ` : statusHtml}
    </div>
  `;
}

function renderDetail(label: string, value: string): string {
  return `
    <div class="approval-detail">
      <span class="label">${escapeHtml(label)}</span>
      <span class="value">${escapeHtml(value)}</span>
    </div>
  `;
}

function attachApprovalHandlers(container: HTMLElement): void {
  container.querySelectorAll('.approve-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset.id!;
      (btn as HTMLButtonElement).disabled = true;
      try {
        await window.pawnbutler.approval.approve(id);
        await refreshApprovals();
      } catch {
        (btn as HTMLButtonElement).disabled = false;
      }
    });
  });

  container.querySelectorAll('.reject-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.id!;
      showRejectModal(id);
    });
  });
}

function showRejectModal(requestId: string): void {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Reject Request</h3>
      <textarea id="reject-reason" placeholder="Enter rejection reason..."></textarea>
      <div class="modal-actions">
        <button class="btn btn-sm" id="cancel-reject">Cancel</button>
        <button class="btn btn-danger btn-sm" id="confirm-reject">Reject</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#cancel-reject')!.addEventListener('click', () => {
    overlay.remove();
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#confirm-reject')!.addEventListener('click', async () => {
    const reason = (document.getElementById('reject-reason') as HTMLTextAreaElement).value.trim();
    overlay.remove();
    try {
      await window.pawnbutler.approval.reject(requestId, reason || 'Rejected by user');
      await refreshApprovals();
    } catch {
      // will refresh on next poll
    }
  });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
