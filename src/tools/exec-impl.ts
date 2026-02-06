// PawnButler Exec Implementation - Shell command execution with sandbox support

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ActionClassifier } from '../safety/action-classifier.js';
import { DockerSandbox } from '../sandbox/docker-sandbox.js';
import type { SandboxConfig } from '../sandbox/sandbox-config.js';
import { DEFAULT_SANDBOX_CONFIG } from '../sandbox/sandbox-config.js';
import { toolEvents } from './tool-events.js';

const execFilePromise = promisify(execFile);

export interface ExecResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  sandboxed: boolean;
  durationMs: number;
}

const DEFAULT_TIMEOUT = 30_000;
const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB

let _sandbox: DockerSandbox | null = null;
let _sandboxAvailable: boolean | null = null;

async function getSandbox(config?: Partial<SandboxConfig>): Promise<DockerSandbox | null> {
  if (_sandboxAvailable === false) return null;

  if (!_sandbox) {
    _sandbox = new DockerSandbox(config ?? DEFAULT_SANDBOX_CONFIG);
    _sandboxAvailable = await _sandbox.isAvailable();
    if (!_sandboxAvailable) {
      _sandbox = null;
      return null;
    }
  }

  return _sandbox;
}

/**
 * Reset sandbox state (for testing).
 */
export function resetSandboxState(): void {
  _sandbox = null;
  _sandboxAvailable = null;
}

/**
 * Execute a command, preferring Docker sandbox, falling back to direct execution.
 * Enforces ActionClassifier checks before execution.
 */
export async function executeCommand(
  command: string,
  classifier: ActionClassifier,
  options: {
    timeout?: number;
    workdir?: string;
    sandboxConfig?: Partial<SandboxConfig>;
    allowUnsandboxed?: boolean;
  } = {},
): Promise<ExecResult> {
  const start = Date.now();
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;

  toolEvents.emitStart('exec_command', { command, timeout });

  try {
    // Pre-check via ActionClassifier: build a mock request to check the command
    const mockRequest = {
      id: 'exec-check',
      agentId: 'executor',
      agentRole: 'executor' as const,
      actionType: 'exec_command' as const,
      params: { command },
      safetyLevel: 'dangerous' as const,
      timestamp: Date.now(),
      requiresApproval: true,
    };

    const level = classifier.classify(mockRequest);
    if (level === 'forbidden') {
      const result: ExecResult = {
        command,
        exitCode: 126,
        stdout: '',
        stderr: 'Command blocked by ActionClassifier: classified as forbidden',
        sandboxed: false,
        durationMs: Date.now() - start,
      };
      toolEvents.emitComplete('exec_command', {
        command,
        exitCode: 126,
        blocked: true,
      }, result.durationMs);
      return result;
    }

    // Try Docker sandbox first
    const sandbox = await getSandbox(options.sandboxConfig);
    if (sandbox) {
      try {
        if (!sandbox.getContainerId()) {
          await sandbox.createContainer();
        }

        const sandboxResult = await sandbox.exec(command, {
          timeout,
          workdir: options.workdir ?? '/workspace',
        });

        const result: ExecResult = {
          command,
          exitCode: sandboxResult.exitCode,
          stdout: sandboxResult.stdout.slice(0, MAX_OUTPUT_SIZE),
          stderr: sandboxResult.stderr.slice(0, MAX_OUTPUT_SIZE),
          sandboxed: true,
          durationMs: Date.now() - start,
        };

        toolEvents.emitComplete('exec_command', {
          command,
          exitCode: result.exitCode,
          sandboxed: true,
          stdoutLength: result.stdout.length,
        }, result.durationMs);

        return result;
      } catch (err) {
        // Sandbox failed, try fallback
        const errMsg = err instanceof Error ? err.message : String(err);
        if (options.allowUnsandboxed) {
          toolEvents.emitStart('exec_command:unsandboxed_warning', {
            command,
            warning: 'Sandbox failed, falling back to unsandboxed execution.',
            sandboxError: errMsg,
          });
        }
        if (!options.allowUnsandboxed) {
          const result: ExecResult = {
            command,
            exitCode: -1,
            stdout: '',
            stderr: `Sandbox execution failed: ${errMsg}`,
            sandboxed: false,
            durationMs: Date.now() - start,
          };
          toolEvents.emitError('exec_command', errMsg, result.durationMs);
          return result;
        }
      }
    }

    // Fallback: direct execution (only if explicitly allowed)
    if (options.allowUnsandboxed) {
      toolEvents.emitStart('exec_command:unsandboxed_warning', {
        command,
        warning: 'Executing command without Docker sandbox. This bypasses network isolation.',
      });
    }
    if (!options.allowUnsandboxed) {
      const result: ExecResult = {
        command,
        exitCode: -1,
        stdout: '',
        stderr: 'Docker sandbox not available. Command execution blocked for safety.',
        sandboxed: false,
        durationMs: Date.now() - start,
      };
      toolEvents.emitComplete('exec_command', {
        command,
        exitCode: -1,
        blocked: true,
        reason: 'no_sandbox',
      }, result.durationMs);
      return result;
    }

    // Direct execution
    try {
      const { stdout, stderr } = await execFilePromise('/bin/sh', ['-c', command], {
        timeout,
        maxBuffer: MAX_OUTPUT_SIZE,
      });

      const result: ExecResult = {
        command,
        exitCode: 0,
        stdout: stdout.slice(0, MAX_OUTPUT_SIZE),
        stderr: stderr.slice(0, MAX_OUTPUT_SIZE),
        sandboxed: false,
        durationMs: Date.now() - start,
      };

      toolEvents.emitComplete('exec_command', {
        command,
        exitCode: 0,
        sandboxed: false,
        stdoutLength: result.stdout.length,
      }, result.durationMs);

      return result;
    } catch (err: unknown) {
      const error = err as {
        stdout?: string;
        stderr?: string;
        code?: number | string;
        killed?: boolean;
      };

      const exitCode = error.killed ? 124 : (typeof error.code === 'number' ? error.code : 1);
      const stderr = error.killed
        ? `Command timed out after ${timeout}ms`
        : (error.stderr ?? (err instanceof Error ? err.message : String(err)));

      const result: ExecResult = {
        command,
        exitCode,
        stdout: (error.stdout ?? '').slice(0, MAX_OUTPUT_SIZE),
        stderr: stderr.slice(0, MAX_OUTPUT_SIZE),
        sandboxed: false,
        durationMs: Date.now() - start,
      };

      toolEvents.emitError('exec_command', stderr, result.durationMs);
      return result;
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - start;
    toolEvents.emitError('exec_command', error, durationMs);
    return {
      command,
      exitCode: -1,
      stdout: '',
      stderr: error,
      sandboxed: false,
      durationMs,
    };
  }
}
