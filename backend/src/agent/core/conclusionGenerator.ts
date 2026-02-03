/**
 * Conclusion Generator
 *
 * Generates analysis conclusions from accumulated findings and hypotheses.
 * Uses LLM for intelligent root-cause synthesis, with markdown fallback.
 */

import { Intent, Finding } from '../types';
import { SharedAgentContext } from '../types/agentProtocol';
import { ModelRouter } from './modelRouter';
import { ProgressEmitter } from './orchestratorTypes';
import { formatJankSummaryForPrompt } from './jankCauseSummarizer';

export interface ConclusionGenerationOptions {
  /**
   * Number of previous turns in this session (0-based).
   * Example: 0 means this is the first user query of the session.
   */
  turnCount?: number;
  /**
   * Optional multi-turn context summary (compact, prompt-friendly).
   */
  historyContext?: string;
}

/**
 * Format a finding with its evidence data for LLM consumption.
 * Includes title, description, and key data entries from details.
 *
 * Key design decisions:
 * - Priority fields (root_cause, primary_cause, cause_type) are preserved fully
 * - Other details are truncated to manage token usage
 * - Evidence is preserved with reasonable limits
 */
function formatFindingWithEvidence(f: Finding): string {
  let result = `- [${f.severity}] ${f.title}`;
  if (f.description) {
    result += `\n  描述: ${f.description}`;
  }

  if (f.details && typeof f.details === 'object' && Object.keys(f.details).length > 0) {
    // Priority fields that should be preserved in full
    const priorityFields = ['root_cause', 'primary_cause', 'cause_type', 'confidence', 'jank_type'];
    const details = f.details as Record<string, any>;

    // First, output priority fields without truncation
    const priorityEntries: string[] = [];
    for (const field of priorityFields) {
      if (details[field] !== undefined) {
        const val = typeof details[field] === 'object'
          ? JSON.stringify(details[field]).slice(0, 200) // Allow more for structured data
          : String(details[field]);
        priorityEntries.push(`${field}: ${val}`);
      }
    }

    // Then, output other fields with truncation (up to 12 fields, 150 chars each)
    const otherEntries = Object.entries(details)
      .filter(([k]) => !priorityFields.includes(k))
      .slice(0, 12)
      .map(([k, v]) => {
        const val = typeof v === 'object' ? JSON.stringify(v).slice(0, 150) : String(v);
        return `${k}: ${val}`;
      });

    const allEntries = [...priorityEntries, ...otherEntries];
    if (allEntries.length > 0) {
      result += `\n  数据: { ${allEntries.join(', ')} }`;
    }
  }

  // Preserve evidence with reasonable limits (8 items, 200 chars each)
  if (f.evidence && Array.isArray(f.evidence) && f.evidence.length > 0) {
    const evidenceStr = f.evidence.slice(0, 8).map(e =>
      typeof e === 'object' ? JSON.stringify(e).slice(0, 200) : String(e)
    ).join('; ');
    result += `\n  证据: ${evidenceStr}`;
  }

  return result;
}

/**
 * Generate an AI-powered conclusion from analysis results.
 * Falls back to a simple markdown summary if LLM fails.
 */
