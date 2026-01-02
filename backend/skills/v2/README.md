# SmartPerfetto V2 Skills 系统

## 概述

V2 Skills 系统是 SmartPerfetto 的新一代技能执行引擎，支持：
- **组合技能 (composite)**: 多步骤组合执行
- **迭代器 (iterator)**: 对数据集逐项分析
- **诊断规则 (diagnostic)**: 规则匹配+AI辅助诊断
- **AI 总结 (ai_summary)**: 智能分析总结

## 目录结构

```
skills/v2/
├── README.md                               # 本文档
├── atomic/                                 # 原子技能（单步SQL查询）
│   ├── binder_in_range.skill.yaml
│   ├── cpu_slice_analysis.skill.yaml
│   └── scheduling_analysis.skill.yaml
└── composite/                              # 组合技能（多步骤+迭代）
    ├── scrolling_analysis.skill.yaml       # 滑动性能分析 v2.3
    ├── jank_frame_detail.skill.yaml        # 掉帧帧详细分析 v2.1
    ├── startup_analysis.skill.yaml         # 启动分析 v2.2
    ├── startup_detail.skill.yaml           # 启动详细分析 v2.0
    ├── anr_analysis.skill.yaml             # ANR 分析 v2.2
    ├── anr_detail.skill.yaml               # ANR 详细分析 v2.0
    ├── click_response_analysis.skill.yaml  # 点击响应分析 v2.2
    ├── click_response_detail.skill.yaml    # 点击响应详细分析 v2.0
    ├── binder_analysis.skill.yaml          # Binder 分析 v2.2
    └── binder_detail.skill.yaml            # Binder 详细分析 v2.0
```

## 统一优化特性

所有 v2.2 版本的组合技能都包含以下优化：

| 特性 | 说明 |
|------|------|
| **Iterator 模式** | 对每个问题事件逐个进行详细分析 |
| **大小核分析** | 分析主线程在大核/小核上的运行占比 |
| **四大象限分析** | Running(大核)/Running(小核)/Runnable/Sleeping 分布 |
| **Perfetto 跳转链接** | 每个事件包含 perfetto_start/perfetto_end 参数 |
| **增强诊断规则** | 基于 CPU 调度和线程状态的智能诊断 |

---

## 滑动性能分析 (scrolling_analysis v2.3)

### 功能特性

1. 基于 Perfetto FrameTimeline 的精确掉帧检测
2. 自动识别滑动区间
3. **逐帧详细分析**（大小核占比、四大象限）
4. AI 智能诊断总结
5. Perfetto 跳转链接支持

### 执行流程图

