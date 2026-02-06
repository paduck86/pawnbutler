import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NetworkGuard } from '../src/sandbox/network-guard.js';
import {
  DEFAULT_SANDBOX_CONFIG,
  type SandboxConfig,
} from '../src/sandbox/sandbox-config.js';

// Mock the exec-helper module used by both DockerSandbox and NetworkGuard
const mockRunCommand = vi.fn();
vi.mock('../src/sandbox/exec-helper.js', () => ({
  runCommand: (...args: unknown[]) => mockRunCommand(...args),
}));

// Import after mock setup
import { DockerSandbox } from '../src/sandbox/docker-sandbox.js';

// ─────────────────────────────────────────────────
// SandboxConfig defaults
// ─────────────────────────────────────────────────
describe('SandboxConfig', () => {
  it('has secure default values', () => {
    expect(DEFAULT_SANDBOX_CONFIG.networkMode).toBe('none');
    expect(DEFAULT_SANDBOX_CONFIG.memoryLimit).toBe('512m');
    expect(DEFAULT_SANDBOX_CONFIG.cpuLimit).toBe(1);
    expect(DEFAULT_SANDBOX_CONFIG.timeout).toBe(30_000);
    expect(DEFAULT_SANDBOX_CONFIG.enabled).toBe(true);
    expect(DEFAULT_SANDBOX_CONFIG.allowWriteMount).toBe(false);
    expect(DEFAULT_SANDBOX_CONFIG.mountPaths).toEqual([]);
    expect(DEFAULT_SANDBOX_CONFIG.image).toBe('pawnbutler-sandbox:latest');
  });
});

