// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * `smartperfetto analyze <trace>` — one-shot analysis.
 *
 * Responsibilities:
 *   1. Bootstrap CLI (env + paths)
 *   2. Delegate analysis to CliAnalyzeService
 *   3. Stream events through the terminal renderer
 *   4. Persist outputs into the session folder
 *   5. Update ~/.smartperfetto/index.json
 *
 * Intentionally no resume handling in PR1 — `--resume-id` is reserved
 * but ignored. PR2 implements the full resume path.
 */

import * as path from 'path';
import { bootstrap } from '../bootstrap';
import { CliAnalyzeService } from '../services/cliAnalyzeService';
import { createRenderer } from '../repl/renderer';
import { sessionPaths, ensureSessionLayout } from '../io/paths';
import {
  writeConfig,
  writeConclusion,
  writeReportHtml,
  writeTurnMarkdown,
} from '../io/sessionStore';
import { upsertSession } from '../io/indexJson';
import { appendTranscriptTurn, appendStreamEvent } from '../io/transcriptWriter';
import type { CliSessionConfig } from '../types';

export interface AnalyzeCommandArgs {
  trace: string;
  query: string;
  envFile?: string;
  sessionDir?: string;
  verbose: boolean;
  noColor: boolean;
}

export async function runAnalyzeCommand(args: AnalyzeCommandArgs): Promise<number> {
  const tracePath = path.resolve(args.trace);
  const { paths } = bootstrap({ envFile: args.envFile, sessionDir: args.sessionDir });
  const renderer = createRenderer({ verbose: args.verbose, useColor: !args.noColor });
  const service = new CliAnalyzeService();

  const startedAt = Date.now();
  let sessionId: string | undefined;
  let streamFile: string | null = null;

  try {
    console.log(`Loading trace: ${tracePath}`);
    // loadTraceFromFilePath throws if the file doesn't exist — we let that
    // bubble up so there's only one source of truth for the ENOENT check.
    const traceId = await service.loadTrace(tracePath);
    console.log(`Trace loaded (traceId=${traceId.slice(0, 8)}…)`);

    const result = await service.runTurn({
      traceId,
      query: args.query,
      // prepareSession fires this synchronously before analyze() starts streaming.
      // Creating the session folder here lets the event handler write straight to
      // disk — no in-memory event buffer, bounded memory regardless of run length.
      onSessionReady: (sid) => {
        const sp = sessionPaths(paths, sid);
        ensureSessionLayout(sp);
        sessionId = sid;
        streamFile = sp.stream;
      },
      onEvent: (update) => {
        renderer.onEvent(update);
        if (streamFile) appendStreamEvent(streamFile, update);
      },
    });

    // Defensive fallback — onSessionReady should always fire, but if a future
    // refactor breaks that contract we still end up with a valid session folder.
    if (!sessionId) {
      sessionId = result.sessionId;
      ensureSessionLayout(sessionPaths(paths, sessionId));
    }
    const sp = sessionPaths(paths, sessionId);

    // Persist conclusion + per-turn markdown.
    const conclusion = result.result.conclusion || '';
    writeConclusion(sp, conclusion);
    writeTurnMarkdown(sp, 1, formatTurnMarkdown(args.query, conclusion, result.result));

    // HTML report — written directly to session dir (no /api/reports path).
    let reportPathForUser: string;
    if (result.reportHtml) {
      writeReportHtml(sp, result.reportHtml);
      reportPathForUser = sp.report;
    } else {
      reportPathForUser = `(report generation failed${result.reportError ? `: ${result.reportError}` : ''})`;
    }

    // Write session config — this is what `resume` will read (PR2).
    const config: CliSessionConfig = {
      sessionId,
      tracePath,
      traceId,
      sdkSessionId: result.sdkSessionId,
      model: result.model,
      createdAt: startedAt,
      lastTurnAt: Date.now(),
      turnCount: 1,
    };
    writeConfig(sp, config);

    // Transcript + global index.
    appendTranscriptTurn(sp.transcript, {
      turn: 1,
      timestamp: Date.now(),
      question: args.query,
      conclusionMd: conclusion,
      confidence: result.result.confidence,
      rounds: result.result.rounds,
      durationMs: result.result.totalDurationMs,
      reportFile: result.reportHtml ? sp.report : undefined,
      error: result.reportError,
    });

    upsertSession(paths, {
      sessionId,
      createdAt: startedAt,
      lastTurnAt: Date.now(),
      tracePath,
      traceFilename: path.basename(tracePath),
      firstQuery: args.query,
      turnCount: 1,
      status: result.result.success ? 'completed' : 'failed',
    });

    // Terminal summary.
    renderer.printConclusion(conclusion, {
      confidence: result.result.confidence,
      rounds: result.result.rounds,
      durationMs: result.result.totalDurationMs,
    });
    renderer.printCompletion({
      reportPath: reportPathForUser,
      sessionDir: sp.dir,
      sessionId,
    });

    return 0;
  } catch (err) {
    renderer.printError((err as Error).message);
    // Record a failed entry in the index if we got far enough to know sessionId.
    if (sessionId) {
      try {
        upsertSession(paths, {
          sessionId,
          createdAt: startedAt,
          lastTurnAt: Date.now(),
          tracePath,
          traceFilename: path.basename(tracePath),
          firstQuery: args.query,
          turnCount: 1,
          status: 'failed',
        });
      } catch { /* ignore — best-effort */ }
    }
    return 1;
  } finally {
    await service.shutdown();
  }
}

/** Markdown snapshot for `turns/001.md`. Plain-text friendly. */
function formatTurnMarkdown(
  query: string,
  conclusion: string,
  result: { confidence: number; rounds: number; totalDurationMs: number },
): string {
  const lines: string[] = [
    `# Turn 1`,
    ``,
    `**Question**: ${query}`,
    ``,
    `**Confidence**: ${(result.confidence * 100).toFixed(0)}%  ·  **Rounds**: ${result.rounds}  ·  **Duration**: ${(result.totalDurationMs / 1000).toFixed(1)}s`,
    ``,
    `## Conclusion`,
    ``,
    conclusion || '*(empty)*',
    ``,
  ];
  return lines.join('\n');
}