export async function generateConclusion(
  sharedContext: SharedAgentContext,
  allFindings: Finding[],
  intent: Intent,
  modelRouter: ModelRouter,
  emitter: ProgressEmitter,
  stopReason?: string,
  options: ConclusionGenerationOptions = {}
): Promise<string> {
  const confirmedHypotheses = Array.from(sharedContext.hypotheses.values())
    .filter(h => h.status === 'confirmed' || h.confidence >= 0.85);

  const turnCount = Number.isFinite(options.turnCount) ? Number(options.turnCount) : 0;
  const historyContext = options.historyContext || '';

  // Collect contradicted findings for explicit mention in prompt
  // Instead of filtering them out, we let LLM resolve contradictions with guidance
  const contradictedFindings = allFindings.filter(f => f.details?._contradicted);
  const contradictionReasons = contradictedFindings
    .map(f => f.details?._contradictionReason)
    .filter((r): r is string => typeof r === 'string');

  // Sort findings by confidence (highest first) for better LLM processing
  const sortedFindings = [...allFindings].sort((a, b) => (b.confidence || 0.5) - (a.confidence || 0.5));

  // Filter out contradicted findings to prevent LLM from generating conflicting conclusions
  const findingsForPrompt = sortedFindings.filter(f => !f.details?._contradicted);
  // If all findings were filtered, keep top 5 by confidence as fallback
  const finalFindings = findingsForPrompt.length > 0
    ? findingsForPrompt
    : sortedFindings.slice(0, 5);

  // Dialogue mode: from the 2nd turn onward, switch to an iterative, question-driven style
  // to minimize repeated long-form conclusions and drive user-aligned next steps.
  const useDialogueMode = turnCount >= 1;

  // Build contradiction section for prompt if any exist
  const contradictionSection = contradictionReasons.length > 0
    ? `\n⚠️ 数据矛盾提示:\n${contradictionReasons.map(r => `- ${r}`).join('\n')}\n`
    : '';

  // Build structured jank summary section (from per-frame analysis)
  const jankSummarySection = formatJankSummaryForPrompt(sharedContext.jankCauseSummary);

  // Debug: Log whether jank summary is being included
  if (sharedContext.jankCauseSummary) {
    console.log(`[ConclusionGenerator] Using jankCauseSummary: ${sharedContext.jankCauseSummary.totalJankFrames} frames, primary=${sharedContext.jankCauseSummary.primaryCause?.label}`);
  } else {
    console.log(`[ConclusionGenerator] No jankCauseSummary available in sharedContext`);
  }

  const prompt = useDialogueMode
    ? buildDialogueModePrompt({
      turnCount,
      historyContext,
      intent,
      stopReason,
      confirmedHypotheses: confirmedHypotheses.map(h => ({
        description: h.description,
        confidence: h.confidence,
        status: h.status,
      })),
      findings: sortedFindings,
      jankSummary: sharedContext.jankCauseSummary,
    })
    : `基于以下分析结果生成诊断结论：

用户目标: ${intent.primaryGoal}
${stopReason ? `提前终止原因: ${stopReason}` : ''}
${jankSummarySection}
已确认的假设:
${confirmedHypotheses.map(h => `- ${h.description} (confidence: ${h.confidence.toFixed(2)})`).join('\n') || '无'}

发现的问题（含数据证据）:
${finalFindings.map(f => formatFindingWithEvidence(f)).join('\n\n') || '无'}
${contradictionSection}
调查路径:
${sharedContext.investigationPath.map(s => `${s.stepNumber}. [${s.agentId}] ${s.summary}`).join('\n')}

请生成:
1. 根因分析（最可能的原因）
2. 证据支撑（每个结论的依据）
3. 置信度评估

重要约束：
- 只基于上述提供的数据和证据得出结论，不要推测未提供的信息
- 如果数据不足以得出某个结论，明确标注"证据不足"
- 每个结论必须引用具体的数据来源（Finding 的标题或数据值）
- 不要给出优化建议，只需要指出问题所在

## 刷新率与帧预算
${sharedContext.traceConfig ? (sharedContext.traceConfig.isVRR
  ? `- **VRR/LTPO 模式: ${sharedContext.traceConfig.vrrMode}**
- **主导刷新率: ${sharedContext.traceConfig.refreshRateHz}Hz**（用于大部分帧的判断）
- **帧预算范围: ${sharedContext.traceConfig.minFrameBudgetMs || sharedContext.traceConfig.vsyncPeriodMs}ms - ${sharedContext.traceConfig.maxFrameBudgetMs || sharedContext.traceConfig.vsyncPeriodMs}ms**
- ⚠️ VRR 设备帧预算动态变化，使用最严格标准（${sharedContext.traceConfig.minFrameBudgetMs || sharedContext.traceConfig.vsyncPeriodMs}ms）判断 jank`
  : `- **检测到的刷新率: ${sharedContext.traceConfig.refreshRateHz}Hz**
- **帧预算: ${sharedContext.traceConfig.vsyncPeriodMs}ms**
- 数据来源: ${sharedContext.traceConfig.vsyncSource}`)
: `- 刷新率未检测到，默认使用 120Hz（8.33ms）作为帧预算`}

## 矛盾数据处理规则
如果发现多个 findings 之间存在矛盾，请按以下规则处理：

1. **Q4（休眠/阻塞）占比高** vs **主线程耗时操作**：
   - 需要同时满足两个条件才判定为"阻塞/等待"问题：
     a) Q4 占比 > 30%
     b) Q4 绝对耗时 > 帧预算的 50%（如 120Hz 下 > 4ms）
   - 如果 Q4 占比高但绝对耗时很短（如 2ms），可能只是正常的 Binder/IPC 开销
   - 只有当 Q1+Q2（Running 状态）耗时超过帧预算时，才判定为"主线程耗时操作"

2. **RenderThread 阻塞** vs **GPU 瓶颈**：
   - RenderThread 的 Q4 高可能是等待 GPU Fence 信号，而非 CPU 阻塞
   - 如果同时存在 GPU 频率/负载数据，应综合判断是 GPU 能力不足还是 CPU 等待
   - GPU Fence > 3ms 通常表示 GPU 瓶颈

3. **App 侧正常** vs **消费端掉帧**：
   - App 帧生产正常但消费端掉帧，说明问题在 SurfaceFlinger/HWC 层
   - 此时不应归因于 App，而应指出系统合成层的瓶颈
   - 常见原因：SF 合成延迟、HWC 提交延迟、GPU 合成耗时

4. **掉帧数量不一致**（如 "25 个卡顿帧" vs "38 个卡顿帧"）：
   - 不同统计口径可能导致数量差异：
     - App 报告：App 自己统计的掉帧（可能漏报消费端问题）
     - 消费端检测：用户实际感知的掉帧（包含系统层问题）
     - 帧列表：逐帧分析的结果
   - 应说明使用的是哪个口径，并引用具体 Finding 来源

5. **CPU 频率低** vs **主线程耗时**：
   - 大核频率 < 1.2GHz 时，耗时问题可能是功耗策略导致
   - 此时应指出"CPU 调度/频率不足"而非"代码耗时"

6. **优先采信置信度更高的 Finding**，但必须说明理由

## 输出格式要求（必须严格遵守）
- **只输出 Markdown 格式的纯文本**，方便人类阅读
- **禁止输出 JSON**，不要用 {} 或 [] 包装内容
- **禁止输出代码块**，不要用 \`\`\` 包装
- 使用 ## 作为标题，使用 - 作为列表项
- 示例格式：
  ## 根因分析
  主要问题是 XXX，置信度 85%。

  ## 证据支撑
  - 发现1：XXX
  - 发现2：XXX`;

  try {
    const response = await modelRouter.callWithFallback(prompt, 'synthesis', {
      sessionId: sharedContext.sessionId,
      traceId: sharedContext.traceId,
      promptId: useDialogueMode ? 'agent.conclusionGenerator.dialogue' : 'agent.conclusionGenerator',
      promptVersion: useDialogueMode ? '1.0.0' : '1.0.0',
      contractVersion: useDialogueMode ? 'conclusion_dialogue_text@1.0.0' : 'conclusion_text@1.0.0',
    });

    let conclusion = response.response;

    // Detect if LLM returned JSON/code-block despite format instructions
    const trimmed = conclusion.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('```')) {
      emitter.log('[conclusionGenerator] LLM returned JSON/code-block, converting to Markdown');
      conclusion = convertJsonToMarkdown(conclusion);
    }

    return conclusion;
  } catch (error) {
    emitter.log(`Failed to generate conclusion: ${error}`);
    emitter.emitUpdate('degraded', {
      module: 'conclusionGenerator',
      fallback: useDialogueMode ? 'rule-based dialogue' : 'rule-based summary',
    });
  }

  return useDialogueMode
    ? generateDialogueFallback(sortedFindings, intent, stopReason, historyContext)
    : generateSimpleConclusion(sortedFindings, stopReason);
}

