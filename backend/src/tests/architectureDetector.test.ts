/**
 * Architecture Detector Tests
 *
 * Unit tests for the rendering architecture detection system.
 * Tests detection of:
 * - Standard Android View + RenderThread
 * - Flutter (Skia/Impeller)
 * - WebView/Chrome
 * - Jetpack Compose
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

import {
  ArchitectureDetector,
  createArchitectureDetector,
  FlutterDetector,
  WebViewDetector,
  ComposeDetector,
  StandardDetector,
  DetectorContext,
} from '../agent/detectors';

/**
 * Mock TraceProcessorService for testing
 */
class MockTraceProcessorService {
  private mockData: {
    threads: string[];
    processes: string[];
    slices: { name: string; count: number }[];
  };

  constructor() {
    this.mockData = {
      threads: [],
      processes: [],
      slices: [],
    };
  }

  /**
   * Configure mock data for a specific architecture
   */
  setMockData(data: {
    threads?: string[];
    processes?: string[];
    slices?: { name: string; count: number }[];
  }) {
    this.mockData = {
      threads: data.threads || [],
      processes: data.processes || [],
      slices: data.slices || [],
    };
  }

  /**
   * Mock query method
   */
  async query(_traceId: string, sql: string): Promise<{ columns: string[]; rows: any[][] }> {
    // Parse SQL to determine what data to return
    if (sql.includes('thread.name')) {
      // Thread query
      const pattern = this.extractPattern(sql);
      const matches = this.mockData.threads.filter((t) =>
        this.matchesPattern(t, pattern)
      );
      return {
        columns: ['name'],
        rows: matches.map((t) => [t]),
      };
    }

    if (sql.includes('process.name')) {
      // Process query
      const pattern = this.extractPattern(sql);
      const matches = this.mockData.processes.filter((p) =>
        this.matchesPattern(p, pattern)
      );
      return {
        columns: ['name'],
        rows: matches.map((p) => [p]),
      };
    }

    if (sql.includes('slice.name')) {
      // Slice query
      const pattern = this.extractPattern(sql);
      const matches = this.mockData.slices.filter((s) =>
        this.matchesPattern(s.name, pattern)
      );
      return {
        columns: ['name', 'cnt'],
        rows: matches.map((s) => [s.name, s.count]),
      };
    }

    return { columns: [], rows: [] };
  }

  private extractPattern(sql: string): string {
    const match = sql.match(/LIKE '([^']+)'/);
    return match ? match[1] : '';
  }

  private matchesPattern(value: string, pattern: string): boolean {
    // Convert SQL LIKE pattern to regex
    const regex = new RegExp(
      '^' + pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$',
      'i'
    );
    return regex.test(value);
  }
}

