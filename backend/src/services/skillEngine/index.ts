/**
 * Skill Engine
 *
 * A configurable skill system that allows performance experts to define
 * analysis workflows in YAML files without modifying code.
 *
 * Features:
 * - YAML-based skill definitions (v2 format)
 * - Composite skills with multi-step analysis
 * - AI-assisted diagnostics and summaries
 * - Automatic skill matching based on keywords and patterns
 * - Variable substitution in SQL queries
 * - Real-time execution events
 */

// =============================================================================
// Types
// =============================================================================
export * from './types_v2';

// =============================================================================
// Skill Loader
// =============================================================================
export * from './skillLoaderV2';

export {
  skillRegistryV2,
  ensureSkillRegistryV2Initialized,
  getSkillsDir,
} from './skillLoaderV2';

// =============================================================================
// Skill Executor
// =============================================================================
export * from './skillExecutorV2';

export {
  SkillExecutorV2,
  createSkillExecutorV2,
} from './skillExecutorV2';

// =============================================================================
// Skill Analysis Adapter
// =============================================================================
export * from './skillAnalysisAdapterV2';

export {
  SkillAnalysisAdapterV2,
  createSkillAnalysisAdapterV2,
  getSkillAnalysisAdapterV2,
} from './skillAnalysisAdapterV2';

// =============================================================================
// Utilities
// =============================================================================

// 智能摘要和回答生成器
export { smartSummaryGenerator, SmartSummaryGenerator } from './smartSummaryGenerator';
export { answerGenerator, AnswerGenerator } from './answerGenerator';

// 事件收集器
export {
  SkillEventCollector,
  createEventCollector,
  EventSummary,
  ProgressInfo,
} from './eventCollector';

// =============================================================================
// Legacy Aliases (for backwards compatibility during migration)
// =============================================================================

// Alias V2 as the default
export { skillRegistryV2 as skillRegistry } from './skillLoaderV2';
export { ensureSkillRegistryV2Initialized as initializeSkills } from './skillLoaderV2';
export { SkillAnalysisAdapterV2 as SkillAnalysisAdapter } from './skillAnalysisAdapterV2';
export { createSkillAnalysisAdapterV2 as createSkillAnalysisAdapter } from './skillAnalysisAdapterV2';
export { getSkillAnalysisAdapterV2 as getSkillAnalysisAdapter } from './skillAnalysisAdapterV2';
export { SkillExecutorV2 as SkillExecutor } from './skillExecutorV2';
export { createSkillExecutorV2 as createSkillExecutor } from './skillExecutorV2';
