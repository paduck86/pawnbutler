// PawnButler Network Guard - Defense in depth for Docker sandbox

import type { SandboxConfig } from './sandbox-config.js';
import { runCommand } from './exec-helper.js';

/**
 * Patterns that indicate a Docker container escape attempt.
 * These are commands or flags that could break out of container isolation.
 */
const ESCAPE_PATTERNS: { pattern: RegExp; description: string }[] = [
  { pattern: /\bnsenter\b/i, description: 'nsenter can enter host namespaces' },
  { pattern: /--privileged/i, description: '--privileged disables container isolation' },
  { pattern: /\/proc\/1\//, description: 'Accessing /proc/1 targets the host init process' },
  { pattern: /\bchroot\b/i, description: 'chroot can escape container filesystem' },
  { pattern: /\bmount\s/i, description: 'mount can attach host filesystems' },
  { pattern: /\bumount\b/i, description: 'umount can detach filesystems' },
  { pattern: /--cap-add/i, description: '--cap-add grants additional Linux capabilities' },
  { pattern: /--security-opt\s+apparmor=unconfined/i, description: 'Disabling AppArmor weakens isolation' },
  { pattern: /--pid\s*=\s*host/i, description: '--pid=host shares host PID namespace' },
  { pattern: /--net\s*=\s*host/i, description: '--net=host shares host network namespace' },
  { pattern: /--network\s*=?\s*host/i, description: '--network=host shares host network namespace' },
  { pattern: /docker\.sock/i, description: 'Docker socket access enables host control' },
  { pattern: /\biptables\b/i, description: 'iptables manipulation can bypass network isolation' },
  { pattern: /\bip\s+route\b/i, description: 'ip route can reconfigure networking' },
  { pattern: /\bip\s+link\b/i, description: 'ip link can modify network interfaces' },
];

export class NetworkGuard {
  /**
   * Validate that a sandbox config enforces network isolation.
   * Returns an error message if config is insecure, or null if valid.
   */
  validateContainerConfig(config: SandboxConfig): { valid: boolean; error?: string } {
    if (config.networkMode !== 'none') {
      return {
        valid: false,
        error: `Network mode must be "none" for sandbox isolation, got "${config.networkMode}"`,
      };
    }
    return { valid: true };
  }

  /**
   * Detect potential container escape attempts in a command string.
   * Returns detected patterns with descriptions.
   */
  detectEscapeAttempt(command: string): { detected: boolean; threats: string[] } {
    const threats: string[] = [];

    for (const { pattern, description } of ESCAPE_PATTERNS) {
      if (pattern.test(command)) {
        threats.push(description);
      }
    }

    return {
      detected: threats.length > 0,
      threats,
    };
  }

  /**
   * Verify that a running container has no network access.
   * Inspects the container's network settings via docker inspect.
   */
  async isContainerIsolated(containerId: string): Promise<{ isolated: boolean; reason?: string }> {
    try {
      const { stdout } = await runCommand('docker', [
        'inspect',
        '--format',
        '{{.HostConfig.NetworkMode}}',
        containerId,
      ]);

      const networkMode = stdout.trim();
      if (networkMode === 'none') {
        return { isolated: true };
      }

      return {
        isolated: false,
        reason: `Container network mode is "${networkMode}", expected "none"`,
      };
    } catch (err) {
      return {
        isolated: false,
        reason: `Failed to inspect container: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
