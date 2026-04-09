// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * Focused unit tests for SceneStoryService — covers the new PR2 public
 * surface (previewOnly / getReport) and the cache-hit replay path that
 * short-circuits Stage 1-3.
 *
 * The full cold-path pipeline (Stage 1 + JobRunner + Stage 3) is exercised
 * by the existing scene-trace-regression suite, so these tests deliberately
 * stub the deps that would otherwise require a real SkillExecutor and
 * trace_processor instance.
 */

import {
  SceneStoryService,
  type SceneStoryServiceDeps,
  type SceneStorySession,
} from '../sceneStoryService';
import { SceneReportMemoryCache } from '../../../services/sceneReport/sceneReportMemoryCache';
import type { SceneReportStore } from '../../../services/sceneReport/sceneReportStore';
import type { SceneReport } from '../types';
import type { StreamingUpdate } from '../../types';
import type { DataEnvelope } from '../../../types/dataContract';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeReport(opts: { reportId?: string; hash?: string | null } = {}): SceneReport {
  return {
    reportId: opts.reportId ?? 'rpt-1',
    traceHash: opts.hash ?? 'h-cached',
    traceId: 'trace-cached',
    traceOrigin: opts.hash === null ? 'external_rpc' : 'file',
    cachePolicy: opts.hash === null ? 'memory_session' : 'disk_7d',
    expiresAt: opts.hash === null ? null : Date.now() + 60_000,
    createdAt: Date.now() - 1_000,
    traceMeta: { durationSec: 42 },
    displayedScenes: [
      {
        id: 'scene-1',
        sceneType: 'scroll',
        sourceStepId: 'inertial_scrolls',
        startTs: '0',
        endTs: '1000000000',
        durationMs: 1000,
        label: 'scroll (1000ms)',
        metadata: {},
        severity: 'warning',
        analysisState: 'completed',
      },
    ],
    cachedDataEnvelopes: [
      { meta: { type: 'skill_result' }, data: { rows: [] }, display: { layer: 'L1', format: 'table', title: 'state' } },
      { meta: { type: 'skill_result' }, data: { rows: [] }, display: { layer: 'L1', format: 'table', title: 'overlay' } },
    ] as unknown as DataEnvelope[],
    jobs: [],
    summary: '整体叙述测试',
    insights: [],
    partialReport: false,
    totalDurationMs: 1500,
    generatedBy: { runtime: 'claude-sdk', pipelineVersion: 'v2' },
  };
}

function makeSession(): SceneStorySession {
  return {
    sessionId: 'sess-1',
    status: 'pending',
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    scenes: [],
    trackEvents: [],
  };
}

interface FakeReportStore extends SceneReportStore {
  saveCalls: SceneReport[];
}

function makeFakeStore(opts: {
  reportByHash?: Record<string, SceneReport>;
  reportById?: Record<string, SceneReport>;
} = {}): FakeReportStore {
  const saveCalls: SceneReport[] = [];
  return {
    saveCalls,
    save: jest.fn(async (report: SceneReport) => {
      saveCalls.push(report);
    }),
    loadById: jest.fn(async (id: string) => opts.reportById?.[id] ?? null),
    loadByHash: jest.fn(async (hash: string) => opts.reportByHash?.[hash] ?? null),
    delete: jest.fn(async () => false),
    cleanupExpired: jest.fn(async () => 0),
  };
}

interface BuiltService {
  service: SceneStoryService;
  events: Array<{ sessionId: string; update: StreamingUpdate }>;
  store: FakeReportStore;
  memoryCache: SceneReportMemoryCache;
  session: SceneStorySession;
  computeHash: jest.Mock;
  probeDuration: jest.Mock;
}

