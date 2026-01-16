/**
 * Launch Analysis Decision Tree
 *
 * 实现专家级启动性能分析的决策逻辑：
 * 1. 获取启动各阶段耗时
 * 2. 定位最慢的阶段
 * 3. 深入分析该阶段的具体问题
 * 4. 给出根因结论
 */

import { DecisionTree, DecisionContext } from '../types';

/**
 * 启动分析决策树
 */
export const launchDecisionTree: DecisionTree = {
  id: 'launch_analysis_v1',
  name: '启动性能分析决策树',
  description: '专家级启动性能分析，定位启动慢的阶段和根因',
  analysisType: 'launch',
  entryNode: 'get_launch_overview',

  nodes: [
    // ===== 阶段 1: 获取启动概览 =====
    {
      id: 'get_launch_overview',
      type: 'ACTION',
      name: '获取启动概览',
      action: {
        description: '执行启动分析获取各阶段耗时',
        skill: 'startup_analysis',
        params: {},
        resultKey: 'launch_data',
      },
      next: {
        default: 'check_launch_type',
      },
    },

    // ===== 阶段 2: 判断启动类型 =====
    {
      id: 'check_launch_type',
      type: 'BRANCH',
      name: '判断启动类型',
      branches: [
        {
          condition: {
            description: '冷启动？',
            useResultFrom: 'launch_data',
            evaluate: (data, _context) => {
              return extractLaunchType(data) === 'cold';
            },
          },
          next: 'analyze_cold_launch',
        },
        {
          condition: {
            description: '温启动？',
            useResultFrom: 'launch_data',
            evaluate: (data, _context) => {
              return extractLaunchType(data) === 'warm';
            },
          },
          next: 'analyze_warm_launch',
        },
      ],
      next: {
        default: 'analyze_hot_launch',
      },
    },

    // ===== 分支 A: 冷启动分析 =====
    {
      id: 'analyze_cold_launch',
      type: 'CHECK',
      name: '检查冷启动总耗时',
      check: {
        description: 'TTID < 1000ms？',
        useResultFrom: 'launch_data',
        evaluate: (data, _context) => {
          const ttid = extractTTID(data);
          return ttid < 1000;
        },
      },
      next: {
        true: 'conclude_launch_ok',
        false: 'find_slowest_phase',
      },
    },

    {
      id: 'conclude_launch_ok',
      type: 'CONCLUDE',
      name: '结论：启动正常',
      conclusion: {
        category: 'UNKNOWN',
        component: 'UNKNOWN',
        summaryTemplate: '启动性能正常，TTID 在可接受范围内',
        confidence: 0.9,
        suggestedNextSteps: [],
      },
    },

    // ===== 定位最慢阶段 =====
    {
      id: 'find_slowest_phase',
      type: 'BRANCH',
      name: '定位最慢阶段',
      branches: [
        {
          condition: {
            description: '进程创建耗时最长？',
            useResultFrom: 'launch_data',
            evaluate: (data, _context) => {
              return getSlowestPhase(data) === 'process_start';
            },
          },
          next: 'analyze_process_start',
        },
        {
          condition: {
            description: 'Application 初始化最长？',
            useResultFrom: 'launch_data',
            evaluate: (data, _context) => {
              return getSlowestPhase(data) === 'application_init';
            },
          },
          next: 'conclude_app_init_slow',
        },
        {
          condition: {
            description: 'Activity 创建最长？',
            useResultFrom: 'launch_data',
            evaluate: (data, _context) => {
              return getSlowestPhase(data) === 'activity_create';
            },
          },
          next: 'analyze_activity_create',
        },
        {
          condition: {
            description: '首帧渲染最长？',
            useResultFrom: 'launch_data',
            evaluate: (data, _context) => {
              return getSlowestPhase(data) === 'first_frame';
            },
          },
          next: 'conclude_first_frame_slow',
        },
      ],
      next: {
        default: 'conclude_launch_slow_mixed',
      },
    },

    // ===== 进程启动分析 =====
    {
      id: 'analyze_process_start',
      type: 'CHECK',
      name: '检查进程启动细节',
      check: {
        description: 'Zygote fork 耗时 > 100ms？',
        useResultFrom: 'launch_data',
        evaluate: (data, _context) => {
          const forkTime = extractZygoteForkTime(data);
          return forkTime > 100;
        },
      },
      next: {
        true: 'conclude_zygote_slow',
        false: 'conclude_bind_application_slow',
      },
    },

    {
      id: 'conclude_zygote_slow',
      type: 'CONCLUDE',
      name: '结论：Zygote fork 慢',
      conclusion: {
        category: 'SYSTEM',
        component: 'UNKNOWN',
        summaryTemplate: 'Zygote fork 进程耗时过长，可能是系统负载高或内存压力大',
        confidence: 0.8,
        suggestedNextSteps: [
          '检查系统内存使用情况',
          '检查是否有大量进程在运行',
          '检查 IO 压力',
        ],
      },
    },

    {
      id: 'conclude_bind_application_slow',
      type: 'CONCLUDE',
      name: '结论：bindApplication 慢',
      conclusion: {
        category: 'APP',
        component: 'MAIN_THREAD',
        summaryTemplate: '进程绑定 Application 耗时长，可能是 App 有大量静态初始化',
        confidence: 0.8,
        suggestedNextSteps: [
          '检查 Application.onCreate 内容',
          '检查静态代码块',
          '检查 ContentProvider 初始化',
        ],
      },
    },

    // ===== Application 初始化分析 =====
    {
      id: 'conclude_app_init_slow',
      type: 'CONCLUDE',
      name: '结论：Application 初始化慢',
      conclusion: {
        category: 'APP',
        component: 'MAIN_THREAD',
        summaryTemplate: 'Application.onCreate 耗时过长，App 在初始化阶段做了过多工作',
        confidence: 0.85,
        suggestedNextSteps: [
          '将非必要初始化延迟到首屏显示后',
          '使用懒加载',
          '检查第三方 SDK 初始化',
        ],
      },
    },

    // ===== Activity 创建分析 =====
    {
      id: 'analyze_activity_create',
      type: 'CHECK',
      name: '检查 Activity 创建细节',
      check: {
        description: '布局加载耗时 > 200ms？',
        useResultFrom: 'launch_data',
        evaluate: (data, _context) => {
          const inflateTime = extractLayoutInflateTime(data);
          return inflateTime > 200;
        },
      },
      next: {
        true: 'conclude_layout_inflate_slow',
        false: 'conclude_activity_lifecycle_slow',
      },
    },

    {
      id: 'conclude_layout_inflate_slow',
      type: 'CONCLUDE',
      name: '结论：布局加载慢',
      conclusion: {
        category: 'APP',
        component: 'MAIN_THREAD',
        summaryTemplate: '布局加载 (inflate) 耗时过长，布局可能过于复杂',
        confidence: 0.85,
        suggestedNextSteps: [
          '减少布局层级',
          '使用 ViewStub 延迟加载',
          '检查自定义 View 的初始化',
        ],
      },
    },

    {
      id: 'conclude_activity_lifecycle_slow',
      type: 'CONCLUDE',
      name: '结论：Activity 生命周期慢',
      conclusion: {
        category: 'APP',
        component: 'MAIN_THREAD',
        summaryTemplate: 'Activity 生命周期回调 (onCreate/onStart/onResume) 耗时过长',
        confidence: 0.8,
        suggestedNextSteps: [
          '检查 onCreate 中的耗时操作',
          '将数据加载移到后台线程',
          '使用异步初始化',
        ],
      },
    },

    // ===== 首帧渲染分析 =====
    {
      id: 'conclude_first_frame_slow',
      type: 'CONCLUDE',
      name: '结论：首帧渲染慢',
      conclusion: {
        category: 'APP',
        component: 'RENDER_THREAD',
        summaryTemplate: '首帧渲染耗时过长，可能是首屏内容复杂或有 GPU 编译',
        confidence: 0.8,
        suggestedNextSteps: [
          '检查首屏布局复杂度',
          '检查是否有大量图片加载',
          '检查 GPU Shader 编译',
        ],
      },
    },

    // ===== 混合问题 =====
    {
      id: 'conclude_launch_slow_mixed',
      type: 'CONCLUDE',
      name: '结论：多阶段都慢',
      conclusion: {
        category: 'MIXED',
        component: 'UNKNOWN',
        summaryTemplate: '启动慢由多个阶段共同导致，没有单一瓶颈',
        confidence: 0.6,
        suggestedNextSteps: [
          '逐阶段优化',
          '优先优化耗时最长的阶段',
        ],
      },
    },

    // ===== 分支 B: 温启动分析 =====
    {
      id: 'analyze_warm_launch',
      type: 'CHECK',
      name: '检查温启动耗时',
      check: {
        description: '温启动 < 500ms？',
        useResultFrom: 'launch_data',
        evaluate: (data, _context) => {
          const warmTime = extractWarmLaunchTime(data);
          return warmTime < 500;
        },
      },
      next: {
        true: 'conclude_launch_ok',
        false: 'conclude_warm_launch_slow',
      },
    },

    {
      id: 'conclude_warm_launch_slow',
      type: 'CONCLUDE',
      name: '结论：温启动慢',
      conclusion: {
        category: 'APP',
        component: 'MAIN_THREAD',
        summaryTemplate: '温启动耗时过长，Activity 重建过程有瓶颈',
        confidence: 0.8,
        suggestedNextSteps: [
          '检查 onRestart/onStart/onResume 耗时',
          '检查 View 状态恢复',
        ],
      },
    },

    // ===== 分支 C: 热启动分析 =====
    {
      id: 'analyze_hot_launch',
      type: 'CHECK',
      name: '检查热启动耗时',
      check: {
        description: '热启动 < 200ms？',
        useResultFrom: 'launch_data',
        evaluate: (data, _context) => {
          const hotTime = extractHotLaunchTime(data);
          return hotTime < 200;
        },
      },
      next: {
        true: 'conclude_launch_ok',
        false: 'conclude_hot_launch_slow',
      },
    },

    {
      id: 'conclude_hot_launch_slow',
      type: 'CONCLUDE',
      name: '结论：热启动慢',
      conclusion: {
        category: 'APP',
        component: 'MAIN_THREAD',
        summaryTemplate: '热启动耗时过长，onResume 可能有耗时操作',
        confidence: 0.8,
        suggestedNextSteps: [
          '检查 onResume 中的操作',
          '检查是否有同步的数据刷新',
        ],
      },
    },
  ],
};