/**
 * Generate a simple markdown-formatted conclusion without LLM.
 */
export function generateSimpleConclusion(findings: Finding[], stopReason?: string): string {
  const critical = findings.filter(f => f.severity === 'critical');
  const warnings = findings.filter(f => f.severity === 'warning');

  let conclusion = '## 分析结论\n\n';

  if (critical.length > 0) {
    conclusion += `### 严重问题 (${critical.length})\n`;
    for (const f of critical) {
      conclusion += `- **${f.title}**\n`;
    }
    conclusion += '\n';
  }

  if (warnings.length > 0) {
    conclusion += `### 需要关注 (${warnings.length})\n`;
    for (const f of warnings) {
      conclusion += `- ${f.title}\n`;
    }
    conclusion += '\n';
  }

  if (findings.length === 0) {
    conclusion += '未发现明显的性能问题。\n';
  }

  if (stopReason) {
    conclusion += `\n> 备注：分析提前结束（${stopReason}）。\n`;
  }

  return conclusion;
}

function buildDialogueModePrompt(params: {
  turnCount: number;
  historyContext: string;
  intent: Intent;
  stopReason?: string;
  confirmedHypotheses: Array<{ description: string; confidence: number; status: string }>;
  findings: Finding[];
  jankSummary?: import('./jankCauseSummarizer').JankCauseSummary;
}): string {
  const parts: string[] = [];

  parts.push(`你是 SmartPerfetto 的 AI 性能分析助手，正在进行多轮对话（当前第 ${params.turnCount + 1} 轮）。`);
  parts.push('你的目标：充分理解用户本轮输入，在不重复长篇报告的前提下，用最小输出推进到"用户满意"。');
  parts.push('');

  parts.push('## 用户本轮输入');
  parts.push(params.intent.primaryGoal);
  parts.push('');

  if (params.stopReason) {
    parts.push('## 本轮停止原因');
    parts.push(params.stopReason);
    parts.push('');
  }

  if (params.historyContext) {
    parts.push('## 对话历史摘要（用于承接上下文）');
    parts.push(params.historyContext);
    parts.push('');
  }

  // Include jank cause summary if available (from per-frame analysis)
  if (params.jankSummary && params.jankSummary.totalJankFrames > 0) {
    parts.push(formatJankSummaryForPrompt(params.jankSummary));
    parts.push('');
  }

  if (params.confirmedHypotheses.length > 0) {
    parts.push('## 已确认假设（摘要）');
    for (const h of params.confirmedHypotheses.slice(0, 5)) {
      parts.push(`- ${h.description} (confidence: ${Number(h.confidence).toFixed(2)})`);
    }
    parts.push('');
  }

  parts.push('## 本轮新增证据（findings 摘要）');
  if (params.findings.length === 0) {
    parts.push('无新增 findings。');
  } else {
    parts.push(params.findings.slice(0, 8).map(f => formatFindingWithEvidence(f)).join('\n\n'));
  }
  parts.push('');

  parts.push('## 输出要求（必须严格遵守）');
  parts.push('- 输出尽量短：总长度不超过 12 行（含空行）');
  parts.push('- 先回答用户本轮问题（如果可直接回答，用 1-3 句话；不要复述历史长文）');
  parts.push('- 然后提出最多 3 个澄清问题（每行以 "Q:" 开头），问题必须是决定下一步分析方向的关键信息');
  parts.push('- 结尾给出 2-3 个可选下一步（以 "A."/"B."/"C." 开头），让用户选择');
  parts.push('- 不要输出 SQL、不要代码块、不要编造未提供的数据');
  parts.push('- 全部中文');

  return parts.join('\n');
}