// ─────────────────────────────────────────────────
// NetworkGuard
// ─────────────────────────────────────────────────
describe('NetworkGuard', () => {
  let guard: NetworkGuard;

  beforeEach(() => {
    guard = new NetworkGuard();
    mockRunCommand.mockReset();
  });

  describe('validateContainerConfig', () => {
    it('accepts networkMode=none', () => {
      const result = guard.validateContainerConfig(DEFAULT_SANDBOX_CONFIG);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('rejects networkMode=bridge', () => {
      const config: SandboxConfig = { ...DEFAULT_SANDBOX_CONFIG, networkMode: 'bridge' };
      const result = guard.validateContainerConfig(config);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('bridge');
    });
  });

  describe('detectEscapeAttempt', () => {
    it('detects nsenter', () => {
      const result = guard.detectEscapeAttempt('nsenter --target 1 --mount');
      expect(result.detected).toBe(true);
      expect(result.threats.length).toBeGreaterThan(0);
    });

    it('detects --privileged flag', () => {
      const result = guard.detectEscapeAttempt('docker run --privileged alpine');
      expect(result.detected).toBe(true);
    });

    it('detects /proc/1/ access', () => {
      const result = guard.detectEscapeAttempt('cat /proc/1/cgroup');
      expect(result.detected).toBe(true);
    });

    it('detects chroot', () => {
      const result = guard.detectEscapeAttempt('chroot /host /bin/bash');
      expect(result.detected).toBe(true);
    });

    it('detects mount command', () => {
      const result = guard.detectEscapeAttempt('mount -t proc proc /mnt');
      expect(result.detected).toBe(true);
    });

    it('detects docker.sock access', () => {
      const result = guard.detectEscapeAttempt(
        'curl --unix-socket /var/run/docker.sock http://localhost/containers/json'
      );
      expect(result.detected).toBe(true);
    });

    it('detects --network=host', () => {
      const result = guard.detectEscapeAttempt('docker run --network=host alpine');
      expect(result.detected).toBe(true);
    });

    it('detects iptables manipulation', () => {
      const result = guard.detectEscapeAttempt('iptables -A OUTPUT -j ACCEPT');
      expect(result.detected).toBe(true);
    });

    it('detects ip route manipulation', () => {
      const result = guard.detectEscapeAttempt('ip route add default via 172.17.0.1');
      expect(result.detected).toBe(true);
    });

    it('allows safe commands', () => {
      const safeCommands = [
        'echo "hello world"',
        'ls -la /workspace',
        'node script.js',
        'python3 -c "print(1+1)"',
        'cat /etc/os-release',
        'pwd',
        'npm test',
      ];

      for (const cmd of safeCommands) {
        const result = guard.detectEscapeAttempt(cmd);
        expect(result.detected).toBe(false);
      }
    });

    it('returns multiple threats for multi-vector attack', () => {
      const result = guard.detectEscapeAttempt(
        'nsenter --target 1 --mount chroot /host'
      );
      expect(result.detected).toBe(true);
      expect(result.threats.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('isContainerIsolated', () => {
    it('returns isolated=true when network mode is none', async () => {
      mockRunCommand.mockResolvedValue({ stdout: 'none\n', stderr: '' });

      const result = await guard.isContainerIsolated('test-container-id');
      expect(result.isolated).toBe(true);
    });

    it('returns isolated=false when network mode is bridge', async () => {
      mockRunCommand.mockResolvedValue({ stdout: 'bridge\n', stderr: '' });

      const result = await guard.isContainerIsolated('test-container-id');
      expect(result.isolated).toBe(false);
      expect(result.reason).toContain('bridge');
    });

    it('returns isolated=false when docker inspect fails', async () => {
      mockRunCommand.mockRejectedValue(new Error('docker not found'));

      const result = await guard.isContainerIsolated('test-container-id');
      expect(result.isolated).toBe(false);
      expect(result.reason).toContain('Failed to inspect');
    });
  });
});

// ─────────────────────────────────────────────────
// DockerSandbox
// ─────────────────────────────────────────────────
describe('DockerSandbox', () => {
  let sandbox: DockerSandbox;

  beforeEach(() => {
    mockRunCommand.mockReset();
    sandbox = new DockerSandbox();
  });

  describe('isAvailable', () => {
    it('returns true when Docker is running', async () => {
      mockRunCommand.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await sandbox.isAvailable();
      expect(result).toBe(true);
      expect(mockRunCommand).toHaveBeenCalledWith('docker', ['info'], { timeout: 5_000 });
    });

    it('returns false when Docker is not installed', async () => {
      mockRunCommand.mockRejectedValue(new Error('docker: command not found'));

      const result = await sandbox.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('createContainer', () => {
    it('creates container with --network none', async () => {
      mockRunCommand
        .mockResolvedValueOnce({ stdout: 'abc123container\n', stderr: '' }) // create
        .mockResolvedValueOnce({ stdout: '', stderr: '' }); // start

      const containerId = await sandbox.createContainer();
      expect(containerId).toBe('abc123container');

      // Verify --network none was passed in first call (create)
      const createArgs = mockRunCommand.mock.calls[0][1] as string[];
      expect(createArgs).toContain('--network');
      const networkIdx = createArgs.indexOf('--network');
      expect(createArgs[networkIdx + 1]).toBe('none');
    });

    it('includes memory limit flag', async () => {
      mockRunCommand
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      await sandbox.createContainer();

      const createArgs = mockRunCommand.mock.calls[0][1] as string[];
      expect(createArgs).toContain('--memory');
      const memIdx = createArgs.indexOf('--memory');
      expect(createArgs[memIdx + 1]).toBe('512m');
    });

    it('includes CPU limit flag', async () => {
      mockRunCommand
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      await sandbox.createContainer();

      const createArgs = mockRunCommand.mock.calls[0][1] as string[];
      expect(createArgs).toContain('--cpus=1');
    });

    it('includes --no-new-privileges and --read-only', async () => {
      mockRunCommand
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      await sandbox.createContainer();

      const createArgs = mockRunCommand.mock.calls[0][1] as string[];
      expect(createArgs).toContain('--no-new-privileges');
      expect(createArgs).toContain('--read-only');
    });

    it('includes --pids-limit', async () => {
      mockRunCommand
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      await sandbox.createContainer();

      const createArgs = mockRunCommand.mock.calls[0][1] as string[];
      expect(createArgs).toContain('--pids-limit');
      const pidsIdx = createArgs.indexOf('--pids-limit');
      expect(createArgs[pidsIdx + 1]).toBe('256');
    });

    it('rejects when network mode is not none', async () => {
      const insecureSandbox = new DockerSandbox({ networkMode: 'bridge' });
      await expect(insecureSandbox.createContainer()).rejects.toThrow(
        'Sandbox config validation failed'
      );
    });

    it('mounts workspace as read-only by default', async () => {
      mockRunCommand
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      sandbox.mountWorkspace('/home/user/project');
      await sandbox.createContainer();

      const createArgs = mockRunCommand.mock.calls[0][1] as string[];
      expect(createArgs).toContain('-v');
      const vIdx = createArgs.indexOf('-v');
      expect(createArgs[vIdx + 1]).toBe('/home/user/project:/workspace:ro');
    });

    it('mounts workspace as read-write when allowWriteMount is true', async () => {
      const rwSandbox = new DockerSandbox({ allowWriteMount: true });

      mockRunCommand
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      rwSandbox.mountWorkspace('/home/user/project');
      await rwSandbox.createContainer();

      const createArgs = mockRunCommand.mock.calls[0][1] as string[];
      const vIdx = createArgs.indexOf('-v');
      expect(createArgs[vIdx + 1]).toBe('/home/user/project:/workspace:rw');
    });

    it('starts the container after creation', async () => {
      mockRunCommand
        .mockResolvedValueOnce({ stdout: 'container-xyz\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      await sandbox.createContainer();

      // Second call should be 'start'
      expect(mockRunCommand.mock.calls[1][0]).toBe('docker');
      expect(mockRunCommand.mock.calls[1][1]).toEqual(['start', 'container-xyz']);
    });
  });

  describe('exec', () => {
    beforeEach(async () => {
      // Set up a container first
      mockRunCommand
        .mockResolvedValueOnce({ stdout: 'container123\n', stderr: '' }) // create
        .mockResolvedValueOnce({ stdout: '', stderr: '' }); // start
      await sandbox.createContainer();
      mockRunCommand.mockReset();
    });

    it('runs command inside container', async () => {
      mockRunCommand.mockResolvedValue({ stdout: 'hello world\n', stderr: '' });

      const result = await sandbox.exec('echo "hello world"');
      expect(result.stdout).toBe('hello world\n');
      expect(result.exitCode).toBe(0);
      expect(result.sandboxed).toBe(true);
    });

    it('passes container ID and command to docker exec', async () => {
      mockRunCommand.mockResolvedValue({ stdout: '', stderr: '' });

      await sandbox.exec('ls -la');

      expect(mockRunCommand).toHaveBeenCalledWith(
        'docker',
        ['exec', 'container123', '/bin/sh', '-c', 'ls -la'],
        expect.objectContaining({ timeout: 30_000 })
      );
    });

    it('blocks escape attempt commands', async () => {
      const result = await sandbox.exec('nsenter --target 1 --mount');
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain('escape attempt');
      expect(result.sandboxed).toBe(true);
      // Should NOT have called runCommand since it was blocked
      expect(mockRunCommand).not.toHaveBeenCalled();
    });

    it('blocks --privileged flag in command', async () => {
      const result = await sandbox.exec('docker run --privileged alpine sh');
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain('escape attempt');
    });

    it('blocks chroot command', async () => {
      const result = await sandbox.exec('chroot /host /bin/bash');
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain('escape attempt');
    });

    it('handles command timeout', async () => {
      const timeoutError = new Error('Command timed out') as Error & {
        killed: boolean;
        stdout: string;
        stderr: string;
      };
      timeoutError.killed = true;
      timeoutError.stdout = '';
      timeoutError.stderr = '';
      mockRunCommand.mockRejectedValue(timeoutError);

      const result = await sandbox.exec('sleep 999', { timeout: 1000 });
      expect(result.exitCode).toBe(124);
      expect(result.stderr).toContain('timed out');
      expect(result.sandboxed).toBe(true);
    });

    it('handles command failure with exit code', async () => {
      const cmdError = new Error('Command failed') as Error & {
        code: number;
        stdout: string;
        stderr: string;
      };
      cmdError.code = 127;
      cmdError.stdout = '';
      cmdError.stderr = 'command not found';
      mockRunCommand.mockRejectedValue(cmdError);

      const result = await sandbox.exec('nonexistent-command');
      expect(result.exitCode).toBe(127);
      expect(result.stderr).toContain('command not found');
      expect(result.sandboxed).toBe(true);
    });

    it('throws if no container is running', async () => {
      const freshSandbox = new DockerSandbox();
      await expect(freshSandbox.exec('echo hi')).rejects.toThrow(
        'No container running'
      );
    });

    it('passes workdir option to docker exec', async () => {
      mockRunCommand.mockResolvedValue({ stdout: '', stderr: '' });

      await sandbox.exec('ls', { workdir: '/workspace/src' });

      const execArgs = mockRunCommand.mock.calls[0][1] as string[];
      expect(execArgs).toContain('-w');
      const wIdx = execArgs.indexOf('-w');
      expect(execArgs[wIdx + 1]).toBe('/workspace/src');
    });

    it('uses custom timeout when provided', async () => {
      mockRunCommand.mockResolvedValue({ stdout: '', stderr: '' });

      await sandbox.exec('slow-cmd', { timeout: 5000 });

      expect(mockRunCommand).toHaveBeenCalledWith(
        'docker',
        expect.any(Array),
        expect.objectContaining({ timeout: 5000 })
      );
    });
  });

  describe('destroy', () => {
    it('removes the container', async () => {
      mockRunCommand
        .mockResolvedValueOnce({ stdout: 'container-to-destroy\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });
      await sandbox.createContainer();
      mockRunCommand.mockReset();

      mockRunCommand.mockResolvedValue({ stdout: '', stderr: '' });
      await sandbox.destroy();

      expect(mockRunCommand).toHaveBeenCalledWith('docker', ['rm', '-f', 'container-to-destroy']);
      expect(sandbox.getContainerId()).toBeNull();
    });

    it('is safe to call when no container exists', async () => {
      await sandbox.destroy();
      expect(sandbox.getContainerId()).toBeNull();
      expect(mockRunCommand).not.toHaveBeenCalled();
    });

    it('handles errors gracefully during cleanup', async () => {
      mockRunCommand
        .mockResolvedValueOnce({ stdout: 'doomed-container\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });
      await sandbox.createContainer();
      mockRunCommand.mockReset();

      mockRunCommand.mockRejectedValue(new Error('container already removed'));
      await sandbox.destroy();
      expect(sandbox.getContainerId()).toBeNull();
    });
  });

  describe('mountWorkspace', () => {
    it('adds path to mount config', () => {
      sandbox.mountWorkspace('/home/user/project');
      // Calling twice should not duplicate
      sandbox.mountWorkspace('/home/user/project');

      // Verify by creating container
      mockRunCommand
        .mockResolvedValueOnce({ stdout: 'abc\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });
    });

    it('supports multiple mount paths', async () => {
      sandbox.mountWorkspace('/path/a');
      sandbox.mountWorkspace('/path/b');

      mockRunCommand
        .mockResolvedValueOnce({ stdout: 'abc\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      await sandbox.createContainer();

      const createArgs = mockRunCommand.mock.calls[0][1] as string[];
      // Should have two -v entries
      const vIndices = createArgs.reduce<number[]>((acc, arg, i) => {
        if (arg === '-v') acc.push(i);
        return acc;
      }, []);
      expect(vIndices.length).toBe(2);
      expect(createArgs[vIndices[0] + 1]).toBe('/path/a:/workspace:ro');
      expect(createArgs[vIndices[1] + 1]).toBe('/path/b:/workspace:ro');
    });
  });

  describe('getContainerId', () => {
    it('returns null before container creation', () => {
      expect(sandbox.getContainerId()).toBeNull();
    });

    it('returns container ID after creation', async () => {
      mockRunCommand
        .mockResolvedValueOnce({ stdout: 'my-container-id\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      await sandbox.createContainer();
      expect(sandbox.getContainerId()).toBe('my-container-id');
    });

    it('returns null after destroy', async () => {
      mockRunCommand
        .mockResolvedValueOnce({ stdout: 'temp-container\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });
      await sandbox.createContainer();

      mockRunCommand.mockReset();
      mockRunCommand.mockResolvedValue({ stdout: '', stderr: '' });
      await sandbox.destroy();

      expect(sandbox.getContainerId()).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────
// Integration: exec_command tool
// ─────────────────────────────────────────────────
describe('exec_command tool integration', () => {
  it('exec_command tool exists with correct metadata', async () => {
    const { execCommandTool } = await import('../src/tools/builtin-tools.js');

    expect(execCommandTool.name).toBe('exec_command');
    expect(execCommandTool.safetyLevel).toBe('dangerous');
    expect(execCommandTool.requiredRole).toContain('executor');
  });

  it('exec_command validates required command param', async () => {
    const { execCommandTool } = await import('../src/tools/builtin-tools.js');

    expect(execCommandTool.validateParams!({ command: 'ls' }).valid).toBe(true);
    expect(execCommandTool.validateParams!({ command: '' }).valid).toBe(false);
    expect(execCommandTool.validateParams!({}).valid).toBe(false);
    expect(execCommandTool.validateParams!({ command: 123 }).valid).toBe(false);
  });

  it('exec_command includes sandbox status in response', async () => {
    // Docker not available - mock rejects
    mockRunCommand.mockRejectedValue(new Error('docker: command not found'));

    const { execCommandTool } = await import('../src/tools/builtin-tools.js');
    const result = (await execCommandTool.execute({ command: 'echo hi' })) as Record<
      string,
      unknown
    >;

    expect(result.sandboxed).toBe(false);
  });
});
