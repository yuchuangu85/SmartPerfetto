/**
 * Jetpack Compose Architecture Detector
 *
 * 检测 Jetpack Compose 渲染架构
 * Compose 使用标准的 RenderThread，但有特殊的 Slice 命名
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

    // 1. 检测 Compose Recomposition
    const recomposition = await this.hasSlice(context, '%Recompos%');
    if (recomposition.exists) {
      hasRecomposition = true;
      evidence.push(
        this.createEvidence(
          'slice',
          `Recomposition (${recomposition.count} occurrences)`,
          0.35,
          'Compose recomposition detected'
        )
      );
    }

    // 2. 检测 Compose 相关 Slice
    const composeSlice = await this.hasSlice(context, '%Compose%');
    if (composeSlice.exists) {
      evidence.push(
        this.createEvidence(
          'slice',
          `Compose::* (${composeSlice.count} occurrences)`,
          0.25,
          'Compose framework slices detected'
        )
      );
    }

    // 3. 检测 Composer 相关 Slice
    const composerSlice = await this.hasSlice(context, '%Composer%');
    if (composerSlice.exists) {
      evidence.push(
        this.createEvidence(
          'slice',
          `Composer::* (${composerSlice.count} occurrences)`,
          0.2,
          'Composer slices detected'
        )
      );
    }

    // 4. 检测 LayoutNode 相关 Slice (Compose UI)
    const layoutNode = await this.hasSlice(context, '%LayoutNode%');
    if (layoutNode.exists) {
      evidence.push(
        this.createEvidence(
          'slice',
          `LayoutNode (${layoutNode.count} occurrences)`,
          0.1,
          'Compose LayoutNode detected'
        )
      );
    }

    // 5. 检测 Modifier 相关 Slice
    const modifier = await this.hasSlice(context, '%Modifier%');
    if (modifier.exists) {
      // 只有在已经有其他 Compose 证据时才加权
      if (evidence.length > 0) {
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

    // 6. 检测 remember 相关 Slice
    const remember = await this.hasSlice(context, '%remember%');
    if (remember.exists && evidence.length > 0) {
      evidence.push(
        this.createEvidence(
          'slice',
          `remember (${remember.count} occurrences)`,
          0.05,
          'Compose remember detected'
        )
      );
    }

    // 7. 检测 derivedStateOf 或 snapshotFlow
    const derivedState = await this.hasSlice(context, '%derivedStateOf%');
    const snapshotFlow = await this.hasSlice(context, '%snapshotFlow%');
    if (derivedState.exists || snapshotFlow.exists) {
      evidence.push(
        this.createEvidence(
          'slice',
          'Compose state management',
          0.05,
          'Compose state utilities detected'
        )
      );
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
        },
      },
    };
  }
}
