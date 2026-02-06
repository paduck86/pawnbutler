// PawnButler Sandbox Configuration

export type NetworkMode = 'none' | 'bridge';

export interface SandboxConfig {
  enabled: boolean;
  image: string;
  networkMode: NetworkMode;
  memoryLimit: string;
  cpuLimit: number;
  timeout: number;
  mountPaths: string[];
  allowWriteMount: boolean;
}

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  enabled: true,
  image: 'pawnbutler-sandbox:latest',
  networkMode: 'none',
  memoryLimit: '512m',
  cpuLimit: 1,
  timeout: 30_000,
  mountPaths: [],
  allowWriteMount: false,
};
