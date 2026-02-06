// Agent Mind Panel - Real-time agent thinking process visualization
// Shows ReAct loop: Thinking -> Tool Call -> Response
// Dangerous actions highlighted in red with approval buttons

export interface ThinkingStep {
  id: string;
  agentId: string;
  phase: 'thinking' | 'tool_call' | 'tool_result' | 'responding' | 'error';
  content: string;
  toolName?: string;
  toolParams?: Record<string, unknown>;
  toolResult?: unknown;
  safetyLevel?: string;
  timestamp: number;
  requiresApproval?: boolean;
}

let showRawPrompts = false;
let steps: ThinkingStep[] = [];

export async function renderAgentMindPanel(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <h2 class="panel-title">Agent Mind</h2>
    <div class="card">
      <div class="card-header">
        <span class="card-title">Real-time Thinking Process</span>
        <div style="display:flex;align-items:center;gap:8px;">
          <label class="toggle-switch">
            <input type="checkbox" id="raw-prompt-toggle" ${showRawPrompts ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </label>
          <span style="font-size:12px;color:var(--text-secondary);">Show Raw LLM</span>
        </div>
      </div>
    </div>
    <div id="mind-phase-indicator" class="mind-phase-indicator">
      <span class="phase-dot phase-idle"></span>
      <span class="phase-text">Idle</span>
    </div>
    <div id="mind-steps" class="mind-steps"></div>
  `;

  document.getElementById('raw-prompt-toggle')?.addEventListener('change', (e) => {
    showRawPrompts = (e.target as HTMLInputElement).checked;
    renderSteps();
  });

  await refreshAgentMind();
}

export async function refreshAgentMind(): Promise<void> {
  try {
    const data = await window.pawnbutler.agentMind.getSteps();
    if (Array.isArray(data)) {
      steps = data as ThinkingStep[];
    }
  } catch {
    // use existing steps
  }
  renderSteps();
}

export function pushStep(step: ThinkingStep): void {
  steps.push(step);
  if (steps.length > 200) steps.shift();
  renderSteps();
  updatePhaseIndicator(step.phase);
}

function renderSteps(): void {
  const container = document.getElementById('mind-steps');
  if (!container) return;

  if (steps.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="message">No agent activity yet. Send a request to see the thinking process.</div></div>';
    return;
  }

  container.innerHTML = steps.map(renderStep).join('');
  container.scrollTop = container.scrollHeight;
}

function renderStep(step: ThinkingStep): string {
  const time = formatTime(step.timestamp);
  const isDangerous = step.safetyLevel === 'dangerous' || step.safetyLevel === 'forbidden';
  const dangerClass = isDangerous ? ' mind-step-danger' : '';

  let icon = '';
  let phaseLabel = '';
  switch (step.phase) {
    case 'thinking':
      icon = '&#x1F4AD;';
      phaseLabel = 'Thinking';
      break;
    case 'tool_call':
      icon = '&#x1F527;';
      phaseLabel = `Tool: ${escapeHtml(step.toolName ?? 'unknown')}`;
      break;
    case 'tool_result':
      icon = '&#x1F4E5;';
      phaseLabel = 'Tool Result';
      break;
    case 'responding':
      icon = '&#x1F4AC;';
      phaseLabel = 'Responding';
      break;
    case 'error':
      icon = '&#x26A0;';
      phaseLabel = 'Error';
      break;
  }

  let detailsHtml = '';
  if (step.phase === 'tool_call' && step.toolParams && showRawPrompts) {
    detailsHtml = `<pre class="mind-raw">${escapeHtml(JSON.stringify(step.toolParams, null, 2))}</pre>`;
  }
  if (step.phase === 'tool_result' && step.toolResult !== undefined && showRawPrompts) {
    const resultStr = typeof step.toolResult === 'string'
      ? step.toolResult
      : JSON.stringify(step.toolResult, null, 2);
    detailsHtml = `<pre class="mind-raw">${escapeHtml(resultStr.slice(0, 2000))}</pre>`;
  }

  let approvalHtml = '';
  if (step.requiresApproval) {
    approvalHtml = `
      <div class="mind-approval-actions">
        <button class="btn btn-success btn-sm mind-approve-btn" data-step-id="${step.id}">Approve</button>
        <button class="btn btn-danger btn-sm mind-reject-btn" data-step-id="${step.id}">Reject</button>
      </div>
    `;
  }

  return `
    <div class="mind-step${dangerClass}" data-step-id="${step.id}">
      <div class="mind-step-header">
        <span class="mind-step-icon">${icon}</span>
        <span class="mind-step-phase">${phaseLabel}</span>
        <span class="mind-step-agent">${escapeHtml(step.agentId)}</span>
        ${isDangerous ? `<span class="safety-badge safety-${step.safetyLevel}" style="font-size:10px;padding:2px 6px;">${escapeHtml(step.safetyLevel ?? '')}</span>` : ''}
        <span class="mind-step-time">${time}</span>
      </div>
      <div class="mind-step-content">${escapeHtml(step.content)}</div>
      ${detailsHtml}
      ${approvalHtml}
    </div>
  `;
}

function updatePhaseIndicator(phase: string): void {
  const indicator = document.getElementById('mind-phase-indicator');
  if (!indicator) return;

  const labels: Record<string, string> = {
    thinking: 'Thinking...',
    tool_call: 'Calling Tool...',
    tool_result: 'Processing Result...',
    responding: 'Writing Response...',
    error: 'Error',
  };

  const dotClasses: Record<string, string> = {
    thinking: 'phase-thinking',
    tool_call: 'phase-tool',
    tool_result: 'phase-tool',
    responding: 'phase-responding',
    error: 'phase-error',
  };

  indicator.innerHTML = `
    <span class="phase-dot ${dotClasses[phase] || 'phase-idle'}"></span>
    <span class="phase-text">${labels[phase] || 'Idle'}</span>
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