function generateDialogueFallback(
  findings: Finding[],
  intent: Intent,
  stopReason?: string,
  historyContext?: string
): string {
  const lines: string[] = [];

  // 1) Minimal acknowledgement of the user request
  lines.push(`我理解你想继续推进：${intent.primaryGoal}`);

  // 2) Keep it short: surface what we have (if any)
  const topTitles = findings
    .filter(f => typeof f.title === 'string' && f.title.trim().length > 0)
    .slice(0, 3)
    .map(f => f.title.trim());
  if (topTitles.length > 0) {
    lines.push(`目前可承接的线索：${topTitles.join('；')}`);
  } else if (historyContext) {
    lines.push('目前我会基于已有对话上下文继续推进。');
  }

  if (stopReason) {
    lines.push(`备注：本轮提前结束（${stopReason}）。`);
  }

  // 3) Ask the minimal next question(s)
  lines.push('Q: 你希望我下一步聚焦在哪里？（给出 frame_id / session_id / 时间范围 / 进程名之一即可）');
  lines.push('A. 深入某个卡顿帧（例如：frame_id=123）');
  lines.push('B. 深入某个滑动会话（例如：session_id=2）');
  lines.push('C. 重新指定一个时间范围（例如：1.2s~1.5s）');

  return lines.join('\n');
}

