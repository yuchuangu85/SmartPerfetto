/**
 * WebView/Chrome Architecture Detector
 *
 * 检测 WebView/Chrome/Chromium 渲染架构
 * 支持识别:
 * - Chrome 浏览器
 * - 系统 WebView
 * - 国内厂商内核 (X5, UC)
 * - Surface 类型 (SurfaceView, TextureView, SurfaceControl)
 */

import { BaseDetector } from './baseDetector';
import {
  DetectorContext,
  DetectorResult,
  DetectionEvidence,
  WebViewEngine,
  WebViewSurfaceType,
} from './types';

export class WebViewDetector extends BaseDetector {
  readonly name = 'WebViewDetector';
  readonly targetType = 'WEBVIEW' as const;

  async detect(context: DetectorContext): Promise<DetectorResult> {
    const evidence: DetectionEvidence[] = [];
    let webviewEngine: WebViewEngine = 'UNKNOWN';
    let surfaceType: WebViewSurfaceType = 'UNKNOWN';
    let multiProcess = false;

    // 1. 检测 Chromium 渲染器主线程 (CrRendererMain)
    const rendererMain = await this.hasThread(context, '%CrRendererMain%');
    if (rendererMain.exists) {
      evidence.push(
        this.createEvidence(
          'thread',
          'CrRendererMain',
          0.3,
          'Chromium renderer main thread detected'
        )
      );
      webviewEngine = 'CHROMIUM';
    }

    // 2. 检测 Compositor 线程
    const compositor = await this.hasThread(context, '%Compositor%');
    if (compositor.exists) {
      // 排除 SurfaceFlinger 的 CompositorTiming
      const chromeCompositor = compositor.matches.find(
        (t) => !t.includes('SurfaceFlinger') && !t.includes('Timing')
      );
      if (chromeCompositor) {
        evidence.push(
          this.createEvidence(
            'thread',
            chromeCompositor,
            0.2,
            'Chromium compositor thread detected'
          )
        );
      }
    }

    // 3. 检测 viz:: 相关 slice (Chromium Viz 服务)
    const vizSlice = await this.hasSlice(context, 'viz::%');
    if (vizSlice.exists) {
      evidence.push(
        this.createEvidence(
          'slice',
          `viz::* (${vizSlice.count} occurrences)`,
          0.2,
          'Chromium Viz service slices detected'
        )
      );
      webviewEngine = 'CHROMIUM';
    }

    // 4. 检测 cc:: 相关 slice (Chromium Compositor)
    const ccSlice = await this.hasSlice(context, 'cc::%');
    if (ccSlice.exists) {
      evidence.push(
        this.createEvidence(
          'slice',
          `cc::* (${ccSlice.count} occurrences)`,
          0.15,
          'Chromium compositor slices detected'
        )
      );
    }

    // 5. 检测 blink:: 相关 slice (Blink 渲染引擎)
    const blinkSlice = await this.hasSlice(context, 'blink::%');
    if (blinkSlice.exists) {
      evidence.push(
        this.createEvidence(
          'slice',
          `blink::* (${blinkSlice.count} occurrences)`,
          0.15,
          'Blink rendering engine slices detected'
        )
      );
    }

    // 6. 检测 V8 JavaScript 引擎
    const v8Slice = await this.hasSlice(context, 'v8.%');
    if (v8Slice.exists) {
      evidence.push(
        this.createEvidence(
          'slice',
          `v8.* (${v8Slice.count} occurrences)`,
          0.1,
          'V8 JavaScript engine slices detected'
        )
      );
    }

    // 7. 检测 Chrome/WebView 进程
    const chromeProcess = await this.hasProcess(context, '%chrome%');
    if (chromeProcess.exists) {
      evidence.push(
        this.createEvidence(
          'process',
          chromeProcess.matches[0],
          0.15,
          'Chrome process detected'
        )
      );
      webviewEngine = 'CHROMIUM';
    }

    const webviewProcess = await this.hasProcess(context, '%webview%');
    if (webviewProcess.exists) {
      evidence.push(
        this.createEvidence(
          'process',
          webviewProcess.matches[0],
          0.15,
          'WebView process detected'
        )
      );
      if (webviewEngine === 'UNKNOWN') {
        webviewEngine = 'CHROMIUM';
      }
    }

    // 8. 检测国内厂商内核
    // X5 内核 (腾讯)
    const x5Process = await this.hasProcess(context, '%x5%');
    const x5Slice = await this.hasSlice(context, '%x5%');
    if (x5Process.exists || x5Slice.exists) {
      webviewEngine = 'X5';
      evidence.push(
        this.createEvidence(
          'process',
          'X5 kernel',
          0.1,
          'Tencent X5 kernel detected'
        )
      );
    }

    // UC 内核
    const ucProcess = await this.hasProcess(context, '%uc%browser%');
    if (ucProcess.exists) {
      webviewEngine = 'UC';
      evidence.push(
        this.createEvidence(
          'process',
          'UC kernel',
          0.1,
          'UC browser kernel detected'
        )
      );
    }

    // 9. 检测 Surface 类型
    // TextureView 模式: 检测 SurfaceTexture::updateTexImage
    const textureUpdate = await this.hasSlice(
      context,
      '%SurfaceTexture%updateTexImage%'
    );
    if (textureUpdate.exists) {
      surfaceType = 'TEXTUREVIEW';
      evidence.push(
        this.createEvidence(
          'slice',
          'SurfaceTexture::updateTexImage',
          0.1,
          'TextureView mode detected'
        )
      );
    }

    // SurfaceControl 模式
    const surfaceControl = await this.hasSlice(context, '%SurfaceControl%');
    if (surfaceControl.exists) {
      surfaceType = 'SURFACECONTROL';
      evidence.push(
        this.createEvidence(
          'slice',
          'SurfaceControl',
          0.1,
          'SurfaceControl mode detected'
        )
      );
    }

    // 默认 SurfaceView 模式 (如果有 Chromium 但没有检测到其他类型)
    if (surfaceType === 'UNKNOWN' && evidence.length > 0) {
      surfaceType = 'SURFACEVIEW';
    }

    // 10. 检测多进程架构
    const gpuProcess = await this.hasProcess(context, '%:gpu-process%');
    const sandboxed = await this.hasProcess(context, '%:sandboxed_process%');
    if (gpuProcess.exists || sandboxed.exists) {
      multiProcess = true;
      evidence.push(
        this.createEvidence(
          'process',
          'Multi-process architecture',
          0.05,
          'GPU or sandboxed process detected'
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
      type: 'WEBVIEW',
      confidence,
      evidence,
      metadata: {
        webview: {
          engine: webviewEngine,
          surfaceType,
          multiProcess,
        },
      },
    };
  }
}
