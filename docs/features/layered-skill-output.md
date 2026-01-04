# Layered Skill Output

## Overview

Layered skill output is a presentation system that organizes skill execution results into hierarchical layers (L1-L4), providing a progressive disclosure experience for complex performance analysis. This system enables users to drill down from high-level summaries to detailed frame-by-frame analysis.

**Key Benefits:**
- **Progressive Disclosure**: Start with summaries, drill into details as needed
- **Reduced Cognitive Load**: Only expand layers relevant to your investigation
- **Consistent Structure**: All layered skills follow the same L1-L4 pattern
- **Flexible Navigation**: Expand/collapse individual layers or use bulk controls

## Layer Structure

The layered output system defines four layers, each serving a specific purpose in the analysis hierarchy:

### L1: Overview Layer
**Purpose**: High-level summary and key metrics

**Content:**
- Environment information (refresh rate, data availability)
- Overall performance metrics (total frames, jank rate, FPS)
- AI-generated summary
- Quick health indicators (ratings, status)

**Example:**
```yaml
- id: performance_summary
  name: "帧性能汇总"
  display:
    level: key
    layer: L1
    title: "帧性能汇总"
```

**Usage**: Always visible by default. Provides immediate "health check" results.

### L2: Session/Interval Layer
**Purpose**: Grouped analysis by logical sessions or time intervals

**Content:**
- Scroll sessions (continuous frame rendering intervals)
- Per-session statistics (frame count, duration, jank rate)
- Session-level metrics

**Example:**
```yaml
- id: find_scroll_sessions
  name: "识别滑动区间"
  display:
    level: summary
    layer: L2
    title: "滑动区间"
```

**Usage**: Visible by default. Allows users to identify which sessions need deeper investigation.

### L3: Session Detail Layer
**Purpose**: Detailed breakdown within each session

**Content:**
- Per-session jank distribution
- Frame type breakdown
- Jank type statistics
- Session-specific diagnostics

**Example:**
```yaml
- id: jank_type_stats
  name: "掉帧类型统计"
  display:
    level: key
    layer: L3
    title: "掉帧类型分布"
```

**Usage**: Expanded on-demand when investigating specific sessions. Requires selecting a session from L2.

### L4: Frame Analysis Layer
**Purpose:** Granular, frame-level analysis with root cause details

**Content:**
- Per-frame analysis (main thread, RenderThread, CPU scheduling)
- Binder calls, lock contention, blocking operations
- Big/Little core usage analysis
- Four-quadrant analysis (CPU states)
- Specific recommendations for each frame

**Example:**
```yaml
- id: analyze_jank_frames
  type: iterator
  name: "逐帧详细分析"
  display:
    level: key
    layer: L4
    title: "掉帧帧详细分析"
```

**Usage**: Expanded on-demand for specific frames. Most detailed view, typically triggered from L3.

## Layer Visibility Hierarchy

```
L1 (Overview)
  ↓
L2 (Sessions)
  ↓
L3 (Session Details)
  ↓
L4 (Frame Analysis)
```

- **L1**: Always visible
- **L2**: Always visible (provides navigation to L3)
- **L3**: Visible only when a parent session is expanded
- **L4**: Visible only when a parent frame is expanded

## Usage for Skill Authors

### Step 1: Add `display.layer` to Skill Steps

Add the `layer` field to the `display` configuration in your skill YAML:

```yaml
steps:
  - id: environment_check
    type: atomic
    name: "检测环境"
    display:
      level: summary
      layer: L1              # ← Add layer designation
      title: "环境信息"
    sql: |
      SELECT ...
```

### Step 2: Follow Layer Guidelines

**L1 Assignment:**
- Overall metrics and summaries
- Health indicators
- AI-generated overviews
- Environment/context information

**L2 Assignment:**
- Session or interval groupings
- Time-based aggregations
- High-level categorization

**L3 Assignment:**
- Per-session breakdowns
- Detailed statistics within groups
- Category distributions
- Session-level diagnostics

**L4 Assignment:**
- Iterator results (per-item analysis)
- Frame/item-level details
- Root cause analysis
- Specific actionable recommendations

### Step 3: Set Default Expansion

Configure which layers should be expanded by default in the output:

```yaml
output:
  display:
    level: key
    format: summary
    # Or for layered output:
    format: layered
    defaultExpanded: ['L1', 'L2']  # Optional: specify default expanded layers
```

### Complete Example: scrolling_analysis

Here's how the scrolling_analysis skill uses layered output:

```yaml
name: scrolling_analysis
version: "2.3"
type: composite

steps:
  # L1: Environment and overall summary
  - id: detect_environment
    type: atomic
    name: "检测环境"
    display:
      level: summary
      layer: L1
      title: "环境信息"
    sql: "..."

  - id: frame_performance_summary
    type: atomic
    name: "帧性能汇总"
    display:
      level: key
      layer: L1
      title: "帧性能汇总"
    sql: "..."

  # L2: Session identification
  - id: find_scroll_sessions
    type: atomic
    name: "识别滑动区间"
    display:
      level: summary
      layer: L2
      title: "滑动区间"
    sql: "..."

  # L3: Session-level details
  - id: jank_type_stats
    type: atomic
    name: "掉帧类型统计"
    display:
      level: key
      layer: L3
      title: "掉帧类型分布"
    sql: "..."

  # L4: Frame-level analysis (iterator)
  - id: analyze_jank_frames
    type: iterator
    name: "逐帧详细分析"
    display:
      level: key
      layer: L4
      title: "掉帧帧详细分析"
    source: app_jank_frames
    item_skill: jank_frame_detail

  # AI Summary (L1)
  - id: global_summary
    type: ai_summary
    name: "分析总结"
    display:
      level: key
      layer: L1
      title: "滑动分析总结"
    inputs: [environment, performance_summary, jank_stats]
```

### Best Practices

1. **Logical Hierarchy**: Ensure data flows logically from L1 → L2 → L3 → L4
2. **Progressive Detail**: Each layer should add more detail, not repeat information
3. **Navigation**: Lower layers (L3, L4) should reference identifiers from parent layers
4. **Conditional Display**: Use `condition` to skip layers when data is unavailable
5. **Iterator Pattern**: Use L4 for iterator results that generate per-item analysis

## Frontend Rendering

### React Implementation (SmartPerfetto Frontend)

**Component**: `frontend/src/components/skill/LayeredResultView.tsx`

**Key Features:**
- Collapse/expand individual layers
- Bulk expand/collapse all layers
- Nested collapse for sessions (L3) and frames (L4)
- Responsive rendering

**Usage:**
```tsx
import LayeredResultView from './components/skill/LayeredResultView';

<LayeredResultView result={layeredResult} />
```

**State Management:**
- `expandedLayers`: Set of currently expanded layer IDs
- `expandedSessions`: Set of expanded session IDs (for L3)
- `expandedFrames`: Set of expanded frame IDs (for L4)

### Mithril Implementation (Perfetto UI)

**Component**: `perfetto/ui/src/components/skill/layered_result_view.ts`

**Class**: `LayeredResultView`

**Key Methods:**
- `toggleLayer(layer)`: Expand/collapse a layer
- `toggleSession(sessionId)`: Expand/collapse a session
- `toggleFrame(frameId)`: Expand/collapse a frame
- `expandAll()`: Expand all layers and items
- `collapseAll()`: Collapse to default state

**Usage:**
```ts
import {LayeredResultView} from './components/skill/layered_result_view';

m(LayeredResultView, {result: layeredResult})
```

### Sub-components

**L1 Components:**
- `L1OverviewCard`: Displays summary metrics, environment info, AI summary

**L2 Components:**
- `L2SessionList`: Lists sessions with expand/collapse controls

**L3 Components:**
- `L3SessionDetail`: Shows detailed statistics for a session

**L4 Components:**
- `L4FrameAnalysis`: Displays per-frame analysis with recommendations

## Data Format

### LayeredResult Structure

**TypeScript Interface:**
```typescript
interface LayeredResult {
  layers: {
    L1?: Record<string, any>;
    L2?: Record<string, any>;
    L3?: Record<string, Record<string, any>>;
    L4?: Record<string, Record<string, any>>;
  };
  defaultExpanded: ('L1' | 'L2' | 'L3' | 'L4')[];
  metadata: {
    skillName: string;
    version: string;
    executedAt: string;
  };
}
```

**Field Descriptions:**

- **layers**: Container for all layer data
  - **L1**: Flat key-value pairs of step results
  - **L2**: Flat key-value pairs of session/group results
  - **L3**: Nested structure (session ID → step results)
  - **L4**: Nested structure (item ID → step results)

- **defaultExpanded**: Array of layer IDs to expand by default
  - Common: `['L1', 'L2']` for overview-first experience
  - Alternative: `['L1']` for minimal initial view

- **metadata**: Execution metadata
  - **skillName**: Name of the executed skill
  - **version**: Skill version
  - **executedAt**: ISO timestamp of execution

### Example Data Structure