```
┌─────────────────────────────────────────────────────────────────────┐
│                    scrolling_analysis v2.3                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 1. detect_environment                                         │   │
│  │    检测刷新率(60/90/120Hz)、帧数据可用性                       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              ↓                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 2. get_frames_from_stdlib                                     │   │
│  │    从 android_frames 表获取所有帧数据                          │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              ↓                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 3. get_jank_frames                                            │   │
│  │    从 actual_frame_timeline_slice 获取掉帧帧                   │   │
│  │    按 jank_type 分类: App Deadline Missed, Buffer Stuffing...│   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              ↓                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 4. jank_type_stats                                            │   │
│  │    掉帧类型统计 + 责任归属(应用/SF/缓冲区/硬件)                 │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              ↓                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 5. frame_performance_summary                                  │   │
│  │    帧性能汇总：掉帧率、平均帧耗时、FPS、评级                    │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              ↓                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 6. find_scroll_sessions                                       │   │
│  │    识别滑动区间（连续帧渲染，间隔<100ms）                       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              ↓                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 7. session_jank_analysis                                      │   │
│  │    每个滑动区间的掉帧分析                                      │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              ↓                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 8. get_app_jank_frames                                        │   │
│  │    获取应用责任掉帧帧列表（含主线程/RenderThread时间区间）      │   │
│  │    包含 Perfetto 跳转参数 (perfetto_start, perfetto_end)       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              ↓                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 9. analyze_jank_frames [ITERATOR]                             │   │
│  │    遍历每个掉帧帧，调用 jank_frame_detail 进行详细分析         │   │
│  │    ┌────────────────────────────────────────────────────────┐ │   │
│  │    │           jank_frame_detail v2.1                       │ │   │
│  │    │  ┌──────────────────────────────────────────────────┐  │ │   │
│  │    │  │ frame_info         帧基本信息+Perfetto链接       │  │ │   │
│  │    │  ├──────────────────────────────────────────────────┤  │ │   │
│  │    │  │ main_thread_slices 主线程耗时操作(主线程区间)     │  │ │   │
│  │    │  ├──────────────────────────────────────────────────┤  │ │   │
│  │    │  │ binder_calls       Binder调用分析                │  │ │   │
│  │    │  ├──────────────────────────────────────────────────┤  │ │   │
│  │    │  │ render_thread_slices RenderThread耗时(渲染区间)  │  │ │   │
│  │    │  ├──────────────────────────────────────────────────┤  │ │   │
│  │    │  │ cpu_scheduling     CPU调度分析                   │  │ │   │
│  │    │  ├──────────────────────────────────────────────────┤  │ │   │
│  │    │  │ lock_contention    锁竞争分析                    │  │ │   │
│  │    │  ├──────────────────────────────────────────────────┤  │ │   │
│  │    │  │ cpu_core_analysis  大小核占比分析                │  │ │   │
│  │    │  ├──────────────────────────────────────────────────┤  │ │   │
│  │    │  │ cpu_freq_analysis  CPU频率分析                   │  │ │   │
│  │    │  ├──────────────────────────────────────────────────┤  │ │   │
│  │    │  │ quadrant_analysis  四大象限分析                  │  │ │   │
│  │    │  ├──────────────────────────────────────────────────┤  │ │   │
│  │    │  │ frame_diagnosis    帧诊断规则匹配                │  │ │   │
│  │    │  └──────────────────────────────────────────────────┘  │ │   │
│  │    └────────────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              ↓                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 10. jank_diagnosis                                            │   │
│  │     全局诊断规则匹配                                           │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              ↓                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 11. global_summary [AI]                                       │   │
│  │     AI 智能分析总结                                            │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 时间区间计算

基于 Perfetto FrameTimeline，每帧包含三个时间区间：

```
完整帧区间 (start_ts → end_ts)
├── 主线程区间 (main_start_ts → main_end_ts)
│   └── Choreographer#doFrame → traversal → draw
└── RenderThread区间 (render_start_ts → render_end_ts)
    └── syncFrameState → DrawFrames → GPU完成
```

```sql
-- 从 actual_frame_timeline_slice 获取完整帧区间
-- 从 slice 表关联主线程和 RenderThread 的具体 slice 时间
```

### 四大象限分析

针对 MainThread 和 RenderThread 分别统计：

```
┌─────────────────────────────┬─────────────────────────────┐
│     Q1: Running on Big      │    Q2: Running on Little    │
│         (大核运行)           │        (小核运行)           │
│      性能最优，理想状态       │     可能性能不足            │
├─────────────────────────────┼─────────────────────────────┤
│     Q3: Runnable            │    Q4: Sleeping/Blocked     │
│       (等待CPU调度)          │       (睡眠/阻塞)           │
│    CPU资源争抢，需要优化      │   等待其他线程或I/O         │
└─────────────────────────────┴─────────────────────────────┘
```

### 大小核判定

```
通用配置 (4+4):
  CPU 0-3: Little Core (小核)
  CPU 4-7: Big Core (大核)

2+2+4 配置:
  CPU 0-3: Little Core
  CPU 4-5: Middle Core
  CPU 6-7: Big Core
