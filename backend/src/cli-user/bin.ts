#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * `smartperfetto` CLI entry point.
 *
 * PR1 surface: `analyze <trace>` only. Commands `resume`/`list`/`show`/
 * `report` land in PR2; REPL (`smartperfetto` with no sub-command) in PR3.
 *
 * All async work routes through command handlers that return an exit code.
 * We call `process.exit(code)` explicitly to ensure the process terminates
 * even if some module has a stray setInterval / active handle we missed.
 */

import { Command } from 'commander';
import { runAnalyzeCommand } from './commands/analyze';

function main(): void {
  const program = new Command();

  program
    .name('smartperfetto')
    .description('SmartPerfetto CLI — terminal-based Android Perfetto trace analysis')
    .version('0.1.0')
    .option('--session-dir <path>', 'override session storage root (default: ~/.smartperfetto)')
    .option('--env-file <path>', 'path to .env file (default: backend/.env)')
    .option('--verbose', 'show verbose event stream', false)
    .option('--no-color', 'disable ANSI colors');

  program
    .command('analyze <trace>')
    .description('run one-shot analysis against a trace file')
    .option('-q, --query <question>', 'analysis question', '分析这个 trace 的性能问题，找出根因')
    .action(async (trace: string, opts: { query: string }) => {
      const globals = program.opts<{
        sessionDir?: string;
        envFile?: string;
        verbose?: boolean;
        color?: boolean;
      }>();
      const code = await runAnalyzeCommand({
        trace,
        query: opts.query,
        envFile: globals.envFile,
        sessionDir: globals.sessionDir,
        verbose: Boolean(globals.verbose),
        // commander turns --no-color into opts.color === false
        noColor: globals.color === false,
      });
      process.exit(code);
    });

  // If no sub-command is given, show help (REPL comes in PR3).
  program.action(() => {
    program.help();
  });

  program.parseAsync(process.argv).catch((err: Error) => {
    console.error(`Fatal: ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(2);
  });
}

main();
