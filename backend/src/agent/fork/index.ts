/**
 * Session Fork System Exports
 *
 * SmartPerfetto Agent 会话分叉系统
 */

// Types
export * from './forkTypes';

// Session Tree
export {
  SessionTree,
  createSessionTree,
} from './sessionTree';

// Merge Strategies
export {
  IMergeStrategy,
  MergeResultData,
  MergeFindingsData,
  ReplaceStrategy,
  AppendStrategy,
  MergeFindingsStrategy,
  CherryPickStrategy,
  MergeStrategyRegistry,
  getMergeStrategyRegistry,
  createMergeStrategyRegistry,
} from './mergeStrategies';

// Fork Manager
export {
  ForkManager,
  ForkManagerConfig,
  getForkManager,
  setForkManager,
  createForkManager,
} from './forkManager';