// ===== 辅助函数 =====

function extractLaunchType(data: any): 'cold' | 'warm' | 'hot' {
  if (!data) return 'cold';
  if (data.launch_type) return data.launch_type;
  // 根据数据判断启动类型
  if (data.has_process_start || data.process_start_time > 0) return 'cold';
  if (data.has_activity_restart) return 'warm';
  return 'hot';
}

function extractTTID(data: any): number {
  if (!data) return 0;
  if (data.ttid !== undefined) return data.ttid;
  if (data.time_to_initial_display !== undefined) return data.time_to_initial_display;
  if (data.total_time !== undefined) return data.total_time;
  return 0;
}

function getSlowestPhase(data: any): string {
  if (!data) return 'unknown';

  const phases: { name: string; time: number }[] = [
    { name: 'process_start', time: data.process_start_time || 0 },
    { name: 'application_init', time: data.application_init_time || 0 },
    { name: 'activity_create', time: data.activity_create_time || 0 },
    { name: 'first_frame', time: data.first_frame_time || 0 },
  ];

  const slowest = phases.reduce((a, b) => (a.time > b.time ? a : b));
  return slowest.time > 0 ? slowest.name : 'unknown';
}

function extractZygoteForkTime(data: any): number {
  if (!data) return 0;
  return data.zygote_fork_time || data.fork_time || 0;
}

function extractLayoutInflateTime(data: any): number {
  if (!data) return 0;
  return data.layout_inflate_time || data.inflate_time || 0;
}

function extractWarmLaunchTime(data: any): number {
  if (!data) return 0;
  return data.warm_launch_time || data.restart_time || 0;
}

function extractHotLaunchTime(data: any): number {
  if (!data) return 0;
  return data.hot_launch_time || data.resume_time || 0;
}

export default launchDecisionTree;
