/**
 * Jank Cause Summarizer
 *
 * Aggregates jank root causes from findings and produces a structured summary.
 * Used by StrategyExecutor after per-frame analysis to provide the ConclusionGenerator
 * with pre-computed statistics instead of relying on LLM to infer patterns.
 *
 * Key design principles:
 * - Extract cause_type from Finding.details (populated by DirectSkillExecutor)
 * - Group and count by cause_type
 * - Identify primary (most common) and secondary (>10%) causes
 * - Generate human-readable summary text for LLM prompt inclusion
 */

import { Finding } from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Statistics for a single cause type.
 */
export interface CauseTypeStats {
  /** Cause type key (e.g., 'slice', 'gpu_fence', 'sched_latency') */
  causeType: string;
  /** Human-readable label (e.g., '主线程耗时操作') */
  label: string;
  /** Number of frames with this cause */
  frameCount: number;
  /** Percentage of total jank frames */
  percentage: number;
  /** Highest severity among frames with this cause */
  severity: 'critical' | 'warning' | 'info';
  /** Sample primary_cause descriptions (max 3 unique) */
  exampleCauses: string[];
}

/**
 * Complete jank cause summary.
 */
export interface JankCauseSummary {
  /** Total number of analyzed jank frames */
  totalJankFrames: number;
  /** Most common cause (null if no causes found) */
  primaryCause: CauseTypeStats | null;
  /** Other significant causes (>=10% of frames) */
  secondaryCauses: CauseTypeStats[];
  /** Full breakdown of all causes */
  allCauses: CauseTypeStats[];
  /** Pre-formatted summary text for LLM prompt */
  summaryText: string;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Mapping from cause_type to human-readable Chinese labels.
 * These must match the cause_type values in jank_frame_detail.skill.yaml root_cause_summary SQL.
 */
export const CAUSE_TYPE_LABELS: Record<string, string> = {
  slice: '主线程耗时操作',
  gpu_fence: 'GPU Fence 等待',
  sched_latency: '调度延迟',
  cpu_contention: 'CPU 争抢',
  io_blocking: 'IO 阻塞',
  blocking: '主线程阻塞 (Binder/锁)',
  render_wait: 'RenderThread 等待',
  small_core: '小核运行',
  freq_limit: 'CPU 限频',
  cpu_overload: 'CPU 负载过高',
  unknown: '其他原因',
};

/**
 * Threshold for secondary cause classification (percentage).
 */
const SECONDARY_CAUSE_THRESHOLD = 10;

// =============================================================================
// Main Function
// =============================================================================

/**
 * Summarize jank causes from an array of findings.
 *
 * Extracts cause_type from Finding.details (populated by DirectSkillExecutor.enrichFindingsWithRootCauseData)
 * and produces aggregated statistics.
 *
 * @param findings - Array of findings from per-frame analysis
 * @returns JankCauseSummary with statistics and pre-formatted text
 */
export function summarizeJankCauses(findings: Finding[]): JankCauseSummary {
  // 1. Filter to findings that have cause_type in details
  const causedFindings = findings.filter(f =>
    f.details?.cause_type && typeof f.details.cause_type === 'string'
  );

  // Debug: Log findings with and without cause_type
  const withCauseType = causedFindings.length;
  const withoutCauseType = findings.filter(f => !f.details?.cause_type).length;
  console.log(`[JankCauseSummarizer] ${findings.length} total findings: ${withCauseType} with cause_type, ${withoutCauseType} without`);

  if (causedFindings.length === 0) {
    // Debug: Sample findings to understand why they lack cause_type
    if (findings.length > 0) {
      const sample = findings.slice(0, 3).map(f => ({
        title: f.title?.slice(0, 50),
        detailsKeys: f.details ? Object.keys(f.details) : [],
      }));
      console.log(`[JankCauseSummarizer] Sample findings without cause_type: ${JSON.stringify(sample)}`);
    }

    return {
      totalJankFrames: 0,
      primaryCause: null,
      secondaryCauses: [],
      allCauses: [],
      summaryText: '未检测到可分类的根因数据',
    };
  }

  // 2. Group by cause_type
  const causeGroups = new Map<string, Finding[]>();
  for (const f of causedFindings) {
    const causeType = f.details!.cause_type as string;
    if (!causeGroups.has(causeType)) {
      causeGroups.set(causeType, []);
    }
    causeGroups.get(causeType)!.push(f);
  }

  // 3. Build stats for each cause type and sort by frame count
  const totalFrames = causedFindings.length;
  const allStats: CauseTypeStats[] = Array.from(causeGroups.entries())
    .map(([causeType, causeFindings]) => {
      // Collect unique primary_cause descriptions (max 3)
      const uniqueCauses = [
        ...new Set(
          causeFindings
            .map(f => f.details?.primary_cause)
            .filter((c): c is string => typeof c === 'string' && c.length > 0)
        ),
      ].slice(0, 3);

      // Determine highest severity
      const hasCritical = causeFindings.some(f => f.severity === 'critical');
      const hasWarning = causeFindings.some(f => f.severity === 'warning');
      const severity: 'critical' | 'warning' | 'info' = hasCritical
        ? 'critical'
        : hasWarning
          ? 'warning'
          : 'info';

      return {
        causeType,
        label: CAUSE_TYPE_LABELS[causeType] || causeType,
        frameCount: causeFindings.length,
        percentage: Math.round((causeFindings.length / totalFrames) * 100),
        severity,
        exampleCauses: uniqueCauses,
      };
    })
    .sort((a, b) => b.frameCount - a.frameCount);

  // 4. Identify primary and secondary causes
  const primaryCause = allStats[0] || null;
  const secondaryCauses = allStats
    .slice(1)
    .filter(s => s.percentage >= SECONDARY_CAUSE_THRESHOLD);

  // 5. Generate summary text
  const summaryText = generateSummaryText(primaryCause, secondaryCauses, totalFrames);

  return {
    totalJankFrames: totalFrames,
    primaryCause,
    secondaryCauses,
    allCauses: allStats,
    summaryText,
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a human-readable summary text for LLM prompt inclusion.
 */
function generateSummaryText(
  primaryCause: CauseTypeStats | null,
  secondaryCauses: CauseTypeStats[],
  totalFrames: number
): string {
  if (!primaryCause) {
    return '未检测到可分类的根因数据';
  }

  const lines: string[] = [];

  // Header with total count
  lines.push(`### 掉帧根因统计 (${totalFrames} 帧)\n`);

  // Table header
  lines.push('| 原因类型 | 帧数 | 占比 | 级别 |');
  lines.push('|---------|-----|------|------|');

  // Primary cause row
  const primaryLevel = primaryCause.percentage >= 50 ? '**首要原因**' : '首要原因';
  lines.push(
    `| ${primaryCause.label} | ${primaryCause.frameCount} | ${primaryCause.percentage}% | ${primaryLevel} |`
  );

  // Secondary causes
  for (const cause of secondaryCauses) {
    lines.push(
      `| ${cause.label} | ${cause.frameCount} | ${cause.percentage}% | 次要原因 |`
    );
  }

  // Other causes (grouped as "其他")
  const otherCauses = primaryCause
    ? [primaryCause, ...secondaryCauses].reduce(
        (sum, c) => sum + c.frameCount,
        0
      )
    : 0;
  const otherCount = totalFrames - otherCauses;
  if (otherCount > 0 && totalFrames > 0) {
    const otherPct = Math.round((otherCount / totalFrames) * 100);
    lines.push(`| 其他 | ${otherCount} | ${otherPct}% | - |`);
  }

  lines.push('');

  // Add example causes for context
  if (primaryCause.exampleCauses.length > 0) {
    lines.push(`**首要原因示例：**`);
    for (const example of primaryCause.exampleCauses.slice(0, 2)) {
      lines.push(`- ${example}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format a JankCauseSummary for inclusion in conclusion generator prompt.
 * Returns empty string if no meaningful summary exists.
 */
export function formatJankSummaryForPrompt(summary: JankCauseSummary | undefined): string {
  if (!summary || summary.totalJankFrames === 0) {
    return '';
  }

  return `## 掉帧根因汇总（自动统计）

${summary.summaryText}

> 以上统计基于 ${summary.totalJankFrames} 个掉帧的逐帧分析结果，请在结论中引用这些数据。
`;
}
