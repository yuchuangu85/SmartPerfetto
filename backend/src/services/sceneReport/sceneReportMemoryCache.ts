// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * SceneReportMemoryCache — tiny process-local LRU for external-RPC traces.
 *
 * Why it exists
 * -------------
 * File-backed traces get a sha256 content hash and land in the disk store
 * with a 7-day TTL. External RPC traces (forwarded from a running
 * trace_processor_shell) have no content to hash, so we keep the last
 * SCENE_REPORT_MEMORY_CACHE_MAX reports keyed by `traceId` for as long as
 * the backend process lives — session-local, resets on restart.
 *
 * Why hand-rolled instead of `lru-cache`
 * --------------------------------------
 * JS `Map` preserves insertion order, so "mark as recently used" is just
 * `delete(k); set(k, v)` and "oldest entry" is `keys().next().value`. The
 * whole LRU contract fits in ~30 lines with zero new dependencies.
 */

import type { SceneReport } from '../../agent/scene/types';

export class SceneReportMemoryCache {
  private readonly store = new Map<string, SceneReport>();

  constructor(private readonly maxSize: number) {
    if (!Number.isInteger(maxSize) || maxSize <= 0) {
      throw new Error(
        `SceneReportMemoryCache maxSize must be a positive integer, got ${maxSize}`,
      );
    }
  }

  /**
   * Return the cached report for `traceId` and mark it as most-recently-used
   * by re-inserting it at the tail of the Map. Returns `undefined` on miss.
   */
  get(traceId: string): SceneReport | undefined {
    const report = this.store.get(traceId);
    if (report === undefined) return undefined;
    this.store.delete(traceId);
    this.store.set(traceId, report);
    return report;
  }

  /**
   * Insert or update `traceId`. If the cache is full and this is a new key,
   * evict the least-recently-used entry (the first one in insertion order).
   * Re-setting an existing key refreshes its position without evicting.
   */
  set(traceId: string, report: SceneReport): void {
    if (this.store.has(traceId)) {
      this.store.delete(traceId);
    } else if (this.store.size >= this.maxSize) {
      const oldestKey = this.store.keys().next().value as string | undefined;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(traceId, report);
  }

  delete(traceId: string): boolean {
    return this.store.delete(traceId);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
