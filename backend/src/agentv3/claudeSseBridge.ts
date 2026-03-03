import type { StreamingUpdate } from '../agent/types';

export type UpdateEmitter = (update: StreamingUpdate) => void;

/** Map MCP tool names to user-friendly Chinese descriptions. */
function getFriendlyToolMessage(toolName: string, args: any): string {
  switch (toolName) {
    case 'mcp__smartperfetto__execute_sql':
      return '执行 SQL 查询';
    case 'mcp__smartperfetto__invoke_skill': {
      const skillId = args?.skillId;
      return skillId ? `调用分析技能: ${skillId}` : '调用分析技能';
    }
    case 'mcp__smartperfetto__list_skills':
      return '查询可用技能列表';
    case 'mcp__smartperfetto__detect_architecture':
      return '检测渲染架构';
    case 'mcp__smartperfetto__lookup_sql_schema':
      return `查询 SQL 表结构: ${args?.keyword || ''}`;
    default:
      return `调用工具: ${toolName}`;
  }
}

/**
 * Creates a bridge function that translates Agent SDK messages into
 * SmartPerfetto StreamingUpdate events for SSE forwarding to the frontend.
 */
export function createSseBridge(emit: UpdateEmitter) {
  let lastToolUseId: string | undefined;

  return function handleSdkMessage(msg: any): void {
    const now = Date.now();

    if (msg.type === 'system' && msg.subtype === 'init') {
      emit({
        type: 'progress',
        content: { phase: 'starting', message: 'Claude 分析引擎已初始化', model: msg.model, tools: msg.tools },
        timestamp: now,
      });
      return;
    }

    if (msg.type === 'stream_event') {
      const event = msg.event;
      if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        emit({ type: 'answer_token', content: { token: event.delta.text }, timestamp: now });
      }
      return;
    }

    if (msg.type === 'assistant') {
      const content = msg.message?.content;
      if (!Array.isArray(content)) return;

      for (const block of content) {
        if (block.type === 'tool_use') {
          lastToolUseId = block.id;
          const friendlyMsg = getFriendlyToolMessage(block.name, block.input);
          emit({
            type: 'agent_task_dispatched',
            content: { taskId: block.id, toolName: block.name, args: block.input, message: friendlyMsg },
            timestamp: now,
          });
        } else if (block.type === 'text' && block.text?.trim().length > 0) {
          emit({
            type: 'progress',
            content: { phase: 'analyzing', message: block.text },
            timestamp: now,
          });
        }
      }
      return;
    }

    if (msg.type === 'user' && msg.tool_use_result !== undefined) {
      emit({
        type: 'agent_response',
        content: {
          taskId: lastToolUseId || 'unknown',
          result: typeof msg.tool_use_result === 'string'
            ? msg.tool_use_result
            : JSON.stringify(msg.tool_use_result),
        },
        timestamp: now,
      });
      return;
    }

    if (msg.type === 'result') {
      if (msg.subtype === 'success') {
        emit({
          type: 'conclusion',
          content: { conclusion: msg.result || '', durationMs: msg.duration_ms, turns: msg.num_turns, costUsd: msg.total_cost_usd },
          timestamp: now,
        });
      } else {
        const errors = msg.errors || [];
        emit({
          type: 'error',
          content: {
            message: `Claude analysis error (${msg.subtype}): ${errors.join('; ') || 'Unknown error'}`,
            subtype: msg.subtype,
          },
          timestamp: now,
        });
      }
    }
  };
}