```

### 诊断规则

#### 全局诊断 (jank_diagnosis)
| 条件 | 级别 | 诊断 |
|------|------|------|
| app_jank_rate > 10% | critical | 应用掉帧率过高 |
| app_jank_rate > 5% | warning | 应用掉帧率偏高 |
| sf_jank_rate > 5% | warning | SurfaceFlinger 掉帧 |
| max_frame_ms > 100 | critical | 存在严重卡顿帧 |
| Buffer Stuffing > 5 | warning | 缓冲区堆积问题 |

#### 帧级诊断 (frame_diagnosis)
| 条件 | 级别 | 诊断 |
|------|------|------|
| Binder total_ms > 5 | warning | Binder 调用耗时过长 |
| main_slices total_ms > 10 | warning | 主线程操作耗时 |
| q3_runnable_ms > 5 | warning | 主线程 Runnable 等待 |
| big_core_pct < 30% | warning | 大核占比过低 |
| avg_freq_mhz < 1500 | warning | 大核频率偏低 |
| locks wait_ms > 2 | warning | 锁竞争等待 |
| q4_sleeping_pct > 50% | info | Sleeping 占比过高 |

### 输出数据结构

```typescript
interface ScrollingAnalysisResult {
  success: boolean;
  skillName: string;
  executionTimeMs: number;

  sections: [
    { title: "环境信息", data: [...] },
    { title: "帧数据概览", data: [...] },
    { title: "掉帧详情", data: [...] },
    { title: "掉帧类型分布", data: [...] },
    { title: "帧性能汇总", data: [...] },
    { title: "滑动区间", data: [...] },
    { title: "各区间掉帧分析", data: [...] },
    { title: "应用掉帧帧列表", data: [...] },
    { title: "掉帧帧详细分析", data: [
      {
        itemIndex: 0,
        item: {
          frame_id: 1435500,
          start_ts: "564265067900641",
          end_ts: "564265085194027",
          main_start_ts: "...",
          main_end_ts: "...",
          render_start_ts: "...",
          render_end_ts: "...",
          perfetto_start: "...",  // 用于生成 Perfetto 跳转链接
          perfetto_end: "...",
          dur_ms: 17.29,
          jank_type: "App Deadline Missed",
          ...
        },
        result: {
          displayResults: [
            { stepId: "frame_info", title: "帧详情", data: {...} },
            { stepId: "main_thread_slices", title: "主线程耗时操作", data: {...} },
            { stepId: "render_thread_slices", title: "RenderThread耗时操作", data: {...} },
            { stepId: "cpu_core_analysis", title: "大小核占比", data: {...} },
            { stepId: "quadrant_analysis", title: "四大象限", data: {...} },
            ...
          ],
          diagnostics: [
            { diagnosis: "主线程操作 'animation' 耗时 27.01ms", suggestions: [...] }
          ]
        }
      },
      // ... 更多帧
    ]},
    { title: "问题诊断", data: [...] }
  ];

  diagnostics: [...];
  summary: "...";
}
```

### 前端集成

#### Perfetto 跳转链接生成

```typescript
// 从帧数据生成 Perfetto 跳转 URL
function generatePerfettoLink(frame: JankFrame, traceUrl: string): string {
  const { perfetto_start, perfetto_end } = frame;
  return `${traceUrl}#!/?s=${perfetto_start}&e=${perfetto_end}`;
}

// 示例
const link = generatePerfettoLink(frame, 'http://localhost:10000');
// => http://localhost:10000/#!/?s=564265066900641&e=564265086194027
```

---

## API 使用

### 执行滑动分析

```bash
# 上传 trace
curl -X POST http://localhost:3000/api/traces/upload \
  -F "file=@trace.pftrace"

# 执行分析
curl -X POST http://localhost:3000/api/skills/execute/scrolling_analysis \
  -H "Content-Type: application/json" \
  -d '{
    "traceId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "package": "com.example.app"  // 可选
  }'
