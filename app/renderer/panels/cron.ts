// Cron Panel - Scheduled tasks management
// List, add, edit, delete cron jobs with execution history

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  targetAgent: string;
  taskDescription: string;
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
  runCount: number;
}

let cronJobs: CronJob[] = [];

export async function renderCronPanel(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <h2 class="panel-title">Scheduled Tasks</h2>
    <div class="card">
      <div class="card-header">
        <span class="card-title">Cron Jobs</span>
        <button class="btn btn-primary btn-sm" id="cron-add-btn">Add Job</button>
      </div>
    </div>
    <div id="cron-list" style="margin-top:12px;"></div>
  `;

  document.getElementById('cron-add-btn')?.addEventListener('click', () => {
    showCronModal();
  });

  await refreshCron();
}

export async function refreshCron(): Promise<void> {
  try {
    const data = await window.pawnbutler.cron.list();
    if (Array.isArray(data)) {
      cronJobs = data as CronJob[];
    }
  } catch {
    cronJobs = [];
  }
  renderCronList();
}

function renderCronList(): void {
  const container = document.getElementById('cron-list');
  if (!container) return;

  if (cronJobs.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="message">No scheduled tasks</div></div>';
    return;
  }

  container.innerHTML = cronJobs.map(renderCronItem).join('');

  container.querySelectorAll('.cron-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset.cronId!;
      if (!confirm('Delete this scheduled task?')) return;
      try {
        await window.pawnbutler.cron.remove(id);
        await refreshCron();
      } catch { /* retry */ }
    });
  });

  container.querySelectorAll('.cron-toggle').forEach(toggle => {
    toggle.addEventListener('change', async () => {
      const id = (toggle as HTMLInputElement).dataset.cronId!;
      const enabled = (toggle as HTMLInputElement).checked;
      try {
        await window.pawnbutler.cron.update(id, { enabled });
        await refreshCron();
      } catch { /* retry */ }
    });
  });
}

function renderCronItem(job: CronJob): string {
  const lastRunStr = job.lastRun ? formatTime(job.lastRun) : 'Never';
  const nextRunStr = job.nextRun ? formatTime(job.nextRun) : 'N/A';

  return `
    <div class="card cron-item" data-cron-id="${job.id}">
      <div class="card-header">
        <div>
          <span style="font-weight:600;font-size:14px;">${escapeHtml(job.name)}</span>
          <span style="font-size:12px;color:var(--text-muted);margin-left:8px;font-family:monospace;">${escapeHtml(job.schedule)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <label class="toggle-switch">
            <input type="checkbox" ${job.enabled ? 'checked' : ''} class="cron-toggle" data-cron-id="${job.id}" />
            <span class="toggle-slider"></span>
          </label>
          <button class="btn btn-danger btn-sm cron-delete-btn" data-cron-id="${job.id}">Delete</button>
        </div>
      </div>
      <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">${escapeHtml(job.taskDescription)}</div>
      <div style="display:flex;gap:16px;font-size:12px;color:var(--text-muted);">
        <span>Agent: ${escapeHtml(job.targetAgent)}</span>
        <span>Runs: ${job.runCount}</span>
        <span>Last: ${lastRunStr}</span>
        <span>Next: ${nextRunStr}</span>
      </div>
    </div>
  `;
}

function showCronModal(): void {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="width:500px;">
      <h3>Add Scheduled Task</h3>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <input type="text" id="cron-name" placeholder="Task name" style="background:var(--bg-primary);border:1px solid var(--border);border-radius:6px;padding:8px 12px;color:var(--text-primary);font-size:13px;" />
        <input type="text" id="cron-schedule" placeholder="Cron expression (e.g. 0 9 * * *)" style="background:var(--bg-primary);border:1px solid var(--border);border-radius:6px;padding:8px 12px;color:var(--text-primary);font-size:13px;" />
        <input type="text" id="cron-agent" placeholder="Target agent (e.g. butler)" style="background:var(--bg-primary);border:1px solid var(--border);border-radius:6px;padding:8px 12px;color:var(--text-primary);font-size:13px;" />
        <textarea id="cron-description" placeholder="Task description..." style="background:var(--bg-primary);border:1px solid var(--border);border-radius:6px;padding:8px 12px;color:var(--text-primary);font-size:13px;min-height:80px;resize:vertical;font-family:inherit;"></textarea>
      </div>
      <div class="modal-actions">
        <button class="btn btn-sm" id="cron-cancel">Cancel</button>
        <button class="btn btn-success btn-sm" id="cron-confirm">Add</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#cron-cancel')!.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#cron-confirm')!.addEventListener('click', async () => {
    const name = (document.getElementById('cron-name') as HTMLInputElement).value.trim();
    const schedule = (document.getElementById('cron-schedule') as HTMLInputElement).value.trim();
    const agent = (document.getElementById('cron-agent') as HTMLInputElement).value.trim();
    const description = (document.getElementById('cron-description') as HTMLTextAreaElement).value.trim();

    if (!name || !schedule || !agent || !description) return;
    overlay.remove();

    try {
      await window.pawnbutler.cron.add({ name, schedule, targetAgent: agent, taskDescription: description });
      await refreshCron();
    } catch { /* retry */ }
  });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
