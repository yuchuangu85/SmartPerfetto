// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * Phase -1 of v2.1 — capture a metrics baseline for the
 * context-engineering refactor.
 *
 * The script does **not** drive the analyses itself; it simply walks
 * the on-disk session metrics emitted by `AgentMetricsCollector`
 * (see `agentMetrics.persistSessionMetrics`) and produces an aggregated
 * JSON report so post-PR runs can be diffed against the baseline.
 *
 * Typical workflow:
 *
 *   1. Run the canonical analyses (e.g. via `verifyAgentSseScrolling`)
 *      against the 6 regression traces with the same query.
 *   2. Immediately call this script with `--stage current` (or
 *      `post-P0` / `post-v2.1` after each milestone).
 *   3. Diff the JSON files for cache-read ratio, cost, and so on.
 *
 * Usage:
 *   tsx src/scripts/captureContextEngineeringBaseline.ts \
 *     --stage current \
 *     --since-mins 30 \
 *     --out test-output/baseline-current.json
 */

import * as fs from 'fs';
import * as path from 'path';

interface CliOptions {
  stage: string;
  outPath: string;
  sinceMins: number;
  metricsDir: string;
}

interface PersistedSessionMetrics {
  sessionId: string;
  startTime: number;
  endTime: number;
  totalDurationMs: number;
  turns: number;
  toolSummary: {
    totalCalls: number;
    totalDurationMs: number;
    successCount: number;
    failureCount: number;
    byTool: Record<string, { calls: number; totalMs: number; avgMs: number; failures: number }>;
  };
  cache?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    totalCostUsd: number;
    cacheHitRate: number;
  };
  turnMetrics?: {
    totalTurns: number;
    totalDurationMs: number;
    totalToolCalls: number;
    totalPayloadBytes: number;
  };
  analysisMode?: 'fast' | 'full' | 'auto';
  classifierSource?: 'user_explicit' | 'hard_rule' | 'ai';
}

const DEFAULT_METRICS_DIR = path.resolve(__dirname, '..', '..', 'logs', 'metrics');
const DEFAULT_SINCE_MINS = 30;

function printUsage(): void {
  console.log('Usage: tsx src/scripts/captureContextEngineeringBaseline.ts [options]');
  console.log('');
  console.log('Options:');
  console.log('  --stage <name>       Baseline stage label (current / post-P0 / post-v2.1) — required');
  console.log('  --out <path>         Output JSON path — required');
  console.log(`  --since-mins <n>     Only include sessions whose mtime is within the last N minutes (default: ${DEFAULT_SINCE_MINS})`);
  console.log(`  --metrics-dir <dir>  Override metrics directory (default: ${DEFAULT_METRICS_DIR})`);
  console.log('  --help               Show this help');
}

function parseArgs(argv: string[]): CliOptions {
  const opts: Partial<CliOptions> = {
    sinceMins: DEFAULT_SINCE_MINS,
    metricsDir: DEFAULT_METRICS_DIR,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--help') {
      printUsage();
      process.exit(0);
    }
    if (arg === '--stage') {
      if (!next) throw new Error('--stage requires a value');
      opts.stage = next;
      i += 1;
      continue;
    }
    if (arg === '--out') {
      if (!next) throw new Error('--out requires a value');
      opts.outPath = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--since-mins') {
      if (!next) throw new Error('--since-mins requires a value');
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --since-mins value: ${next}`);
      }
      opts.sinceMins = parsed;
      i += 1;
      continue;
    }
    if (arg === '--metrics-dir') {
      if (!next) throw new Error('--metrics-dir requires a value');
      opts.metricsDir = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!opts.stage) throw new Error('--stage is required');
  if (!opts.outPath) throw new Error('--out is required');
  return opts as CliOptions;
}

function aggregate(sessions: PersistedSessionMetrics[]) {
  const cacheCapable = sessions.filter(s => s.cache);
  const sumOf = (sel: (s: PersistedSessionMetrics) => number) =>
    sessions.reduce((acc, s) => acc + sel(s), 0);
  const meanOf = (sel: (s: PersistedSessionMetrics) => number | undefined) => {
    const values = sessions.map(sel).filter((v): v is number => typeof v === 'number');
    return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
  };
  return {
    sessionCount: sessions.length,
    cacheCapableCount: cacheCapable.length,
    totalDurationMs: sumOf(s => s.totalDurationMs),
    totalTurns: sumOf(s => s.turns),
    totalToolCalls: sumOf(s => s.toolSummary?.totalCalls ?? 0),
    totalCostUsd: sumOf(s => s.cache?.totalCostUsd ?? 0),
    totalInputTokens: sumOf(s => s.cache?.inputTokens ?? 0),
    totalCacheReadInputTokens: sumOf(s => s.cache?.cacheReadInputTokens ?? 0),
    totalCacheCreationInputTokens: sumOf(s => s.cache?.cacheCreationInputTokens ?? 0),
    meanCacheHitRate: meanOf(s => s.cache?.cacheHitRate),
    meanDurationMs: meanOf(s => s.totalDurationMs),
    meanTurns: meanOf(s => s.turns),
  };
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(opts.metricsDir)) {
    console.error(`Metrics directory not found: ${opts.metricsDir}`);
    console.error('Run an analysis first so AgentMetricsCollector has metrics to aggregate.');
    process.exit(2);
  }

  const cutoff = Date.now() - opts.sinceMins * 60 * 1000;
  const files = fs.readdirSync(opts.metricsDir).filter(f => f.endsWith('_metrics.json'));

  const eligible: Array<{ file: string; data: PersistedSessionMetrics; mtimeMs: number }> = [];
  for (const file of files) {
    const filePath = path.join(opts.metricsDir, file);
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs < cutoff) continue;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PersistedSessionMetrics;
      eligible.push({ file, data, mtimeMs: stat.mtimeMs });
    } catch (err) {
      console.warn(`Skipping malformed metrics file ${file}: ${(err as Error).message}`);
    }
  }
  eligible.sort((a, b) => a.mtimeMs - b.mtimeMs);

  const sessions = eligible.map(e => e.data);
  const report = {
    stage: opts.stage,
    capturedAt: new Date().toISOString(),
    sinceMins: opts.sinceMins,
    metricsDir: opts.metricsDir,
    aggregate: aggregate(sessions),
    sessions: sessions.map(s => ({
      sessionId: s.sessionId,
      analysisMode: s.analysisMode,
      classifierSource: s.classifierSource,
      durationMs: s.totalDurationMs,
      turns: s.turns,
      totalToolCalls: s.toolSummary?.totalCalls ?? 0,
      cache: s.cache,
    })),
  };

  fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
  fs.writeFileSync(opts.outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${sessions.length} session(s) to ${opts.outPath}`);
  console.log(`Mean cache hit rate: ${report.aggregate.meanCacheHitRate ?? 'n/a'}`);
  console.log(`Total cost: $${(report.aggregate.totalCostUsd ?? 0).toFixed(4)}`);
}

try {
  main();
} catch (err) {
  console.error((err as Error).message);
  printUsage();
  process.exit(1);
}
