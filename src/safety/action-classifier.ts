// PawnButler Action Classifier - Risk level classification for agent actions

import type {
  ActionRequest,
  ActionType,
  SafetyConfig,
  SafetyLevel,
} from '../core/types.js';

const DEFAULT_SECRET_PATTERNS: RegExp[] = [
  /AKIA[A-Z0-9]{16}/,                                          // AWS Access Key
  /sk-[a-zA-Z0-9]{20,}/,                                       // OpenAI API Key
  /ghp_[a-zA-Z0-9]{36}/,                                       // GitHub PAT
  /sk-ant-[a-zA-Z0-9-]{20,}/,                                  // Anthropic API Key
  /xoxb-[0-9]{10,}/,                                            // Slack Bot Token
  /Bearer\s+[a-zA-Z0-9._-]{20,}/,                              // Generic Bearer Token
  /[a-zA-Z0-9_-]*api[_-]?key[a-zA-Z0-9_-]*[:=]\s*['"]?[a-zA-Z0-9]{16,}/i, // Generic API key
];

const FORBIDDEN_ACTIONS: ActionType[] = ['signup', 'payment'];

const DANGEROUS_ACTIONS: ActionType[] = ['api_call', 'send_message', 'exec_command'];

const MODERATE_ACTIONS: ActionType[] = ['write_file', 'edit_file'];

const SIGNUP_URL_PATTERN = /signup|register|join|create[_-]?account|sign[_-]?up/i;
const SIGNUP_FIELD_PATTERN = /password|passwd|confirm_password/i;
const PAYMENT_FIELD_PATTERN = /card[_-]?number|cvv|cvc|expir|billing|credit[_-]?card|payment/i;

export class ActionClassifier {
  private config: SafetyConfig;
  private secretPatterns: RegExp[];
  private forbiddenActions: Set<ActionType>;
  private dangerousActions: Set<ActionType>;
  private moderateActions: Set<ActionType>;

  constructor(config: SafetyConfig) {
    this.config = config;
    this.secretPatterns = [
      ...DEFAULT_SECRET_PATTERNS,
      ...(config.secretPatterns ?? []).map((p) => new RegExp(p)),
    ];
    this.forbiddenActions = new Set([
      ...FORBIDDEN_ACTIONS,
      ...(config.forbiddenActions ?? []),
    ]);
    this.dangerousActions = new Set([
      ...DANGEROUS_ACTIONS,
      ...(config.dangerousActions ?? []),
    ]);
    this.moderateActions = new Set(MODERATE_ACTIONS);
  }

  classify(request: ActionRequest): SafetyLevel {
    // 1. Forbidden check
    if (this.forbiddenActions.has(request.actionType)) {
      return 'forbidden';
    }

    // 2. Check params for signup/payment patterns even if action type isn't explicit
    if (this.containsSignupPattern(request.params)) {
      return 'forbidden';
    }
    if (this.containsPaymentPattern(request.params)) {
      return 'forbidden';
    }

    // 3. Check for secret leakage in params
    const paramsText = JSON.stringify(request.params);
    if (this.containsSecretPattern(paramsText).found) {
      return 'dangerous';
    }

    // 4. Dangerous actions
    if (this.dangerousActions.has(request.actionType)) {
      // exec_command with dangerous patterns
      if (request.actionType === 'exec_command') {
        const cmd = String(request.params.command ?? '');
        // Destructive / escalation patterns
        if (/rm\s+-rf|sudo|chmod\s+777|eval\s*\(/i.test(cmd)) {
          return 'forbidden';
        }
        // Network access commands - forbidden to prevent data exfiltration
        if (/\b(curl|wget|nc|ncat|netcat|ssh|scp|sftp|ftp)\b/i.test(cmd)) {
          return 'forbidden';
        }
        // Pipe to shell patterns
        if (/\|\s*(sh|bash|zsh|dash)\b/i.test(cmd)) {
          return 'forbidden';
        }
      }
      return 'dangerous';
    }

    // 5. Moderate actions
    if (this.moderateActions.has(request.actionType)) {
      return 'moderate';
    }

    // 6. Default
    return this.config.defaultLevel ?? 'safe';
  }

  containsSecretPattern(text: string): { found: boolean; type?: string } {
    for (const pattern of this.secretPatterns) {
      if (pattern.test(text)) {
        return { found: true, type: pattern.source };
      }
    }
    return { found: false };
  }

  containsSignupPattern(params: Record<string, unknown>): boolean {
    const paramsStr = JSON.stringify(params).toLowerCase();

    // URL with signup/register pattern + POST method
    const url = String(params.url ?? params.href ?? '');
    const method = String(params.method ?? '').toUpperCase();

    if (SIGNUP_URL_PATTERN.test(url) && method === 'POST') {
      return true;
    }

    // Form data containing password + email fields
    const hasPassword = SIGNUP_FIELD_PATTERN.test(paramsStr);
    const hasEmail = paramsStr.includes('email');
    if (hasPassword && hasEmail && SIGNUP_URL_PATTERN.test(paramsStr)) {
      return true;
    }

    return false;
  }

  containsPaymentPattern(params: Record<string, unknown>): boolean {
    const paramsStr = JSON.stringify(params);
    return PAYMENT_FIELD_PATTERN.test(paramsStr);
  }
}
