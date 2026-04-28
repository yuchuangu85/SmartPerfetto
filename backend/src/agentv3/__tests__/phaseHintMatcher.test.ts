// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * Phase 4 of v2.1 — exercise the next_phase_reminder selection logic
 * without standing up a full MCP server. Two-stage match: keyword
 * against the next phase's `name + goal`, then unconditional critical
 * fallback if every keyword missed.
 */

import { describe, it, expect } from '@jest/globals';
import { matchPhaseHintForNextPhase } from '../phaseHintMatcher';
import type { PhaseHint } from '../strategyLoader';

const overviewHint: PhaseHint = {
  id: 'overview',
  keywords: ['概览', 'overview', 'frame', 'jank'],
  constraints: '调用 scrolling_analysis 取全帧统计',
  criticalTools: ['scrolling_analysis'],
  critical: false,
};

const rootCauseHint: PhaseHint = {
  id: 'root_cause_drill',
  keywords: ['根因', 'root cause', 'drill', '深钻'],
  constraints: '对占比 >15% 的 reason_code 必须深钻',
  criticalTools: ['jank_frame_detail'],
  critical: true,
};

const conclusionHint: PhaseHint = {
  id: 'conclusion',
  keywords: ['结论', 'conclusion', '报告'],
  constraints: '输出全帧根因分布表 + 代表帧分析',
  criticalTools: [],
  critical: false,
};

describe('matchPhaseHintForNextPhase', () => {
  it('returns undefined when no hints are configured', () => {
    expect(matchPhaseHintForNextPhase({
      hints: [],
      nextPhase: { name: '根因分析', goal: '查找卡顿原因' },
      finishedPhases: [],
    })).toBeUndefined();
  });

  it('keyword match — picks the hint whose keyword appears in the phase name/goal', () => {
    const result = matchPhaseHintForNextPhase({
      hints: [overviewHint, rootCauseHint, conclusionHint],
      nextPhase: { name: '根因分析', goal: '查找卡顿原因' },
      finishedPhases: [],
    });
    expect(result?.id).toBe('root_cause_drill');
  });

  it('keyword match is case-insensitive across English keywords', () => {
    const result = matchPhaseHintForNextPhase({
      hints: [overviewHint, rootCauseHint, conclusionHint],
      nextPhase: { name: 'Deep Drill Analysis', goal: 'identify the underlying cause' },
      finishedPhases: [],
    });
    // "drill" hits rootCauseHint; overview keywords (frame/jank/overview) absent.
    expect(result?.id).toBe('root_cause_drill');
  });

  it('falls back to the next critical hint when keyword matching misses', () => {
    const result = matchPhaseHintForNextPhase({
      hints: [overviewHint, rootCauseHint, conclusionHint],
      nextPhase: { name: 'Mystery Phase', goal: 'do unspecified work' },
      finishedPhases: [],
    });
    expect(result?.id).toBe('root_cause_drill');
    expect(result?.critical).toBe(true);
  });

  it('does not re-inject a critical hint already covered by a finished phase', () => {
    const result = matchPhaseHintForNextPhase({
      hints: [overviewHint, rootCauseHint, conclusionHint],
      nextPhase: { name: 'Mystery Phase', goal: 'do unspecified work' },
      finishedPhases: [
        { name: '根因深钻', summary: '已分析 reason_code 分布', status: 'completed' },
      ],
    });
    // root_cause_drill was implicitly covered by the finished phase, so no
    // critical hint remains for the fallback.
    expect(result).toBeUndefined();
  });

  it('counts a hint as covered only when the finished phase is `completed` or `skipped`', () => {
    const result = matchPhaseHintForNextPhase({
      hints: [overviewHint, rootCauseHint, conclusionHint],
      nextPhase: { name: 'Mystery Phase', goal: 'do unspecified work' },
      finishedPhases: [
        // pending phase mentioning the keyword should NOT count as covered
        { name: '根因深钻', summary: '尚未开始', status: 'pending' },
      ],
    });
    expect(result?.id).toBe('root_cause_drill');
  });

  it('returns undefined when no critical hint exists and keyword matching missed', () => {
    const onlyNonCritical = [overviewHint, conclusionHint]; // both critical: false
    const result = matchPhaseHintForNextPhase({
      hints: onlyNonCritical,
      nextPhase: { name: 'Mystery Phase', goal: 'do unspecified work' },
      finishedPhases: [],
    });
    expect(result).toBeUndefined();
  });

  it('keyword match wins even when a critical hint also has a keyword match', () => {
    const result = matchPhaseHintForNextPhase({
      hints: [conclusionHint, rootCauseHint],
      nextPhase: { name: '总结报告', goal: '编写最终结论' },
      finishedPhases: [],
    });
    // first keyword hit wins regardless of `critical`
    expect(result?.id).toBe('conclusion');
  });

  it('handles missing goal gracefully', () => {
    const result = matchPhaseHintForNextPhase({
      hints: [overviewHint],
      nextPhase: { name: 'overview gathering' },
      finishedPhases: [],
    });
    expect(result?.id).toBe('overview');
  });
});
