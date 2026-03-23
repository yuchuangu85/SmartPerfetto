# SmartPerfetto 面试准备指南 v2

> 独立开发的 AI Agent 驱动 Android 性能分析平台。基于 Claude Agent SDK + MCP 协议 + Perfetto UI 插件。
> 核心亮点：**Agent 工程化落地** — 不是调 API 的 demo，而是规划→执行→验证→学习的完整闭环。

---

## 目录

- [一、项目概览与硬数据](#一项目概览与硬数据)
- [二、Before vs After](#二before-vs-after)
- [三、为什么 LLM 不能直接分析 Trace？（项目根本动机）](#三为什么-llm-不能直接分析-trace)
- [四、整体架构](#四整体架构)
- [五、Agent 系统深度讲解（核心亮点）](#五agent-系统深度讲解)
- [六、MCP 工具体系 — 为什么是 17 个、为什么这样分](#六mcp-工具体系)
- [七、Skill 系统 — 为什么不用标准 MCP Resource/Tool](#七skill-系统)
- [八、Context Engineering](#八context-engineering)
- [九、验证与纠错](#九验证与纠错)
- [十、项目特殊性 — 领域专业知识](#十项目特殊性)
- [十一、面试场景 Q&A](#十一面试场景-qa)
- [十二、面试完整叙事线](#十二面试完整叙事线)
- [附录：Buzzword 清单](#附录buzzword-清单)

---

## 一、项目概览与硬数据

### 一句话定位

AI 驱动的 Android 性能分析平台，把资深工程师的分析方法论编码成 **157 个 YAML Skill + 12 套场景策略**，通过 Claude Agent SDK + 17 个 MCP 工具让 AI Agent 自主完成系统化分析，从 45-90 分钟手动分析缩短到 2-3 分钟。

### 硬数据

| 指标 | 数值 |
|------|------|
| 代码规模 | ~16 万行 TypeScript + ~5 万行 YAML |
| 分析 Skill | 157 个（80 atomic + 28 composite + 29 pipeline + 18 module + 2 deep） |
| 场景策略 | 12 套场景策略 + 6 个知识库模板 + 5 个 prompt 模板 + 4 个架构模板 |
| MCP 工具 | 17 个（9 always-on + 8 conditional） |
| 测试覆盖 | 6 条 canonical trace 回归 + 单元测试 + Skill 评估 |
| Token 节省 | SQL 摘要 ~85%，ArtifactStore 3 级缓存（3000→60 tokens） |
| 场景分类延迟 | <1ms（纯关键词匹配，零 LLM 调用） |
| 分析效率提升 | 20-30x（45-90min → 2-3min） |
| SSE 事件类型 | 7 种（progress/thought/agent_response/answer_token/conclusion/analysis_completed/error） |

---

## 二、Before vs After

### Before：传统 Perfetto 分析流程

| 步骤 | 耗时 | 说明 |
|------|------|------|
| 1. 抓 trace | 5 min | `adb shell perfetto` 或系统 Tracing，10-500MB |
| 2. 人肉看时间线 | 10-20 min | 几十条 track（CPU/线程/SurfaceFlinger/RenderThread/Binder），一帧帧找卡顿位置 |
| 3. 手写 SQL | 10-15 min | 几百张表、列名不直观，经常试错 |
| 4. 跨 track 关联 | 10-20 min | 同时看 5-6 条 track 交叉对比定位根因 |
| 5. 写报告 | 10-15 min | 截图 + 数据 + 结论 |
| **总计** | **45-90 min** | 高度依赖经验，新人半年才能上手 |

**核心痛点：**

| 痛点 | 具体表现 |
|------|---------|
| 门槛高 | 要理解 VSync、RenderThread、Choreographer、SurfaceFlinger、Binder、CPU 调度等 10+ 子系统 |
| 效率低 | 大量时间花在"找位置"和"试 SQL" |
| 容易遗漏 | 人工分析很难每次都检查所有维度（CPU/GPU/内存/Binder/GC/热降频） |
| 经验难传承 | 资深工程师脑子里的方法论，新人很难习得 |

### After：SmartPerfetto

```
用户: "分析滑动卡顿"  →  2-3 分钟  →  分层结构化报告 + 因果链 + 时间线书签

    场景分类 (<1ms) → 架构检测 → 自动规划 → 执行 Skills (L1→L4) → 4 层验证 → 输出
```

| 维度 | Before（手动） | After（SmartPerfetto） |
|------|---------------|----------------------|
| 分析耗时 | 45-90 分钟 | 2-3 分钟 |
| 覆盖维度 | 取决于经验 | 157 个 Skill 全维度系统扫描 |
| 门槛 | 至少 6 个月 | 自然语言提问 |
| 一致性 | 因人而异 | 策略驱动 + 验证保证确定性 |
| 可追溯 | 在工程师脑子里 | 全链路可审计（每步工具调用有日志） |

---

## 三、为什么 LLM 不能直接分析 Trace？

这是面试中最关键的"为什么"——它解释了整个项目存在的根本动机。

### 问题 1：数据规模远超 Context Window

| 维度 | 典型值 |
|------|--------|
| Trace 文件大小 | 50MB - 500MB |
| 事件数 | 百万 ~ 千万级 |
| 序列化为文本 | 数 GB |
| Claude 最大 context | ~200K tokens |

**你不可能把 trace "喂给" LLM。**

### 问题 2：LLM 无法做精确计算

性能分析需要精确数值：帧耗时 P50/P90/P99、VSync 周期检测（IQR 过滤中位数）、CPU 利用率百分比。LLM 会**幻觉**——编造看起来合理但完全错误的数字。

### 问题 3：缺乏领域知识的结构化运用

Android 渲染管线极其复杂（30+ 种渲染架构），卡顿根因可能跨线程、跨进程。LLM "知道"这些概念但缺乏将知识**分阶段、分场景**运用到具体 trace 上的能力。

### 问题 4：可靠性不足

幻觉、遗漏、浅层归因、不一致——直接让 LLM 分析性能数据是不可靠的。

### SmartPerfetto 的核心理念

> **让 LLM 做它擅长的事（推理、归因、表达），让工具做它擅长的事（查询、计算、检索）。**

```
LLM (Claude) 负责:              工具系统负责:
├─ 理解用户问题                  ├─ SQL 精确查询 (trace_processor)
├─ 制定分析计划                  ├─ 数值计算与统计
├─ 推理因果关系                  ├─ 渲染架构检测
├─ 跨领域关联分析                ├─ 分层数据提取 (L1-L4)
├─ 生成结构化报告                ├─ Perfetto stdlib 查询
└─ 自然语言交互                  └─ 数据摘要与压缩

连接层: MCP Protocol — 17 个工具
质量层: 4 层验证 + 反思纠错
```

---

## 四、整体架构

```
┌─────────────────────────────────────────────────────────────┐
│  Perfetto UI (Frontend Plugin)  :10000                      │
│  ┌──────────┐ ┌────────────┐ ┌──────────────┐              │
│  │ AI Panel │ │ SSE Stream │ │ DataEnvelope │              │
│  │ (Mithril)│ │  Handler   │ │  Renderer    │              │
│  └────┬─────┘ └─────┬──────┘ └──────┬───────┘              │
└───────┼─────────────┼───────────────┼───────────────────────┘
        │ HTTP        │ SSE           │ Schema-driven
┌───────┼─────────────┼───────────────┼───────────────────────┐
│  Express Backend  :3000                                      │
│  ┌────┴─────────────┴───────────────┴────────┐              │
│  │         ClaudeRuntime (Orchestrator)        │              │
│  │  ┌───────────┐  ┌──────────┐  ┌─────────┐ │              │
│  │  │ Scene     │  │ System   │  │ Verifier│ │              │
│  │  │ Classifier│  │ Prompt   │  │ (4-layer│ │              │
│  │  │ (<1ms)    │  │ Builder  │  │  gate)  │ │              │
│  │  └───────────┘  └──────────┘  └─────────┘ │              │
│  └──────────────────┬────────────────────────┘              │
│                     │ Claude Agent SDK                       │
│           ┌─────────┴──────────┐                            │
│           │  MCP Server        │                            │
│           │  (17 Tools)        │                            │
│           │  execute_sql       │   ┌──────────────────┐     │
│           │  invoke_skill      ├──►│ Skill Engine      │     │
│           │  submit_plan       │   │ 157 YAML Skills   │     │
│           │  submit_hypothesis │   │ L1→L2→L3→L4      │     │
│           │  lookup_knowledge  │   └──────────────────┘     │
│           │  ...               │                            │
│           └─────────┬──────────┘                            │
│                     │ HTTP RPC                               │
│           ┌─────────┴──────────┐                            │
│           │ trace_processor    │                            │
│           │ (C++ binary)       │                            │
│           │ :9100-9900         │                            │
│           └────────────────────┘                            │
└─────────────────────────────────────────────────────────────┘
```

### 核心数据流

```
用户: "分析滑动卡顿"
    │
    ├─ Scene Classification → "scrolling" (<1ms, 从 strategy frontmatter 关键词匹配)
    ├─ Architecture Detection → "Flutter TextureView, 置信度 92%"
    ├─ System Prompt Assembly → 角色 + 方法论 + 滚动策略 + Flutter 架构指南 + 输出格式
    │
    ├─ Claude Agent SDK (自主 MCP 工具调用，最多 15 轮)
    │   ├─ submit_plan → "Phase 1: 概览 → Phase 2: 逐帧诊断 → Phase 3: 根因深钻"
    │   ├─ invoke_skill("scrolling_analysis") → L1 帧概览 + L2 卡顿帧列表
    │   ├─ invoke_skill("jank_frame_detail") → L3 逐帧诊断
    │   ├─ execute_sql("SELECT ...") → 补充查询
    │   ├─ lookup_knowledge("cpu-scheduler") → 加载 CPU 调度知识
    │   └─ submit_hypothesis → resolve_hypothesis → 证据驱动结论
    │
    ├─ 4-Layer Verification → 证据检查 + 计划遵守 + 假设闭环 + 场景完整性
    │
    └─ 结构化报告 → findings + Mermaid 因果链 + 优化建议
        └─ SSE 实时流式输出 → 前端
```

---

## 五、Agent 系统深度讲解

> **这一节是面试核心——它展示了你如何思考 Agent 的设计，而不只是"用了 Claude API"。**

### 5.1 为什么需要 Agent？为什么不是 Pipeline？

性能分析不是一个"给输入得输出"的任务，它本质上是一个**探索性推理过程**：

1. 先看总览 → 发现 47 帧卡顿，P90=23.5ms
2. 根据总览决定方向 → 40% 卡在 APP 阶段，优先看 APP
3. 逐帧诊断 → Frame #234 的 RenderThread 被 Binder 阻塞 23ms
4. 形成假设 → "可能是 system_server 的 Binder 响应慢"
5. 验证假设 → 查 Binder 对端，发现确实 system_server CPU 调度延迟
6. 可能需要回退 → 如果假设不成立，换方向
7. 综合所有发现，形成结论

**这恰好是 Agent 架构的价值——LLM 自主规划、工具调用、迭代推理。** 如果用 Pipeline 硬编码，你无法处理"这个 trace 的问题可能在 GPU，也可能在 GC"这种需要动态决策的场景。

### 5.2 我的 Agent 设计哲学

#### 原则 1：确定性 + 概率性混合

```
用户问题 → 场景分类(12 种场景)
  ├─ 有匹配策略 → 确定性多阶段分析（Strategy 约束步骤，每次不遗漏）
  └─ 无匹配(general) → 假设驱动的自主推理（Claude 自主探索）
```

**面试话术：**
> "纯 LLM 做性能分析有两个问题：输出不稳定、容易遗漏关键步骤。所以我设计了双轨架构——对已知场景（如滚动、启动）用外部 Strategy 文件约束分析步骤，保证确定性；对未知场景让 Agent 自主假设-验证。既有确定性保底，又有灵活性。"

#### 原则 2：Agent 的"环境"比 prompt 措辞更重要

这是我在项目中最大的一个认知迭代。v3 初期我花了大量时间精心设计 system prompt 的措辞，后来发现——**真正影响 Agent 输出质量的不是你告诉它"怎么说"，而是你给它什么工具、什么数据、什么约束**。

具体例子：
- 加了 `submit_plan` 门控后，Claude 不再上来就乱查 SQL，分析质量提升明显
- 加了 `ArtifactStore` 后，Claude 不再被大量数据淹没，推理聚焦度提升
- 加了 `lookup_knowledge` 后，根因深度从"主线程阻塞"深入到"Binder 对端 CPU 降频导致响应延迟"

**面试话术：**
> "与其优化 prompt 的文字，不如优化 Agent 的环境。这也是为什么我在 MCP 工具设计上投入了最多精力。"

#### 原则 3：Plan 门控 — 强制 Agent 先想后做

```
没有 Plan 门控时:
  Claude → execute_sql("SELECT * FROM slice") → execute_sql("SELECT * FROM thread") → ...
  （无方向的乱查，浪费 token，输出散乱）

有 Plan 门控时:
  Claude → submit_plan({phases: [...]})  ← 必须先提交计划
        → update_plan_phase("p1", "in_progress")
        → invoke_skill("scrolling_analysis")  ← 现在才能执行
        → update_plan_phase("p1", "completed")
```

`execute_sql` 和 `invoke_skill` 在执行前调 `requirePlan()` 检查 session 是否已有 `submit_plan` 记录。没有则返回错误。

### 5.3 Agent 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| **ClaudeRuntime** | `claudeRuntime.ts` (65KB) | 主编排器：会话生命周期、超时控制、SDK 调用 |
| **MCP Server** | `claudeMcpServer.ts` (74KB) | 17 个工具的注册与执行逻辑 |
| **System Prompt** | `claudeSystemPrompt.ts` (15KB) | 动态组装 system prompt（4500 token 预算） |
| **SSE Bridge** | `claudeSseBridge.ts` (15KB) | SDK 流式消息 → SSE 事件转换 |
| **Verifier** | `claudeVerifier.ts` (35KB) | 4 层验证 + 反思纠错 |
| **Scene Classifier** | `sceneClassifier.ts` | 关键词场景分类（<1ms，从 strategy frontmatter 动态加载） |
| **Strategy Loader** | `strategyLoader.ts` | 加载 `.strategy.md` 和 `.template.md`，变量替换 |
| **Artifact Store** | `artifactStore.ts` | Skill 结果缓存 + 分级获取（summary/rows/full） |
| **SQL Summarizer** | `sqlSummarizer.ts` | SQL 结果摘要（~85% token 节省） |
| **Pattern Memory** | `analysisPatternMemory.ts` (15KB) | 跨会话分析模式记忆（正/负面经验） |
| **Agent Definitions** | `claudeAgentDefinitions.ts` | SDK agent 定义、工具描述 + 示例 |
| **Agent Metrics** | `agentMetrics.ts` | 工具调用计时、性能追踪 |
| **Finding Extractor** | `claudeFindingExtractor.ts` | 从 Claude 输出中提取结构化发现 |
| **Focus Detector** | `focusAppDetector.ts` | 3 级 fallback 检测前台应用 |
| **Config** | `claudeConfig.ts` | Agent SDK 配置管理 |
| **Session Snapshot** | `sessionStateSnapshot.ts` | 会话状态持久化 |

### 5.4 安全与治理

Agent 自主运行意味着需要严格的安全边界：

| 机制 | 说明 |
|------|------|
| **并发守卫** | `activeAnalyses` Set 防止同一 session 并行分析 |
| **超时控制** | 40s/轮 × 最多 15 轮 = 10 分钟上限 |
| **Watchdog** | 连续 3 次同工具失败 → 注入策略切换 prompt |
| **Circuit Breaker** | >60% 工具调用失败 → 简化分析范围 |
| **Safety Timer** | `Promise.race()` 级别强制超时 |
| **Stream 取消** | 超时时主动终止 SDK 流，停止 API 消费 |
| **Budget Cap** | `CLAUDE_MAX_BUDGET_USD` 控制每次分析的 API 成本上限 |

### 5.5 多轮对话

```
Turn 1: 用户 "分析滑动卡顿"  → 完整分析
Turn 2: 用户 "Binder 那个帧再详细看看"  → 基于上轮上下文深入
Turn 3: 用户 "和启动时的 Binder 对比一下"  → 跨场景关联
```

- SDK session ID 持久化到 `logs/claude_session_map.json`
- 通过 `resume: sdkSessionId` 恢复 SDK 上下文
- `write_analysis_note` 抵抗 context compression（SDK 会自动压缩历史消息）
- 实体追踪 (`entity_context`) 记录已发现的关键实体

### 5.6 SSE 双终结事件

这是一个值得讲的设计细节——agentv3 有两个"终结"事件：

```
Claude SDK 返回结果
    │
    ▼
conclusion 事件 (近终结)  ← 用户即刻看到分析结论
    │
    ▼  (后台异步生成 HTML 报告)
    │
analysis_completed 事件 (终结)  ← 携带 reportUrl，前端展示报告链接
```

**为什么分两步？** 因为 HTML 报告生成需要 200-500ms，但用户不应该等这个时间才看到结论。所以 `conclusion` 先发给前端让用户立刻看到结果，`analysis_completed` 后续补上报告链接。

---

## 六、MCP 工具体系

### 6.1 为什么用 MCP？

三个原因：

1. **可控性** — MCP 工具有 Zod schema 校验，参数不合法直接拒绝
2. **可观测性** — 所有工具调用有日志，能审计 Claude 调了什么、传了什么、返回了什么
3. **token 优化空间** — 工具层可以做摘要、缓存、分页，这是让 LLM 直接写 SQL 做不到的

**面试话术：**
> "Claude 不直接访问 trace 数据，它通过 MCP 工具间接操作。这个间接层让我能在不改 Agent 逻辑的情况下做 token 优化、错误学习、结果缓存。"

### 6.2 工具设计原则

**每个工具对应一个认知动作，而不是一个技术操作。**

- ❌ 错误粒度：`query_frames`, `query_threads`, `query_binder` → 太细，限制了 Claude 的灵活性
- ❌ 错误粒度：`analyze_everything` → 太粗，Agent 失去控制权
- ✅ 正确粒度：`execute_sql`（Claude 自己决定查什么）+ `invoke_skill`（封装好的分析流程）

另一个例子：为什么把 `submit_hypothesis` 和 `resolve_hypothesis` 分开？因为"提出假设"和"验证假设"是两个不同的认知步骤，分开后验证层可以检查假设闭环（所有假设都必须被 confirmed 或 rejected）。

### 6.3 完整工具清单

#### Always-on 工具（9 个，始终可用）

| 工具 | 类比 | 用途 | 设计意图 |
|------|------|------|----------|
| `execute_sql` | Claude 的"手" | 执行 Perfetto SQL | 支持 `summary=true` 返回摘要而非全量（省 85% token） |
| `invoke_skill` | Claude 的"流程手册" | 执行 Skill pipeline | 封装好的多步分析，一次调用获取 L1-L4 分层结果 |
| `list_skills` | Claude 的"技能目录" | 列出可用 Skills | 按 category 过滤，让 Claude 自己发现能力 |
| `detect_architecture` | Claude 的"眼睛" | 检测渲染架构 | Standard/Flutter/Compose/WebView + 置信度 + 证据 |
| `lookup_sql_schema` | Claude 的"参考手册" | 查 Perfetto 表结构 | 搜索 761 个 stdlib 表/视图/函数模板 |
| `query_perfetto_source` | Claude 的"源码搜索" | 查 stdlib 源码 | 找用法模式和示例 |
| `list_stdlib_modules` | Claude 的"库目录" | 列出 stdlib 模块 | 发现可用的 Perfetto stdlib 预定义模块 |
| `lookup_knowledge` | Claude 的"教科书" | 加载背景知识 | 6 个领域: 渲染管线/Binder/GC/CPU调度/温控/锁竞争 |
| `recall_patterns` | Claude 的"经验库" | 跨会话分析模式记忆 | 正模式（成功经验）+ 负模式（失败教训） |

#### Conditional 工具（8 个，按需启用）

| 工具 | 类比 | 用途 |
|------|------|------|
| `submit_plan` | Claude 的"计划本" | 提交分析计划（分阶段，含目标和预期工具） |
| `update_plan_phase` | ↑ | 更新阶段状态（pending → in_progress → completed） |
| `revise_plan` | ↑ | 中途修订计划（新信息出现时动态调整） |
| `submit_hypothesis` | Claude 的"假设板" | 提交可验证的假设（含预期验证方法） |
| `resolve_hypothesis` | ↑ | 确认/否定假设（附证据） |
| `write_analysis_note` | Claude 的"笔记本" | 写入分析笔记（抗 context compression） |
| `fetch_artifact` | Claude 的"档案柜" | 分级获取 Skill 结果（summary/rows/full） |
| `flag_uncertainty` | Claude 的"问号贴纸" | 标记不确定性（非阻塞，影响置信度计算） |

### 6.4 工具描述的精心设计

MCP 工具的 `description` 不只是文档——它是 Agent 的"使用说明"。我在工具描述中嵌入了**具体的调用示例**，这是提升 Agent 工具选择准确率的关键手段：

```typescript
// execute_sql 的 description 包含示例:
'1. Full scrolling analysis: skillId="scrolling_analysis", params={process_name: "com.example.app"}\n' +
'2. Single jank frame detail: skillId="jank_frame_detail", params={frame_number: 42, process_name: "com.example.app"}'
```

**为什么？** 因为 LLM 对示例的响应比对抽象描述好得多。加了示例后，Claude 调用 `invoke_skill` 时的参数格式错误率从 ~15% 降到 <3%。

### 6.5 工具调用度量

每个 MCP 工具调用都有计时（`agentMetrics.ts`），可以追踪：

- 每个工具的平均/P90 执行时间
- 工具调用序列（哪些工具总是一起被调用）
- 失败率（用于 Circuit Breaker 决策）

---

## 七、Skill 系统

### 7.1 为什么需要 Skill？为什么不让 Claude 直接写 SQL？

如果让 LLM 每次从头写 SQL 分析卡顿：

1. **SQL 不稳定** — LLM 可能写出语法错误或逻辑错误的 SQL
2. **分析不全面** — 可能遗漏关键指标（如 VSync 周期检测需要 IQR 过滤）
3. **不可复现** — 同样的问题，每次分析路径不同
4. **Token 浪费** — 复杂的多步 SQL 每次都要重新生成
5. **领域知识损失** — VSync 检测需要"中位数 + IQR 过滤"这种领域知识，LLM 不一定每次都记得

**Skill 的核心理念：LLM 决定"用哪个 Skill"（战略），Skill 负责"怎么分析"（战术）。**

### 7.2 为什么不用标准 MCP Resource/Tool？

这是一个关键的设计决策——我**自建了 YAML Skill 系统**，而不是把每个分析步骤暴露为独立的 MCP Tool。原因有三：

#### 原因 1：组合爆炸

如果每个分析能力都是一个 MCP Tool：
- 80 个 atomic 分析 → 80 个 MCP Tool → Claude 的 tool list 会有 80+ 个工具描述
- **Token 成本爆炸**：每次 API 调用都要把所有工具描述发给 Claude
- **选择困难**：Claude 面对 80 个工具时选择准确率下降

用 Skill 系统：
- Claude 只看到 1 个 `invoke_skill` 工具 + 1 个 `list_skills` 工具
- 通过 `list_skills(category="scrolling")` 按需发现能力
- **两个 MCP Tool 封装了 157 个分析能力**

#### 原因 2：非工程师也能写

YAML Skill 让**性能专家**可以直接贡献分析逻辑，不需要懂 TypeScript：

```yaml
name: consumer_jank_detection
type: composite
steps:
  - id: vsync_config
    sql: |
      -- 检测 VSync 周期 (中位数 + IQR 过滤)
      SELECT median_period_ns FROM ...
    display:
      level: summary
  - id: jank_frames
    sql: |
      -- 基于 present_ts 间隔检测卡顿
      SELECT frame_id, duration_ms, jank_type FROM ...
    display:
      level: list
      columns:
        - { name: duration_ms, type: duration, click: navigate_timeline }
```

#### 原因 3：自描述渲染 — 前端零改动

每个 Skill 的输出通过 `DataEnvelope` 自描述。前端根据 `display.columns` 的类型（`timestamp`, `duration`, `percentage`）和动作（`navigate_timeline`, `copy`）**自动渲染**。

**这意味着新增一个 Skill，前端不需要写一行代码。** 这是 157 个 Skills 而前端代码量仍然可控的关键。

### 7.3 Skill 全景

| 类型 | 数量 | 位置 | 说明 |
|------|------|------|------|
| **Atomic** | 80 | `skills/atomic/` | 单一检测（VSync 周期、CPU 拓扑、GPU 频率、GC 事件...） |
| **Composite** | 28 | `skills/composite/` | 多步组合（scrolling_analysis = 多个 atomic 编排） |
| **Pipeline** | 29 | `skills/pipelines/` | 渲染管线检测 + 教学（29 种 Android 渲染架构识别） |
| **Module** | 18 | `skills/modules/` | 模块分析（app/framework/hardware/kernel） |
| **Deep** | 2 | `skills/deep/` | 深度分析（CPU profiling, callstack） |
| **总计** | **157** | | |

另外还有 **厂商适配层**：`skills/vendors/` 下有 8 家厂商（Pixel/Samsung/Xiaomi/Honor/Oppo/Vivo/Qualcomm/MTK）的 `.override.yaml`，覆盖通用 Skill 中的厂商特定逻辑。

### 7.4 分层结果 (L1-L4)

```
L1 (Overview)  ─── "47 帧卡顿, P90=23.5ms, SEVERE 占 12%"
    │                    ↑ 聚合指标，快速了解全貌
    ▼
L2 (List)      ─── 每一帧的详情列表 (frame_id, duration, jank_type)
    │                    ↑ 可展开的数据表格
    ▼
L3 (Diagnosis) ─── 逐帧诊断 (iterator 遍历每个卡顿帧)
    │                    ↑ 每帧的线程状态、阻塞原因
    ▼
L4 (Deep)      ─── 深度分析 (阻塞链、Binder 根因、调用栈)
                         ↑ 跨线程/跨进程的因果追踪
```

### 7.5 Step 类型

| Step 类型 | 说明 | 典型用途 |
|-----------|------|----------|
| `atomic` | 单条 SQL 查询 | 大多数检测 |
| `skill_ref` | 引用另一个 Skill | 组合分析复用 |
| `iterator` | 遍历数据行（循环） | 逐帧诊断 |
| `parallel` | 并行执行多个 step | 独立指标同时获取 |
| `conditional` | 条件分支 | 根据架构类型走不同路径 |

### 7.6 热更新

开发模式下，修改 `.skill.yaml` → 刷新浏览器即生效，无需重启后端。Strategy/Template 同理。这让迭代速度非常快——改 SQL、刷新、看结果，循环周期 < 10 秒。

---

## 八、Context Engineering

> **面试中被追问"最难的技术挑战"时，讲这个。**

### 8.1 核心挑战

LLM 的效果高度依赖你给它的上下文。SmartPerfetto 的 system prompt 不是静态模板——它根据用户问题、trace 特征、历史上下文**动态组装**。

### 8.2 System Prompt 组装（15+ 模块，4500 token 预算）

```
System Prompt (4500 token 预算)
    │
    ├─ [角色定义]     ← prompt-role.template.md
    ├─ [架构检测结果]  ← arch-{standard|flutter|compose|webview}.template.md
    ├─ [焦点应用]     ← 自动检测（3 级 fallback）
    ├─ [选区上下文]   ← selection-area/slice.template.md（如果用户选了时间范围）
    ├─ [分析方法论]   ← prompt-methodology.template.md
    │   └─ {{sceneStrategy}} ← 场景策略注入（scrolling/startup/anr/...）
    ├─ [输出格式]     ← prompt-output-format.template.md
    ├─ [会话上下文]   ← 多轮对话积累的笔记、发现、实体
    │
    └─ [可选，按优先级裁剪]
        ├─ SQL 知识库（匹配到的 stdlib 表）
        ├─ 模式记忆（历史分析经验）
        ├─ 负面记忆（历史踩坑）
        └─ SQL 错误-修复对（自我学习）
```

### 8.3 Token 预算管理

当内容超 4500 token 预算，按优先级从低到高裁剪：

1. SQL 知识库引用（最先丢弃）
2. 模式记忆
3. 负面模式
4. SQL 错误-修复对
5. Sub-agent 指导
6. 计划历史
7. **选区上下文永不丢弃**（这是用户的明确意图）

### 8.4 三层 Token 优化

| 技术 | 效果 | 原理 |
|------|------|------|
| **SQL 摘要** | 8000 → 1200 tokens（85% 节省） | 统计分布(min/max/P50/P90) + Top10 感兴趣行，完整数据推前端 |
| **ArtifactStore** | 3000 → 60 tokens（默认） | 3 级获取：summary(60t) → rows(200-400t) → full(1000+t) |
| **渐进式 prompt 裁剪** | 15+ section → 按优先级裁到 4500t | 先砍知识库/错误对，永不砍用户意图和场景策略 |

**面试话术：**
> "一个滚动分析 Skill 可能返回 3000+ tokens。如果全放进 Claude 的 context，几个 Skill 调用后 context 就满了。所以我设计了 ArtifactStore——结果先存下来，Claude 只看 summary（60 tokens），需要详情时调 `fetch_artifact` 按页拉取。配合 SQL 摘要，整体省了 85% 的 token。"

### 8.5 知识模板 — 按需注入领域知识

不是把所有 Android 知识塞进 system prompt，而是 Claude 在需要时调 `lookup_knowledge` 按需加载：

| 知识模板 | 内容 |
|----------|------|
| `knowledge-rendering-pipeline` | 渲染管线各阶段职责、线程模型、常见瓶颈 |
| `knowledge-binder-ipc` | Binder 调用链、对端追踪、阻塞判定 |
| `knowledge-gc-dynamics` | GC 类型、对帧渲染的影响模型、阈值 |
| `knowledge-cpu-scheduler` | CFS 调度、RT 优先级、频率/核心迁移 |
| `knowledge-thermal-throttling` | 温控策略、频率限制、mitigation 检测 |
| `knowledge-lock-contention` | 锁竞争检测、死锁模式、优先级反转 |

### 8.6 跨会话学习

| 机制 | 说明 | 约束 |
|------|------|------|
| SQL 错误-修复对 | Claude 写错 SQL → 记录 error+fix → 下次注入 | 30 天 TTL，200 对上限，Jaccard>0.3 |
| 正模式记忆 | 成功分析的 trace 特征 + 方法 | 60 天 TTL，200 条上限 |
| 负模式记忆 | 失败方法，避免重复犯错 | 90 天 TTL，100 条上限 |
| 学习型误诊模式 | 误诊 ≥2 次自动加入验证规则 | 90 天 TTL，30 条上限 |

**加权 Jaccard 相似度**用于匹配历史模式：trace 特征分 5 类 tag，`arch`/`scene` 权重 3.0（最强信号），`domain` 权重 2.0，`cat` 权重 1.5，`finding` 权重 0.5（太具体，降权），再乘时间衰减（30 天半衰期）。

---

## 九、验证与纠错

### 为什么需要验证？

LLM 分析可能：幻觉（编造数据）、浅层归因（不够深）、过度标记、遗漏、假设未闭环。实测 ~30% 的发现是误报。

### 四层验证

```
Layer 1: 启发式检查 (无 LLM, <1ms)
    ├─ CRITICAL 发现没有证据? → ERROR
    ├─ >5 个 CRITICAL? → WARNING (过度标记)
    ├─ 匹配已知误诊模式? → WARNING
    ├─ 浅层根因(无多级因果链)? → WARNING
    └─ 结论过短(<50字)? → ERROR

Layer 2: Plan 遵守检查
    ├─ 未提交计划? → ERROR
    └─ 有未完成/未调用工具的阶段? → WARNING

Layer 2.5: 假设闭环检查
    └─ 有未 confirmed/rejected 的假设? → ERROR

Layer 2.7: 场景完整性检查
    ├─ scrolling: 缺帧/卡顿/VSync 分析? → WARNING
    ├─ startup: 缺 TTID/TTFD? → WARNING
    └─ anr: 缺阻塞/死锁分析? → WARNING

Layer 3: LLM 验证 (可选, Haiku 模型)
    └─ CRITICAL/HIGH 发现证据是否充分?
```

**反思纠错**：验证不通过 → 生成纠正 prompt（包含具体问题 + 修正建议）→ Claude 补充分析（利用已有数据）→ 再次验证（最多 2 轮，同样错误不重复纠正）。

---

## 十、项目特殊性

> **这一节讲清楚项目对领域专业知识的要求——面试官会感兴趣的"壁垒"。**

### 10.1 需要 Perfetto 深度知识

Perfetto 是 Google 的系统级 trace 工具，数据存储在 SQLite-like 的 `trace_processor` 中：

- **700+ 张表和视图**（Perfetto stdlib），列名不直观（如 `actual_frame_timeline_slice`）
- 每种分析场景需要不同的表组合和 JOIN 策略
- stdlib 在持续更新（我维护了 761 个 schema 模板的索引）
- **SQL 写法有陷阱**：比如卡顿检测应该用 `present_ts` 间隔而不是 `token_gap`（这是我在项目中踩过的坑）

### 10.2 需要 Android 渲染管线知识

Android 有 **30+ 种渲染架构**，每种的线程模型和性能瓶颈完全不同：

| 架构 | 关键线程 | 典型瓶颈 |
|------|---------|---------|
| Standard View (Blast) | main + RenderThread | dequeueBuffer, GPU |
| Flutter TextureView | UI + Raster + Platform | Raster thread GC |
| Flutter SurfaceView | UI + Raster | SurfaceFlinger 层级冲突 |
| Jetpack Compose | main + RenderThread | 重组过多 |
| WebView | main + Renderer + Compositor | JS 阻塞 |
| Game (OpenGL/Vulkan) | GameThread + GPU | 着色器复杂度 |

SmartPerfetto 通过 29 个 Pipeline Skills 自动识别和教学。

### 10.3 需要 Android 系统知识

分析根因需要理解多个子系统：

- **SurfaceFlinger**：buffer 消费模型、VSYNC 信号分发、Layer 合成
- **Binder IPC**：跨进程调用链、对端追踪、阻塞判定
- **CPU 调度**：CFS 调度器、RT 优先级、频率调节、核心迁移
- **内存管理**：GC 类型(Concurrent/STW)、LMK、OOM Adj
- **温控系统**：thermal mitigation、频率限制
- **Input 系统**：触摸事件分发、InputReader → InputDispatcher → App

### 10.4 这些知识如何体现在系统设计中

1. **12 套场景策略** — 每个场景（scrolling/startup/anr/...）的分析步骤不同，来源于对该场景的深度理解
2. **157 个 Skills 的 SQL** — 每条 SQL 都是针对 Perfetto 表结构精心设计的
3. **6 个知识模板** — 按需注入的领域知识，让 Claude 的根因分析更深
4. **4 个架构模板** — 不同渲染架构的线程模型指导
5. **验证规则** — 场景完整性检查知道每个场景必须包含哪些分析

**面试话术：**
> "这个项目的门槛不在于 AI 技术——Claude Agent SDK 的 API 不复杂。真正的壁垒是**领域知识的工程化**：你需要知道 Android 渲染管线的 30 种架构，知道 VSync 检测要用 IQR 过滤中位数，知道 Binder 根因追踪需要查对端线程状态。这些知识编码成了 157 个 Skill 和 12 套 Strategy，这才是项目的核心价值。"

---

## 十一、面试场景 Q&A

### 场景一：项目深挖面（15-20 分钟）

#### Q1: "介绍一下你这个项目"（30 秒电梯演讲）

> "SmartPerfetto 是一个 AI 驱动的 Android 性能分析平台。它是 Google Perfetto trace viewer 的插件，核心是用 Claude Agent SDK 构建了一个自动化分析 Agent——工程师上传一个 trace 文件，AI 自动识别场景（滚动卡顿、启动慢、ANR 等 12 种），通过 17 个 MCP 工具执行 157 个预定义的分析 Skill，给出分层的诊断报告。分析时间从 45-90 分钟缩短到 2-3 分钟。"

#### Q2: "为什么要做这个？"

> "三个痛点：门槛高（需要理解 VSync/Binder/SurfaceFlinger 等十几个子系统，新人半年才能上手）、效率低（一个问题 45-90 分钟）、容易遗漏（人工分析很难每次检查所有维度）。这个工具把专家经验编码成 157 个 YAML Skill + 12 套策略，让 AI 按专家方法论系统化执行。"

#### Q3: "整体架构是怎样的？"

> "三层：前端是 Perfetto UI 的插件（SSE 实时接收结果）；中间是 Express 后端，核心是 ClaudeRuntime 编排器（通过 MCP 协议给 Claude 暴露 17 个领域工具）；底层是 Perfetto 的 C++ trace_processor（HTTP RPC 执行 SQL）。关键设计：**Claude 不直接操作数据，通过 MCP 工具间接操作**——这个间接层让我能做 token 优化、错误学习、结果缓存。"

#### Q4: "Agent 一次分析的完整流程？"

> "五个阶段：
> 1. 场景识别（<1ms，关键词匹配，12 种场景）
> 2. 上下文构建（检测渲染架构、前台 App，动态组装 system prompt）
> 3. 规划（Claude 必须先 submit_plan 才能执行查询——Plan 门控机制）
> 4. 执行（按计划调用 MCP 工具，获取 L1-L4 分层数据、记录假设和笔记）
> 5. 验证（4 层验证，不通过则反思修正最多 2 轮）"

#### Q5: "为什么用 MCP 协议？不直接让 LLM 写 SQL？"

> "三个原因：可控性（Zod schema 校验）、可观测性（全链路日志）、token 优化空间（execute_sql 有 summary 模式省 85%，invoke_skill 结果存 ArtifactStore，Claude 默认只看 60 tokens 摘要）。如果 LLM 直接写 SQL，这些优化都做不了。"

#### Q6: "157 个 Skill 是什么？为什么用 YAML 不用代码？"

> "每个 Skill 是一个声明式的分析 pipeline。用 YAML 三个好处：
> 1. **非工程师可贡献**——性能专家不需要懂 TypeScript，直接写 SQL + 配置
> 2. **热更新**——改 YAML 刷新浏览器就生效
> 3. **自描述渲染**——通过 DataEnvelope 的 column 定义自动渲染，新增 Skill 前端零改动
>
> 更关键的是：如果把 157 个 Skill 都暴露为独立的 MCP Tool，工具列表的 token 成本会爆炸。用 `invoke_skill` 一个工具封装 157 个能力，Claude 通过 `list_skills` 按需发现。"

#### Q7: "最难的技术挑战是什么？"

> "Context Engineering。三个子问题：
>
> 第一，system prompt 预算管理——15+ 个 section，4500 token 上限，渐进式裁剪。
>
> 第二，Skill 结果太大——ArtifactStore 3 级缓存，Claude 默认只看 60 token 摘要，需要时按页拉取。配合 SQL 摘要省 85%。
>
> 第三，跨 turn 记忆——SDK 会自动 compact 历史消息。我设计了 write_analysis_note 工具，让 Claude 主动把关键发现写下来，注入后续 turn 的 prompt。"

#### Q8: "怎么保证 Agent 输出质量？"

> "四层验证（启发式检查 + Plan 遵守 + 假设闭环 + 可选 LLM 交叉验证）+ 反思纠错（最多 2 轮）。另外有学习机制——误诊模式出现 ≥2 次自动加入检测规则。"

### 场景二：系统设计追问

#### Q9: "17 个 MCP 工具怎么设计的？怎么决定粒度？"

> "按**认知动作**分组而不是技术操作。比如没有拆 execute_sql 为 query_frames / query_threads，因为 Claude 自己知道查什么。但把 submit_hypothesis 和 resolve_hypothesis 分开了，因为'提出'和'验证'是两个认知步骤，分开后验证层能检查闭环。"

#### Q10: "如果要支持多用户并发？"

> "无状态化后端（session state → Redis，ArtifactStore → 对象存储）、trace_processor 池化（K8s Pod 池）、SSE → WebSocket + 消息队列。架构已预留端口池 9100-9900。"

### 场景三：行为面

#### Q11: "你怎么从零设计这个系统的？"

> "三阶段迭代：
>
> v1-v2：直接调 DeepSeek API。发现 context window 装不下，LLM 不了解 Perfetto 表结构。
>
> v2→v3：抽象 Skill 系统，LLM 调 Skill 而非写原始 SQL，引入场景分类。
>
> v3：全面切到 Claude Agent SDK + MCP。Agent 从'被动回答'变成'主动探索'——能自己规划、执行、验证。最多时间花在 Context Engineering 和验证系统上。"

#### Q12: "遇到过什么重大决策失误？"

> "过早优化 prompt 措辞。v3 初期花很多时间精心设计 system prompt 的文字，后来发现真正影响质量的不是措辞，而是给 Agent 什么工具、什么数据、什么约束。把精力转到 Context Engineering 后效果立刻好了。教训：**与其优化 prompt 的文字，不如优化 Agent 的环境。**"

#### Q13: "你怎么测试一个 AI Agent？"

> "分层：
> 1. 确定性层全覆盖——Skill Engine、场景分类、SQL 摘要、DataEnvelope 用常规单元测试
> 2. Trace 回归测试——6 条 canonical trace 必跑，检查结构性指标而非输出文字
> 3. E2E Agent 测试——完整 SSE 流验证，检查 Agent 推理质量和 phase transitions
> 4. 验证系统可测试——启发式检查是纯函数"

### 场景四：技术细节追问

#### Q14: "前台 App 检测为什么需要 3 级 fallback？"

> "因为不同 trace 可用的数据源不同：Tier 1 `android_battery_stats`（最可靠但需要开启 battery tracing）→ Tier 2 `android_oom_adj_intervals`（OOM adj=0 是前台）→ Tier 3 从 SurfaceFlinger layer 名解析包名。每层有 sqlite_master 守卫。"

#### Q15: "跨会话学习的 Jaccard 相似度怎么算的？"

> "加权 Jaccard。trace 特征分 5 类 tag：arch/scene 权重 3.0，domain 权重 2.0，cat 权重 1.5，finding 权重 0.5（太具体降权）。再乘时间衰减（30 天半衰期指数衰减）和频率增益。取 top 3 且 > 0.25 的注入 prompt。"

---

## 十二、面试完整叙事线

### 5-8 分钟版本

```
Opening (30s)
"我独立开发了一个 AI 驱动的 Android 性能分析平台..."

Before / 动机 (1min)
"传统分析要 45-90 分钟，门槛高，容易遗漏。关键是 LLM 不能直接分析 trace——
数据太大、需要精确计算、需要结构化的领域知识运用。"

After / 方案 (2min)
"我的方案是：给 LLM 配备精确的仪器（17 个 MCP 工具）和方法论（12 套场景策略），
让它像有经验的工程师一样工作。Claude 通过 MCP 调用 157 个 Skill 获取精确数据，
自主规划分析路径、提出假设、验证结论。"
（画架构图：Frontend ← SSE → Backend ← MCP → Claude SDK ← RPC → trace_processor）

核心亮点 (2-3min，选 2-3 个)
"三个最有意思的设计：
 1. Agent 环境工程 — Plan 门控、ArtifactStore、知识按需加载
 2. Context Engineering — 85% token 节省（SQL 摘要 + Artifact 分级 + 渐进裁剪）
 3. 确定性+概率性混合 — 已知场景策略约束 + 未知场景自主探索"

领域壁垒 (1min)
"这个项目的壁垒不在 AI 技术——是领域知识的工程化。
30 种渲染架构、700+ 张 Perfetto 表、VSync/Binder/GC 的分析逻辑...
这些编码成了 157 个 Skill 和 27 个模板文件。"

收尾 (30s)
"这个项目让我深刻理解：AI Agent 不是调 API 的 demo，
而是一个完整的工程系统——规划、执行、验证、学习的闭环。
与其优化 prompt 的文字，不如优化 Agent 的环境。"
```

### 主动引导追问方向

讲完一个点后用这些"钩子"引导面试官追问你准备好的话题：

- "这里有个有趣的 trade-off..."（引向 MCP 工具粒度设计）
- "最难的其实不是这个，而是..."（引向 Context Engineering）
- "我们踩过一个坑..."（引向"prompt 措辞 vs Agent 环境"的认知迭代）
- "为什么不直接用标准的..."（引向 Skill 系统 vs MCP Tool 的设计决策）

---

## 附录：Buzzword 清单

| 领域 | 术语 | 项目中的对应 |
|------|------|-------------|
| AI Engineering | **Context Engineering** | 15-section 动态 prompt + 渐进裁剪 + ArtifactStore |
| AI Engineering | **Tool Use / MCP** | 17 个领域工具，按认知动作设计 |
| AI Engineering | **Guardrails** | 4 层验证 + Plan 门控 + Watchdog + Circuit Breaker |
| AI Engineering | **Agentic Architecture** | 假设-验证循环 + 多轮反思修正 |
| AI Engineering | **Content-Code Separation** | Strategy/Skill 外置 Markdown/YAML，零代码新增场景 |
| System Design | **Schema-driven Rendering** | DataEnvelope 自描述数据契约 |
| System Design | **Progressive Disclosure** | L1→L4 分层结果 |
| System Design | **Circuit Breaker** | 工具调用断路器 |
| System Design | **Graceful Degradation** | 3 级 fallback + 验证层容错 |
| Engineering | **Deterministic + Probabilistic Hybrid** | 策略驱动 + 假设推理双轨 |
| Engineering | **Cross-session Learning** | 加权 Jaccard + 负模式 + SQL 错误对 |
| Domain | **Android Rendering Pipeline** | 30 种架构识别 + 29 个 Pipeline Skills |
| Domain | **Perfetto stdlib** | 761 个 schema 模板索引 + 22 个 critical preload |

---

> **核心记忆点：** 这个项目最独特的卖点不是"调了 Claude API"，而是**真正落地的 AI Agent 工程化**——规划、执行、验证、学习的完整闭环。领域知识的工程化（157 个 Skill + 12 套 Strategy + 6 个知识模板）才是核心壁垒。
>
> **一句话金句：** "与其优化 prompt 的文字，不如优化 Agent 的环境。"

---

*文档更新日期: 2026-03-23*
*基于 SmartPerfetto v3 代码库当前状态*