```json
{
  "layers": {
    "L1": {
      "environment": {
        "data": [{
          "refresh_rate_hz": 60,
          "frame_data_status": "available"
        }]
      },
      "performance_summary": {
        "data": [{
          "total_frames": 1234,
          "jank_rate": 3.2,
          "avg_fps": 58.5
        }]
      },
      "global_summary": {
        "summary": "滑动性能良好，掉帧率 3.2%。"
      }
    },
    "L2": {
      "scroll_sessions": {
        "data": [
          {
            "session_id": 0,
            "frame_count": 245,
            "duration_ms": 4200,
            "start_ts": "1234567890000"
          },
          {
            "session_id": 1,
            "frame_count": 180,
            "duration_ms": 3100,
            "start_ts": "1234572100000"
          }
        ]
      }
    },
    "L3": {
      "0": {
        "jank_type_stats": {
          "data": [{
            "jank_type": "App Deadline Missed",
            "count": 8
          }]
        }
      },
      "1": {
        "jank_type_stats": {
          "data": [{
            "jank_type": "Self Jank",
            "count": 5
          }]
        }
      }
    },
    "L4": {
      "frame_42": {
        "main_thread_analysis": {
          "diagnosis": "主线程耗时操作"
        },
        "binder_calls": {
          "data": [{
            "name": "getContentProvider",
            "dur_ms": 15
          }]
        },
        "cpu_scheduling": {
          "big_core_ratio": 0.75
        }
      },
      "frame_87": {
        "main_thread_analysis": {
          "diagnosis": "锁竞争"
        },
        "lock_contention": {
          "data": [{
            "lock_name": "mLock",
            "wait_dur_ms": 8
          }]
        }
      }
    }
  },
  "defaultExpanded": ["L1", "L2"],
  "metadata": {
    "skillName": "scrolling_analysis",
    "version": "2.3",
    "executedAt": "2024-12-28T12:34:56.789Z"
  }
}
```

## Implementation Flow

### Backend (Skill Execution)

1. **Skill Parsing**: Load skill YAML and extract `display.layer` from each step
2. **Execution**: Run steps and collect results with layer metadata
3. **Layer Assembly**: Group results by layer designation
   - L1/L2: Direct mapping (step ID → result)
   - L3: Group by session ID from iterator
   - L4: Group by item ID from nested iterator
4. **Response Generation**: Return `LayeredResult` structure to frontend

### Frontend (Display)

1. **Result Reception**: Receive `LayeredResult` from backend
2. **State Initialization**: Set `expandedLayers` from `defaultExpanded`
3. **Layer Rendering**: Render each layer if it exists in the result
4. **User Interaction**: Handle expand/collapse events
5. **Nested Rendering**: Render L3/L4 only when parent is expanded

## Migration Guide

### For Existing Skills

To add layered output to an existing skill:

1. **Add `layer` field** to each step's `display` configuration
2. **Reorganize steps** to follow L1→L2→L3→L4 hierarchy
3. **Update iterators** to use L4 for their results
4. **Test locally** to verify correct layer assignment
5. **Update documentation** if needed

### Before (No Layering):
```yaml
steps:
  - id: performance_summary
    name: "性能汇总"
    display:
      level: key
      title: "性能汇总"
```

### After (With Layering):
```yaml
steps:
  - id: performance_summary
    name: "性能汇总"
    display:
      level: key
      layer: L1          # ← Added
      title: "性能汇总"
```

## Troubleshooting

### Layer Not Displaying

**Symptom**: A step's results don't appear in the UI

**Possible Causes:**
1. `display.layer` not specified
2. Layer value is not one of: `L1`, `L2`, `L3`, `L4`
3. Step execution failed or was skipped
4. Parent layer not expanded (for L3/L4)

**Solution**: Check the step's `display` configuration and verify execution logs

### Empty Layer

**Symptom**: Layer appears but shows no data

**Possible Causes:**
1. Step returned empty results
2. `condition` evaluated to false
3. Iterator source was empty

**Solution**: Verify the step's SQL/logic and check execution context

### Navigation Issues

**Symptom**: Cannot expand L3 or L4 items

**Possible Causes:**
1. Parent layer not expanded
2. Invalid ID references between layers
3. Missing parent-child relationships

**Solution**: Ensure L3 uses session IDs from L2, L4 uses item IDs from L3

## Future Enhancements

Planned improvements to the layered output system:

- **Customizable Layers**: Allow skills to define custom layer names
- **Persistent State**: Remember user's expansion preferences
- **Export**: Export expanded layers as reports
- **Search**: Search within layers
- **Diff View**: Compare layered results between traces
- **Metrics Overlay**: Visualize metrics across layers

## References

- **Type Definitions**: `backend/src/services/skillEngine/types_v2.ts`
- **Executor**: `backend/src/services/skillEngine/skillExecutorV2.ts`
- **React Component**: `frontend/src/components/skill/LayeredResultView.tsx`
- **Mithril Component**: `perfetto/ui/src/components/skill/layered_result_view.ts`
- **Example Skill**: `backend/skills/v2/composite/scrolling_analysis.skill.yaml`

## Summary

Layered skill output provides a structured, hierarchical approach to presenting complex performance analysis results. By organizing data into L1 (overview) → L2 (sessions) → L3 (details) → L4 (frame analysis), it enables users to efficiently navigate from high-level insights to root cause details without being overwhelmed by information.

For skill authors, adoption is straightforward: add `display.layer` to step configurations following the L1-L4 guidelines. The frontend rendering components handle the rest, providing a consistent user experience across all layered skills.