```

### 响应示例

```json
{
  "success": true,
  "skillName": "滑动性能分析",
  "executionTimeMs": 1093,
  "sections": [...],
  "diagnostics": [
    {
      "id": "jank_diagnosis_0",
      "severity": "warning",
      "message": "存在 Buffer Stuffing 问题",
      "suggestions": [...]
    }
  ],
  "summary": "**1 个潜在问题：**\n- 存在 Buffer Stuffing 问题\n\n**关键指标：**\n🔴 掉帧数: 512\n..."
}
```

---

## 版本历史

### scrolling_analysis (滑动分析)
- **v2.3** - 添加大小核分析、四大象限、Perfetto 跳转链接
- **v2.2** - 添加逐帧详细分析 (iterator)
- **v2.1** - 使用 FrameTimeline jank_type

### jank_frame_detail (掉帧帧详细分析)
- **v2.1** - 添加主线程/RenderThread 独立时间区间、大小核、四象限
- **v2.0** - 初始版本

### startup_analysis (启动分析)
- **v2.2** - 添加 Iterator 逐启动分析、大小核、四象限、Perfetto 跳转
- **v2.1** - 使用 Perfetto stdlib android_startups 表

### startup_detail (启动详细分析)
- **v2.0** - 初始版本，包含大小核、四象限、Binder、调度延迟

### anr_analysis (ANR 分析)
- **v2.2** - 完全重写为 v2 格式，添加 Iterator、大小核、四象限、Perfetto 跳转
- **v2.1** - 旧格式 ({{}} 变量)

### anr_detail (ANR 详细分析)
- **v2.0** - 初始版本，包含大小核、四象限、阻塞原因、唤醒链

### click_response_analysis (点击响应分析)
- **v2.2** - 添加 Iterator 逐慢事件分析、大小核、四象限、Perfetto 跳转
- **v2.1** - 使用 Perfetto stdlib android_input_events 表

### click_response_detail (点击响应详细分析)
- **v2.0** - 初始版本，包含大小核、四象限、阻塞原因

### binder_analysis (Binder 分析)
- **v2.2** - 添加 Iterator 逐慢事务分析、大小核、四象限、Perfetto 跳转
- **v2.1** - 使用 Perfetto stdlib android_binder_txns 表

### binder_detail (Binder 详细分析)
- **v2.0** - 初始版本，包含大小核、四象限、阻塞原因

---

## 闭环验证

### 检查清单

- [x] 环境检测（刷新率、帧数据可用性）
- [x] 帧数据获取（android_frames）
- [x] 掉帧检测（actual_frame_timeline_slice.jank_type）
- [x] 掉帧类型统计
- [x] 帧性能汇总（掉帧率、FPS、评级）
- [x] 滑动区间识别
- [x] 区间掉帧分析
- [x] 应用掉帧帧获取（含时间区间）
- [x] 逐帧详细分析（iterator）
  - [x] 主线程 slice 分析（使用主线程时间区间）
  - [x] RenderThread slice 分析（使用渲染时间区间）
  - [x] Binder 调用分析
  - [x] CPU 调度分析
  - [x] 锁竞争分析
  - [x] 大小核占比分析（独立时间区间）
  - [x] CPU 频率分析
  - [x] 四大象限分析（独立时间区间）
  - [x] 帧级诊断规则
- [x] 全局诊断规则
- [x] AI 总结
- [x] Perfetto 跳转链接

### 测试命令

```bash
# 重启服务器
pkill -f "tsx.*index.ts"; npm run dev &

# 上传 trace
curl -X POST http://localhost:3000/api/traces/upload \
  -F "file=@trace/app_aosp_scrolling_heavy.pftrace"

# 执行分析
curl -X POST http://localhost:3000/api/skills/execute/scrolling_analysis \
  -H "Content-Type: application/json" \
  -d '{"traceId": "xxx"}' | jq '.sections[] | {title, count: (.data | length)}'
```