function buildService(opts: {
  reportByHash?: Record<string, SceneReport>;
  reportById?: Record<string, SceneReport>;
  computeHashReturn?: string | null;
  probeDurationReturn?: number;
  prePopulateMemoryCache?: { traceId: string; report: SceneReport };
} = {}): BuiltService {
  const events: Array<{ sessionId: string; update: StreamingUpdate }> = [];
  const session = makeSession();

  const store = makeFakeStore({
    reportByHash: opts.reportByHash,
    reportById: opts.reportById,
  });
  const memoryCache = new SceneReportMemoryCache(10);
  if (opts.prePopulateMemoryCache) {
    memoryCache.set(
      opts.prePopulateMemoryCache.traceId,
      opts.prePopulateMemoryCache.report,
    );
  }

  const computeHash = jest.fn(async () => opts.computeHashReturn ?? null);
  const probeDuration = jest.fn(async () => opts.probeDurationReturn ?? 0);

  const deps: SceneStoryServiceDeps = {
    broadcast: (sessionId, update) => events.push({ sessionId, update }),
    getSession: (id) => (id === session.sessionId ? session : undefined),
    toEnvelopes: () => [],
    reportStore: store,
    memoryCache,
    computeHash,
    probeDuration,
  };

  return {
    service: new SceneStoryService(deps),
    events,
    store,
    memoryCache,
    session,
    computeHash,
    probeDuration,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SceneStoryService', () => {
  // -------------------------------------------------------------------------
  // Cache hit — disk store by content hash
  // -------------------------------------------------------------------------

  describe('start() — disk cache hit', () => {
    it('emits the cached SSE sequence and skips Stage 1-3 entirely', async () => {
      const cached = makeReport({ reportId: 'rpt-disk', hash: 'sha-disk' });
      const built = buildService({
        reportByHash: { 'sha-disk': cached },
        computeHashReturn: 'sha-disk',
      });

      // SkillExecutor stub that throws if anything actually calls into it.
      // Verifies the cache hit path never touches Stage 1.
      const skillExecutor = {
        execute: jest.fn(() => {
          throw new Error('Stage 1 must NOT run on cache hit');
        }),
      } as any;

      await built.service.start({
        sessionId: built.session.sessionId,
        traceId: 'trace-cached',
        skillExecutor,
      });

      // computeHash was consulted; loadByHash returned the cached report.
      expect(built.computeHash).toHaveBeenCalledWith('trace-cached');
      expect(built.store.loadByHash).toHaveBeenCalledWith('sha-disk');
      expect(skillExecutor.execute).not.toHaveBeenCalled();

      // Session state mirrors a completed run.
      expect(built.session.status).toBe('completed');
      expect(built.session.sceneStoryReport).toBe(cached);

      // Expected event sequence:
      //   progress(cached) → data×2 (envelopes) → scene_story_detected
      //   → track_data → scene_story_report_ready → progress(completed)
      const types = built.events.map((e) => e.update.type);
      expect(types).toEqual([
        'progress',
        'data',
        'data',
        'scene_story_detected',
        'track_data',
        'scene_story_report_ready',
        'progress',
      ]);

      const cachedProgress = built.events[0].update;
      expect((cachedProgress.content as any).phase).toBe('cached');

      const reportReady = built.events.find(
        (e) => e.update.type === 'scene_story_report_ready',
      );
      expect((reportReady?.update.content as any).cached).toBe(true);
      expect((reportReady?.update.content as any).reportId).toBe('rpt-disk');
    });
  });

  // -------------------------------------------------------------------------
  // Cache hit — memory cache by traceId (RPC trace, no hash)
  // -------------------------------------------------------------------------

  describe('start() — memory cache hit', () => {
    it('falls through to memory cache when computeHash returns null', async () => {
      const cached = makeReport({ reportId: 'rpt-mem', hash: null });
      const built = buildService({
        computeHashReturn: null,
        prePopulateMemoryCache: { traceId: 'rpc-trace-1', report: cached },
      });

      const skillExecutor = {
        execute: jest.fn(() => {
          throw new Error('Stage 1 must NOT run on cache hit');
        }),
      } as any;

      await built.service.start({
        sessionId: built.session.sessionId,
        traceId: 'rpc-trace-1',
        skillExecutor,
      });

      expect(built.session.sceneStoryReport).toBe(cached);
      expect(built.store.loadByHash).not.toHaveBeenCalled();
      expect(skillExecutor.execute).not.toHaveBeenCalled();

      const reportReady = built.events.find(
        (e) => e.update.type === 'scene_story_report_ready',
      );
      expect((reportReady?.update.content as any).reportId).toBe('rpt-mem');
    });

    it('falls through to cold path when memory cache misses', async () => {
      // No pre-population; expect emitCachedReport NOT to fire — but cold
      // path isn't exercised here because we don't supply a SkillExecutor
      // that succeeds. We only verify the cache check side-effects.
      const built = buildService({ computeHashReturn: null });
      const skillExecutor = {
        execute: jest.fn(async () => {
          throw new Error('cold path stub');
        }),
      } as any;

      await built.service.start({
        sessionId: built.session.sessionId,
        traceId: 'rpc-trace-cold',
        skillExecutor,
      }).catch(() => undefined); // pipeline will fail at Stage 1 — that's fine

      // No cache hit emitted — first event should be the detecting progress.
      const firstEvent = built.events[0]?.update;
      expect((firstEvent?.content as any)?.phase).toBe('detecting');
    });
  });

  // -------------------------------------------------------------------------
  // previewOnly
  // -------------------------------------------------------------------------

  describe('previewOnly', () => {
    it('returns the cached report when the disk cache hits', async () => {
      const cached = makeReport({ reportId: 'rpt-prev', hash: 'sha-prev' });
      const built = buildService({
        reportByHash: { 'sha-prev': cached },
        computeHashReturn: 'sha-prev',
      });

      const result = await built.service.previewOnly({ traceId: 't-prev' });
      expect(result.cached).toBe(cached);
      expect(result.traceDurationSec).toBe(42); // from cached.traceMeta
      expect(result.estimate.confidence).toBe('low');
      // probeDuration runs in parallel with computeHash (P0 optimisation) —
      // its result is discarded on cache hit but the call still fires.
      expect(built.probeDuration).toHaveBeenCalled();
    });

    it('returns the memory-cached report when there is no hash', async () => {
      const cached = makeReport({ reportId: 'rpt-mem', hash: null });
      const built = buildService({
        computeHashReturn: null,
        prePopulateMemoryCache: { traceId: 't-prev-mem', report: cached },
      });

      const result = await built.service.previewOnly({ traceId: 't-prev-mem' });
      expect(result.cached).toBe(cached);
      expect(built.probeDuration).toHaveBeenCalled();
    });

    it('falls through to probe + estimate when no cache hit', async () => {
      const built = buildService({
        computeHashReturn: 'sha-cold',
        // store has no entry for this hash
        probeDurationReturn: 100,
      });

      const result = await built.service.previewOnly({ traceId: 't-cold' });
      expect(result.cached).toBeNull();
      expect(result.traceDurationSec).toBe(100);
      // 100s → 10 scenes → 8 + ceil(10/3)*30 + 5 = 8 + 120 + 5 = 133s
      expect(result.estimate.expectedScenes).toBe(10);
      expect(result.estimate.etaSec).toBe(133);
      expect(built.probeDuration).toHaveBeenCalledWith('t-cold');
    });
  });

  // -------------------------------------------------------------------------
  // getReport
  // -------------------------------------------------------------------------

  describe('getReport', () => {
    it('delegates to reportStore.loadById', async () => {
      const stored = makeReport({ reportId: 'rpt-get', hash: 'sha-get' });
      const built = buildService({
        reportById: { 'rpt-get': stored },
      });

      expect(await built.service.getReport('rpt-get')).toBe(stored);
      expect(await built.service.getReport('rpt-missing')).toBeNull();
      expect(built.store.loadById).toHaveBeenCalledWith('rpt-get');
    });
  });
});