/**
 * Convert JSON response to Markdown when LLM ignores format instructions.
 * This is a fallback to ensure human-readable output.
 */
function convertJsonToMarkdown(jsonStr: string): string {
  // 1. Remove code block markers if present
  let cleaned = jsonStr
    .replace(/^```(?:json)?\s*\n?/, '')
    .replace(/\n?```$/, '')
    .trim();

  // 2. Try to parse as JSON
  try {
    const parsed = JSON.parse(cleaned);
    const lines: string[] = [];

    // Extract root cause analysis
    if (parsed.rootCauseAnalysis && Array.isArray(parsed.rootCauseAnalysis)) {
      lines.push('## 根因分析\n');
      for (const item of parsed.rootCauseAnalysis) {
        const conclusion = item.conclusion || item.title || '结论';
        const confidence = item.confidence ? ` (置信度: ${item.confidence})` : '';
        lines.push(`### ${conclusion}${confidence}\n`);

        if (item.evidence && Array.isArray(item.evidence)) {
          lines.push('**证据:**');
          for (const e of item.evidence) {
            lines.push(`- ${typeof e === 'object' ? JSON.stringify(e) : e}`);
          }
          lines.push('');
        }
      }
    }

    // Extract conclusion field if present
    if (parsed.conclusion && typeof parsed.conclusion === 'string') {
      if (lines.length === 0) {
        lines.push('## 分析结论\n');
      }
      lines.push(parsed.conclusion);
      lines.push('');
    }

    // Extract summary if present
    if (parsed.summary && typeof parsed.summary === 'string') {
      lines.push('## 总结\n');
      lines.push(parsed.summary);
      lines.push('');
    }

    // Extract findings array if present
    if (parsed.findings && Array.isArray(parsed.findings)) {
      lines.push('## 发现\n');
      for (const f of parsed.findings) {
        const title = f.title || f.name || '发现';
        const severity = f.severity ? `[${f.severity}] ` : '';
        lines.push(`- ${severity}${title}`);
        if (f.description) {
          lines.push(`  ${f.description}`);
        }
      }
      lines.push('');
    }

    // If we extracted anything, return it
    if (lines.length > 0) {
      return lines.join('\n');
    }

    // Otherwise, format the entire object as a simple list
    return formatObjectAsMarkdown(parsed);
  } catch {
    // JSON parse failed, return cleaned string as-is
    return cleaned;
  }
}

/**
 * Format an arbitrary object as Markdown list.
 */
function formatObjectAsMarkdown(obj: Record<string, any>, indent = ''): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      lines.push(`${indent}**${key}:**`);
      for (const item of value) {
        if (typeof item === 'object') {
          lines.push(`${indent}- ${JSON.stringify(item).slice(0, 200)}`);
        } else {
          lines.push(`${indent}- ${item}`);
        }
      }
    } else if (typeof value === 'object') {
      lines.push(`${indent}**${key}:**`);
      lines.push(formatObjectAsMarkdown(value, indent + '  '));
    } else {
      lines.push(`${indent}- **${key}:** ${value}`);
    }
  }

  return lines.join('\n');
}
