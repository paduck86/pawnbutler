#!/usr/bin/env node

import { Command } from 'commander';
import { PawnButlerEngine } from './core/engine.js';
import { Guardian } from './safety/guardian.js';
import { ButlerAgent } from './agents/butler.js';
import { ResearcherAgent } from './agents/researcher.js';
import { ExecutorAgent } from './agents/executor.js';
import { defaultConfig } from './config/default-config.js';
import { validateConfig } from './config/schema.js';
import type { PawnButlerConfig } from './core/types.js';

const program = new Command();

program
  .name('pawnbutler')
  .description('Safe personal AI agent system with strict guardrails')
  .version('1.0.0');

program
  .command('start')
  .description('Start the PawnButler agent system')
  .option('-c, --config <path>', 'Path to configuration file')
  .action(async (options: { config?: string }) => {
    let config: PawnButlerConfig = defaultConfig;

    if (options.config) {
      const { readFileSync } = await import('node:fs');
      try {
        const raw = JSON.parse(readFileSync(options.config, 'utf-8'));
        const validation = validateConfig(raw);
        if (!validation.success) {
          console.error('Invalid configuration:');
          for (const err of validation.errors ?? []) {
            console.error(`  - ${err}`);
          }
          process.exit(1);
        }
        config = validation.data as PawnButlerConfig;
      } catch (err) {
        console.error(`Failed to load config: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    }

    const engine = new PawnButlerEngine(config);

    // Create agents from config
    const guardianConfig = config.agents.find((a) => a.role === 'guardian');
    const butlerConfig = config.agents.find((a) => a.role === 'butler');
    const researcherConfig = config.agents.find((a) => a.role === 'researcher');
    const executorConfig = config.agents.find((a) => a.role === 'executor');

    if (guardianConfig) {
      const _guardian = new Guardian(config);
      // Guardian is used internally by the engine for validation
    }

    if (butlerConfig) {
      const butler = new ButlerAgent(butlerConfig);
      engine.registerAgent(butler);
    }

    if (researcherConfig) {
      const researcher = new ResearcherAgent(researcherConfig);
      engine.registerAgent(researcher);
    }

    if (executorConfig) {
      const executor = new ExecutorAgent(executorConfig);
      engine.registerAgent(executor);
    }

    await engine.start();
    console.log('PawnButler started successfully.');
    console.log(`Registered agents: ${config.agents.map((a) => a.name).join(', ')}`);
    console.log('Listening for requests...');

    // Graceful shutdown
    const shutdown = async () => {
      console.log('\nShutting down PawnButler...');
      await engine.shutdown();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

program
  .command('status')
  .description('Show the current status of the PawnButler system')
  .action(() => {
    console.log('PawnButler Status');
    console.log('-----------------');
    console.log('Version: 1.0.0');
    console.log('Config: default');
    console.log('Agents: guardian, butler, researcher, executor');
  });

program
  .command('logs')
  .description('View audit logs')
  .option('-n, --lines <number>', 'Number of recent entries to show', '20')
  .option('-t, --type <type>', 'Filter by action type')
  .option('-l, --level <level>', 'Filter by safety level')
  .action((options: { lines: string; type?: string; level?: string }) => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const logPath = defaultConfig.auditLog.logPath;

    try {
      const content = readFileSync(logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const limit = parseInt(options.lines, 10) || 20;

      let entries = lines.map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean);

      if (options.type) {
        entries = entries.filter((e: Record<string, unknown>) => e.actionType === options.type);
      }
      if (options.level) {
        entries = entries.filter((e: Record<string, unknown>) => e.safetyLevel === options.level);
      }

      entries = entries.slice(-limit);

      if (entries.length === 0) {
        console.log('No log entries found.');
        return;
      }

      for (const entry of entries) {
        const ts = new Date(entry.timestamp as number).toISOString();
        console.log(`[${ts}] ${entry.agentId}(${entry.agentRole}) ${entry.actionType} [${entry.safetyLevel}] -> ${entry.result}`);
      }
    } catch {
      console.log('No audit logs found. Start the system first.');
    }
  });

program
  .command('config')
  .description('Show or validate configuration')
  .option('-v, --validate <path>', 'Validate a configuration file')
  .option('-s, --show', 'Show current default configuration')
  .action((options: { validate?: string; show?: boolean }) => {
    if (options.validate) {
      const { readFileSync } = require('node:fs') as typeof import('node:fs');
      try {
        const raw = JSON.parse(readFileSync(options.validate, 'utf-8'));
        const result = validateConfig(raw);
        if (result.success) {
          console.log('Configuration is valid.');
        } else {
          console.error('Configuration validation failed:');
          for (const err of result.errors ?? []) {
            console.error(`  - ${err}`);
          }
        }
      } catch (err) {
        console.error(`Failed to read config: ${err instanceof Error ? err.message : err}`);
      }
    } else if (options.show) {
      console.log(JSON.stringify(defaultConfig, null, 2));
    } else {
      console.log('Use --show to display default config or --validate <path> to validate a config file.');
    }
  });

program.parse();
