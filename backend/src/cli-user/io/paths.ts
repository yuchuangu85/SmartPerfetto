// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * Path resolution for the CLI's user-local storage.
 *
 * Layout:
 *   $SMARTPERFETTO_HOME/                (default: ~/.smartperfetto)
 *   ├── index.json                      (global session catalog)
 *   └── sessions/
 *       └── <sessionId>/
 *           ├── config.json
 *           ├── conclusion.md           (latest turn's conclusion)
 *           ├── transcript.jsonl
 *           ├── stream.jsonl            (raw StreamingUpdate log)
 *           ├── report.html             (latest HTML report)
 *           └── turns/NNN.md            (per-turn full answer)
 *
 * Override with `--session-dir` flag or `SMARTPERFETTO_HOME` env var.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface CliPaths {
  home: string;
  sessionsRoot: string;
  indexFile: string;
}

/** Resolve a home override from argv/env. Does NOT create directories — that's ensureLayout's job. */
export function resolveHome(overrideDir?: string): string {
  if (overrideDir && overrideDir.trim()) return path.resolve(overrideDir);
  const envHome = process.env.SMARTPERFETTO_HOME;
  if (envHome && envHome.trim()) return path.resolve(envHome);
  return path.join(os.homedir(), '.smartperfetto');
}

/** Return the resolved layout without touching the filesystem. */
export function computePaths(overrideDir?: string): CliPaths {
  const home = resolveHome(overrideDir);
  return {
    home,
    sessionsRoot: path.join(home, 'sessions'),
    indexFile: path.join(home, 'index.json'),
  };
}

/** Create the home + sessions directories if missing. Idempotent. */
export function ensureLayout(paths: CliPaths): void {
  fs.mkdirSync(paths.sessionsRoot, { recursive: true });
}

/** Per-session paths. Files may not exist yet — callers check as needed. */
export interface SessionPaths {
  dir: string;
  config: string;
  conclusion: string;
  transcript: string;
  stream: string;
  report: string;
  turnsDir: string;
}

export function sessionPaths(paths: CliPaths, sessionId: string): SessionPaths {
  const dir = path.join(paths.sessionsRoot, sessionId);
  return {
    dir,
    config: path.join(dir, 'config.json'),
    conclusion: path.join(dir, 'conclusion.md'),
    transcript: path.join(dir, 'transcript.jsonl'),
    stream: path.join(dir, 'stream.jsonl'),
    report: path.join(dir, 'report.html'),
    turnsDir: path.join(dir, 'turns'),
  };
}

/** Create the per-session folder tree. Idempotent. */
export function ensureSessionLayout(sp: SessionPaths): void {
  fs.mkdirSync(sp.dir, { recursive: true });
  fs.mkdirSync(sp.turnsDir, { recursive: true });
}

/** Return session directory name → sessionId mapping by scanning sessions/. */
export function scanSessionIds(paths: CliPaths): string[] {
  if (!fs.existsSync(paths.sessionsRoot)) return [];
  return fs
    .readdirSync(paths.sessionsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}
