// PawnButler Docker Sandbox - Isolated command execution with no network access

import type { SandboxConfig } from './sandbox-config.js';
import { DEFAULT_SANDBOX_CONFIG } from './sandbox-config.js';
import { NetworkGuard } from './network-guard.js';
import { runCommand } from './exec-helper.js';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  sandboxed: boolean;
}

export class DockerSandbox {
  private config: SandboxConfig;
  private containerId: string | null = null;
  private networkGuard: NetworkGuard;

  constructor(config: Partial<SandboxConfig> = {}) {
    this.config = { ...DEFAULT_SANDBOX_CONFIG, ...config };
    this.networkGuard = new NetworkGuard();
  }

  /**
   * Check if Docker is installed and the daemon is running.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await runCommand('docker', ['info'], { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create an isolated Docker container with --network none.
   */
  async createContainer(): Promise<string> {
    // Validate config through network guard
    const validation = this.networkGuard.validateContainerConfig(this.config);
    if (!validation.valid) {
      throw new Error(`Sandbox config validation failed: ${validation.error}`);
    }

    const args: string[] = [
      'create',
      '--network', this.config.networkMode,
      '--memory', this.config.memoryLimit,
      `--cpus=${this.config.cpuLimit}`,
      '--pids-limit', '256',
      '--read-only',
      '--no-new-privileges',
    ];

    // Add mount paths
    for (const mountPath of this.config.mountPaths) {
      const readFlag = this.config.allowWriteMount ? 'rw' : 'ro';
      args.push('-v', `${mountPath}:/workspace:${readFlag}`);
    }

    args.push(this.config.image, '/bin/sh', '-c', 'sleep infinity');

    const { stdout } = await runCommand('docker', args);
    this.containerId = stdout.trim();

    // Start the container
    await runCommand('docker', ['start', this.containerId]);

    return this.containerId;
  }

  /**
   * Execute a command inside the sandbox container.
   */
  async exec(
    command: string,
    options: { timeout?: number; workdir?: string } = {}
  ): Promise<ExecResult> {
    if (!this.containerId) {
      throw new Error('No container running. Call createContainer() first.');
    }

    // Defense in depth: check command for escape attempts
    const escapeCheck = this.networkGuard.detectEscapeAttempt(command);
    if (escapeCheck.detected) {
      return {
        stdout: '',
        stderr: `Command blocked: potential escape attempt detected. ${escapeCheck.threats.join('; ')}`,
        exitCode: 126,
        sandboxed: true,
      };
    }

    const timeout = options.timeout ?? this.config.timeout;
    const execArgs = ['exec'];

    if (options.workdir) {
      execArgs.push('-w', options.workdir);
    }

    execArgs.push(this.containerId, '/bin/sh', '-c', command);

    try {
      const { stdout, stderr } = await runCommand('docker', execArgs, {
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });

      return {
        stdout,
        stderr,
        exitCode: 0,
        sandboxed: true,
      };
    } catch (err: unknown) {
      const error = err as { stdout?: string; stderr?: string; code?: number | string; killed?: boolean };

      if (error.killed) {
        return {
          stdout: error.stdout ?? '',
          stderr: `Command timed out after ${timeout}ms`,
          exitCode: 124,
          sandboxed: true,
        };
      }

      return {
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? (err instanceof Error ? err.message : String(err)),
        exitCode: typeof error.code === 'number' ? error.code : 1,
        sandboxed: true,
      };
    }
  }

  /**
   * Mount a workspace path into the container.
   * Must be called before createContainer() or will recreate the container.
   */
  mountWorkspace(path: string): void {
    if (!this.config.mountPaths.includes(path)) {
      this.config.mountPaths = [...this.config.mountPaths, path];
    }
  }

  /**
   * Destroy the sandbox container and clean up.
   */
  async destroy(): Promise<void> {
    if (!this.containerId) return;

    try {
      await runCommand('docker', ['rm', '-f', this.containerId]);
    } catch {
      // Container may already be stopped/removed
    }

    this.containerId = null;
  }

  /**
   * Get the current container ID, if running.
   */
  getContainerId(): string | null {
    return this.containerId;
  }
}
