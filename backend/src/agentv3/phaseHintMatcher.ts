// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * Pure phase-hint matching used by `update_plan_phase` to pick the
 * restatement to inject into a tool response. Extracted from
 * `claudeMcpServer.ts` (Phase 4 of v2.1) so the algorithm can be unit
 * tested without standing up a full MCP server.
 *
 * Two-stage match, matching the behaviour Codex review F.3 documented:
 *
 *   1. Keyword match against the next phase's `name + goal`. Wins
 *      whenever the agent named the phase using vocabulary that overlaps
 *      with any hint's `keywords`.
 *   2. Unconditional critical fallback. If keyword matching missed,
 *      inject the next `critical` hint that has not been covered by an
 *      already-finished phase. Critical hints (e.g. scrolling root-cause
 *      drill) are too important to skip just because the agent used a
 *      different name for the phase.
 */

import type { PhaseHint } from './strategyLoader';

interface PhaseSnapshot {
  name: string;
  goal?: string;
  summary?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
}

/**
 * Resolve the hint to inject into the response of a phase transition.
 * Returns `undefined` when no hint is applicable (e.g. agent's phase
 * matches no keywords AND every critical hint has already been covered).
 */
export function matchPhaseHintForNextPhase(input: {
  hints: ReadonlyArray<PhaseHint>;
  nextPhase: { name: string; goal?: string };
  finishedPhases: ReadonlyArray<PhaseSnapshot>;
}): PhaseHint | undefined {
  const { hints, nextPhase, finishedPhases } = input;
  if (hints.length === 0) return undefined;

  const phaseText = `${nextPhase.name} ${nextPhase.goal ?? ''}`.toLowerCase();

  const keywordMatch = hints.find(h =>
    h.keywords.some(kw => phaseText.includes(kw.toLowerCase())),
  );
  if (keywordMatch) return keywordMatch;

  const coveredHintIds = new Set<string>();
  for (const phase of finishedPhases) {
    if (phase.status !== 'completed' && phase.status !== 'skipped') continue;
    const pText = `${phase.name} ${phase.summary ?? ''}`.toLowerCase();
    for (const h of hints) {
      if (h.keywords.some(kw => pText.includes(kw.toLowerCase()))) {
        coveredHintIds.add(h.id);
      }
    }
  }
  return hints.find(h => h.critical && !coveredHintIds.has(h.id));
}
