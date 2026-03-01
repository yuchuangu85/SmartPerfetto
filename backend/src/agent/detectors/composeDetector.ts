/**
 * Jetpack Compose Architecture Detector
 *
 * 检测 Jetpack Compose 渲染架构
 * Compose 使用标准的 RenderThread，但有特殊的 Slice 命名
 *
 * 改进点 (v2):
 * - 使用 `Compose:%` 前缀匹配避免与 SurfaceFlinger Compositor 的误匹配
 * - 添加 AndroidComposeView/ComposeView 桥接检测 (混合架构识别)
 * - 添加 LazyColumn/LazyRow/LazyVerticalGrid 列表检测 (滑动分析路由关键)
 * - 添加 Compose 动画检测
 * - 丰富 metadata 输出 (features 列表、混合架构标记)
 */

import { BaseDetector } from './baseDetector';
import {
  DetectorContext,
  DetectorResult,
  DetectionEvidence,
} from './types';

export class ComposeDetector extends BaseDetector {
  readonly name = 'ComposeDetector';
  readonly targetType = 'COMPOSE' as const;

  async detect(context: DetectorContext): Promise<DetectorResult> {
    const evidence: DetectionEvidence[] = [];
    let hasRecomposition = false;
    let hasLazyLists = false;
    let isHybridView = false;
    const features: string[] = [];

    // 1. 检测 Compose Recomposition — 最强信号
    const recomposition = await this.hasSlice(context, '%Recompos%');
    if (recomposition.exists) {
      hasRecomposition = true;
      features.push('recomposition');
      evidence.push(
        this.createEvidence(
          'slice',
          `Recomposition (${recomposition.count} occurrences)`,
          0.3,
          'Compose recomposition detected'
        )
      );
    }

    // 2. 检测 Compose 框架前缀 Slice (Compose:*)
    // 使用 `Compose:%` 避免误匹配 SurfaceFlinger 的 Compositor/SurfaceComposer/Composition
    const composePrefixSlice = await this.hasSlice(context, 'Compose:%');
    if (composePrefixSlice.exists) {
      evidence.push(
        this.createEvidence(
          'slice',
          `Compose:* (${composePrefixSlice.count} occurrences, samples: ${composePrefixSlice.samples.slice(0, 3).join(', ')})`,
          0.25,
          'Compose framework prefix slices detected'
        )
      );
    }

    // 3. 检测 AndroidComposeView / ComposeView — View 体系桥接标志
    // 几乎所有 Compose 应用都有这个 (纯 Compose 也需要 Activity.setContent 桥接)
    const composeView = await this.hasSlice(context, '%ComposeView%');
    const androidComposeView = await this.hasSlice(context, '%AndroidComposeView%');
    if (composeView.exists || androidComposeView.exists) {
      const bridgeCount = (composeView.count || 0) + (androidComposeView.count || 0);
      isHybridView = true;
      features.push('compose_view_bridge');
      evidence.push(
        this.createEvidence(
          'slice',
          `ComposeView bridge (${bridgeCount} occurrences)`,
          0.15,
          'Compose-View bridge detected (AndroidComposeView/ComposeView)'
        )
      );
    }

    // 4. 检测 Composer 相关 Slice (Composer.startGroup 等)
    const composerSlice = await this.hasSlice(context, '%Composer%');
    if (composerSlice.exists) {
      features.push('composer');
      evidence.push(
        this.createEvidence(
          'slice',
          `Composer::* (${composerSlice.count} occurrences)`,
          0.15,
          'Composer slices detected'
        )
      );
    }

    // 5. 检测 LayoutNode 相关 Slice (Compose UI 布局系统)
    const layoutNode = await this.hasSlice(context, '%LayoutNode%');
    if (layoutNode.exists) {
      features.push('layout_node');
      evidence.push(
        this.createEvidence(
          'slice',
          `LayoutNode (${layoutNode.count} occurrences)`,
          0.1,
          'Compose LayoutNode detected'
        )
      );
    }

    // 6. 检测 Lazy 列表 (LazyColumn/LazyRow/LazyVerticalGrid/LazyHorizontalGrid)
    // 这对滑动分析路由至关重要：Lazy 列表的性能瓶颈与 RecyclerView 不同
    const lazyList = await this.hasSlice(context, '%Lazy%');
    if (lazyList.exists) {
      // 过滤确认是 Compose Lazy 组件 (排除其他 Lazy 前缀)
      const isComposeLazy = lazyList.samples.some(
        (s) => /Lazy(Column|Row|List|VerticalGrid|HorizontalGrid|Layout)/i.test(s)
      );
      if (isComposeLazy) {
        hasLazyLists = true;
        features.push('lazy_lists');
        evidence.push(
          this.createEvidence(
            'slice',
            `LazyList (${lazyList.count} occurrences, samples: ${lazyList.samples.slice(0, 3).join(', ')})`,
            0.1,
            'Compose LazyColumn/LazyRow detected'
          )
        );
      }
    }

    // 7. 检测 Modifier 相关 Slice — 仅在已有其他 Compose 证据时加权
    if (evidence.length > 0) {
      const modifier = await this.hasSlice(context, '%Modifier%');
      if (modifier.exists) {
        features.push('modifier');
        evidence.push(
          this.createEvidence(
            'slice',
            `Modifier (${modifier.count} occurrences)`,
            0.05,
            'Compose Modifier detected'
          )
        );
      }
    }

    // 8. 检测 remember 相关 Slice — 仅在已有其他 Compose 证据时加权
    if (evidence.length > 0) {
      const remember = await this.hasSlice(context, '%remember%');
      if (remember.exists) {
        features.push('remember');
        evidence.push(
          this.createEvidence(
            'slice',
            `remember (${remember.count} occurrences)`,
            0.05,
            'Compose remember detected'
          )
        );
      }
    }

    // 9. 检测 Compose State 管理 (derivedStateOf / snapshotFlow / Snapshot)
    if (evidence.length > 0) {
      const derivedState = await this.hasSlice(context, '%derivedStateOf%');
      const snapshotFlow = await this.hasSlice(context, '%snapshotFlow%');
      if (derivedState.exists || snapshotFlow.exists) {
        features.push('state_management');
        evidence.push(
          this.createEvidence(
            'slice',
            'Compose state management',
            0.05,
            'Compose state utilities detected (derivedStateOf/snapshotFlow)'
          )
        );
      }
    }

    // 10. 检测 Compose 动画 (AnimatedVisibility / animate*AsState / Transition)
    if (evidence.length > 0) {
      const animSlice = await this.hasSlice(context, '%Animated%');
      const transitionSlice = await this.hasSlice(context, '%Transition%');
      const hasComposeAnim = animSlice.samples.some(
        (s) => /Animated(Visibility|Content|Float|Dp|Color|Value)/i.test(s)
      );
      const hasComposeTransition = transitionSlice.samples.some(
        (s) => /updateTransition|Transition\./i.test(s)
      );
      if (hasComposeAnim || hasComposeTransition) {
        features.push('animations');
        evidence.push(
          this.createEvidence(
            'slice',
            'Compose animations',
            0.05,
            'Compose animation APIs detected'
          )
        );
      }
    }

    // 计算置信度
    const confidence = this.calculateConfidence(evidence);

    // 如果没有足够的证据，返回未知
    if (confidence < 0.3) {
      return this.createEmptyResult();
    }

    return {
      type: 'COMPOSE',
      confidence,
      evidence,
      metadata: {
        compose: {
          hasRecomposition,
          hasLazyLists,
          isHybridView,
          features,
        },
      },
    };
  }
}