describe('ArchitectureDetector', () => {
  let mockService: MockTraceProcessorService;
  let context: DetectorContext;

  beforeEach(() => {
    mockService = new MockTraceProcessorService();
    context = {
      traceId: 'test-trace-id',
      traceProcessorService: mockService,
    };
  });

  describe('StandardDetector', () => {
    it('should detect standard Android architecture', async () => {
      mockService.setMockData({
        threads: ['RenderThread', 'main'],
        slices: [
          { name: 'DrawFrame', count: 100 },
          { name: 'Choreographer#doFrame', count: 100 },
        ],
      });

      const detector = new StandardDetector();
      const result = await detector.detect(context);

      expect(result.type).toBe('STANDARD');
      expect(result.confidence).toBeGreaterThan(0.3);
      expect(result.evidence.length).toBeGreaterThan(0);
    });

    it('should detect software rendering when no RenderThread', async () => {
      mockService.setMockData({
        threads: ['main'],
        slices: [{ name: 'Choreographer#doFrame', count: 100 }],
      });

      const detector = new StandardDetector();
      const result = await detector.detect(context);

      expect(result.type).toBe('SOFTWARE');
      expect(result.metadata?.isSoftwareRendering).toBe(true);
    });
  });

  describe('FlutterDetector', () => {
    it('should detect Flutter with Impeller engine', async () => {
      mockService.setMockData({
        threads: ['1.ui', '1.raster', '1.io'],
        slices: [
          { name: 'flutter::Shell::OnAnimatorDraw', count: 50 },
          { name: 'impeller::EntityPass::Render', count: 200 },
        ],
      });

      const detector = new FlutterDetector();
      const result = await detector.detect(context);

      expect(result.type).toBe('FLUTTER');
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.metadata?.flutter?.engine).toBe('IMPELLER');
    });

    it('should detect Flutter with Skia engine', async () => {
      mockService.setMockData({
        threads: ['1.ui', '1.raster'],
        slices: [
          { name: 'flutter::Shell::OnAnimatorDraw', count: 50 },
          { name: 'SkGpuDevice::drawRect', count: 100 },
        ],
      });

      const detector = new FlutterDetector();
      const result = await detector.detect(context);

      expect(result.type).toBe('FLUTTER');
      expect(result.metadata?.flutter?.engine).toBe('SKIA');
    });

    it('should not detect Flutter for standard Android app', async () => {
      mockService.setMockData({
        threads: ['RenderThread', 'main'],
        slices: [{ name: 'DrawFrame', count: 100 }],
      });

      const detector = new FlutterDetector();
      const result = await detector.detect(context);

      expect(result.type).toBe('UNKNOWN');
      expect(result.confidence).toBeLessThan(0.3);
    });
  });

  describe('WebViewDetector', () => {
    it('should detect Chrome/WebView', async () => {
      mockService.setMockData({
        threads: ['CrRendererMain', 'Compositor'],
        processes: ['com.android.chrome'],
        slices: [
          { name: 'viz::Display::DrawAndSwap', count: 100 },
          { name: 'cc::LayerTreeHost::UpdateLayers', count: 80 },
        ],
      });

      const detector = new WebViewDetector();
      const result = await detector.detect(context);

      expect(result.type).toBe('WEBVIEW');
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.metadata?.webview?.engine).toBe('CHROMIUM');
    });

    it('should detect TextureView mode', async () => {
      mockService.setMockData({
        threads: ['CrRendererMain'],
        slices: [
          { name: 'viz::Display::DrawAndSwap', count: 100 },
          { name: 'SurfaceTexture::updateTexImage', count: 50 },
        ],
      });

      const detector = new WebViewDetector();
      const result = await detector.detect(context);

      expect(result.type).toBe('WEBVIEW');
      expect(result.metadata?.webview?.surfaceType).toBe('TEXTUREVIEW');
    });

    it('should not detect WebView for standard Android app', async () => {
      mockService.setMockData({
        threads: ['RenderThread', 'main'],
        slices: [{ name: 'DrawFrame', count: 100 }],
      });

      const detector = new WebViewDetector();
      const result = await detector.detect(context);

      expect(result.type).toBe('UNKNOWN');
    });
  });

  describe('ComposeDetector', () => {
    it('should detect Jetpack Compose', async () => {
      mockService.setMockData({
        threads: ['RenderThread', 'main'],
        slices: [
          { name: 'Recomposition', count: 50 },
          { name: 'Compose:Column', count: 100 },
          { name: 'Composer.startRestartGroup', count: 200 },
        ],
      });

      const detector = new ComposeDetector();
      const result = await detector.detect(context);

      expect(result.type).toBe('COMPOSE');
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.metadata?.compose?.hasRecomposition).toBe(true);
      expect(result.metadata?.compose?.features).toContain('recomposition');
      expect(result.metadata?.compose?.features).toContain('composer');
    });

    it('should detect Compose with LazyColumn for scrolling', async () => {
      mockService.setMockData({
        threads: ['RenderThread', 'main'],
        slices: [
          { name: 'Recomposition', count: 50 },
          { name: 'Compose:Column', count: 100 },
          { name: 'LazyColumn.measure', count: 30 },
          { name: 'AndroidComposeView.dispatchDraw', count: 80 },
        ],
      });

      const detector = new ComposeDetector();
      const result = await detector.detect(context);

      expect(result.type).toBe('COMPOSE');
      expect(result.metadata?.compose?.hasLazyLists).toBe(true);
      expect(result.metadata?.compose?.isHybridView).toBe(true);
      expect(result.metadata?.compose?.features).toContain('lazy_lists');
      expect(result.metadata?.compose?.features).toContain('compose_view_bridge');
    });

    it('should not false-positive on SurfaceFlinger Compositor slices', async () => {
      mockService.setMockData({
        threads: ['RenderThread', 'main'],
        slices: [
          { name: 'Compositor::draw', count: 100 },
          { name: 'SurfaceComposer', count: 50 },
          { name: 'DrawFrame', count: 100 },
        ],
      });

      const detector = new ComposeDetector();
      const result = await detector.detect(context);

      // Should NOT detect as Compose — these are SurfaceFlinger slices
      expect(result.type).toBe('UNKNOWN');
    });

    it('should not detect Compose for standard View app', async () => {
      mockService.setMockData({
        threads: ['RenderThread', 'main'],
        slices: [
          { name: 'DrawFrame', count: 100 },
          { name: 'RecyclerView.onBindViewHolder', count: 50 },
        ],
      });

      const detector = new ComposeDetector();
      const result = await detector.detect(context);

      expect(result.type).toBe('UNKNOWN');
    });
  });

  describe('Main ArchitectureDetector', () => {
    it('should select highest confidence architecture', async () => {
      mockService.setMockData({
        threads: ['1.ui', '1.raster'],
        slices: [
          { name: 'flutter::Shell::OnAnimatorDraw', count: 50 },
          { name: 'impeller::EntityPass::Render', count: 200 },
        ],
      });

      const detector = createArchitectureDetector();
      const result = await detector.detect(context);

      expect(result.type).toBe('FLUTTER');
    });

    it('should default to STANDARD when no specific architecture detected', async () => {
      mockService.setMockData({
        threads: [],
        slices: [],
      });

      const detector = createArchitectureDetector();
      const result = await detector.detect(context);

      // Should return STANDARD as default
      expect(result.type).toBe('STANDARD');
    });

    it('should prioritize Flutter over Standard when both detected', async () => {
      // Mixed trace with both Flutter and standard Android features
      mockService.setMockData({
        threads: ['1.ui', '1.raster', 'RenderThread'],
        slices: [
          { name: 'flutter::Shell::OnAnimatorDraw', count: 50 },
          { name: 'DrawFrame', count: 100 },
          { name: 'Choreographer#doFrame', count: 100 },
        ],
      });

      const detector = createArchitectureDetector();
      const result = await detector.detect(context);

      // Flutter should win due to priority
      expect(result.type).toBe('FLUTTER');
    });
  });
});
