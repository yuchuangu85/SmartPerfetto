/**
 * Standard Android View Architecture Detector
 *
 * 检测标准 Android View + RenderThread 渲染架构
 * 这是最常见的渲染架构，作为默认检测器
 */

import { BaseDetector } from './baseDetector';
import {
  DetectorContext,
  DetectorResult,
  DetectionEvidence,
} from './types';

export class StandardDetector extends BaseDetector {
  readonly name = 'StandardDetector';
  readonly targetType = 'STANDARD' as const;

  async detect(context: DetectorContext): Promise<DetectorResult> {
    const evidence: DetectionEvidence[] = [];
    let isSoftwareRendering = false;

    // 1. 检测 RenderThread
    const renderThread = await this.hasThread(context, 'RenderThread');
    if (renderThread.exists) {
      evidence.push(
        this.createEvidence(
          'thread',
          'RenderThread',
          0.3,
          'Standard RenderThread detected'
        )
      );
    }

    // 2. 检测 DrawFrame slice
    const drawFrame = await this.hasSlice(context, '%DrawFrame%');
    if (drawFrame.exists) {
      evidence.push(
        this.createEvidence(
          'slice',
          `DrawFrame (${drawFrame.count} occurrences)`,
          0.25,
          'RenderThread DrawFrame detected'
        )
      );
    }

    // 3. 检测 Choreographer doFrame
    const doFrame = await this.hasSlice(context, '%Choreographer#doFrame%');
    if (doFrame.exists) {
      evidence.push(
        this.createEvidence(
          'slice',
          `Choreographer#doFrame (${doFrame.count} occurrences)`,
          0.2,
          'Choreographer frame callback detected'
        )
      );
    }

    // 4. 检测 measure/layout/draw 阶段
    const traversal = await this.hasSlice(context, '%traversal%');
    if (traversal.exists) {
      evidence.push(
        this.createEvidence(
          'slice',
          `View traversal (${traversal.count} occurrences)`,
          0.1,
          'View hierarchy traversal detected'
        )
      );
    }

    // 5. 检测 RecyclerView (常见的列表组件)
    const recyclerView = await this.hasSlice(context, '%RecyclerView%');
    if (recyclerView.exists) {
      evidence.push(
        this.createEvidence(
          'slice',
          `RecyclerView (${recyclerView.count} occurrences)`,
          0.1,
          'RecyclerView detected'
        )
      );
    }

    // 6. 检测软件渲染 (无 RenderThread)
    if (!renderThread.exists && doFrame.exists) {
      isSoftwareRendering = true;
      evidence.push(
        this.createEvidence(
          'slice',
          'Software rendering (no RenderThread)',
          0.15,
          'Software rendering mode detected'
        )
      );
    }

    // 7. 检测 HardwareRenderer
    const hwRenderer = await this.hasSlice(context, '%HardwareRenderer%');
    if (hwRenderer.exists) {
      evidence.push(
        this.createEvidence(
          'slice',
          'HardwareRenderer',
          0.05,
          'Hardware renderer detected'
        )
      );
    }

    // 计算置信度
    const confidence = this.calculateConfidence(evidence);

    // 如果没有足够的证据，返回未知
    if (confidence < 0.2) {
      return this.createEmptyResult();
    }

    // 如果是软件渲染，返回 SOFTWARE 类型
    if (isSoftwareRendering) {
      return {
        type: 'SOFTWARE',
        confidence,
        evidence,
        metadata: {
          isSoftwareRendering: true,
        },
      };
    }

    return {
      type: 'STANDARD',
      confidence,
      evidence,
      metadata: {
        hasRenderThread: renderThread.exists,
        hasChoreographer: doFrame.exists,
      },
    };
  }
}
