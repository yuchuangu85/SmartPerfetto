// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * IO / Network / Wakelock / Wakeup Aggregator (Spark Plan 15)
 *
 * Combines four orthogonal attribution facets into one
 * `IoNetworkWakeupContract`. All facets optional; missing facets surface
 * as `unsupportedReason` rather than zero-fill.
 */

import {
  makeSparkProvenance,
  type IoBlockEvent,
  type IoNetworkWakeupContract,
  type NetworkAttribution,
  type NsTimeRange,
  type SchedulerWakeupEdge,
  type WakelockBaselineRow,
} from '../types/sparkContracts';

export interface IoNetworkWakeupOptions {
  range: NsTimeRange;
  ioEvents?: IoBlockEvent[];
  networkAttribution?: NetworkAttribution[];
  wakelockBaseline?: WakelockBaselineRow[];
  wakeupEdges?: SchedulerWakeupEdge[];
}

export function buildIoNetworkWakeup(
  options: IoNetworkWakeupOptions,
): IoNetworkWakeupContract {
  const allEmpty =
    !options.ioEvents
    && !options.networkAttribution
    && !options.wakelockBaseline
    && !options.wakeupEdges;

  return {
    ...makeSparkProvenance({
      source: 'io-network-wakeup',
      ...(allEmpty ? {unsupportedReason: 'no IO / network / wakeup facets supplied'} : {}),
    }),
    range: options.range,
    ...(options.ioEvents ? {ioEvents: options.ioEvents} : {}),
    ...(options.networkAttribution ? {networkAttribution: options.networkAttribution} : {}),
    ...(options.wakelockBaseline ? {wakelockBaseline: options.wakelockBaseline} : {}),
    ...(options.wakeupEdges ? {wakeupEdges: options.wakeupEdges} : {}),
    coverage: [
      {sparkId: 15, planId: '15', status: options.ioEvents ? 'implemented' : 'scaffolded'},
      {sparkId: 18, planId: '15', status: options.wakelockBaseline ? 'implemented' : 'scaffolded'},
      {sparkId: 20, planId: '15', status: options.wakeupEdges ? 'implemented' : 'scaffolded'},
      {sparkId: 56, planId: '15', status: options.networkAttribution ? 'implemented' : 'scaffolded'},
    ],
  };
}

/**
 * Helper: aggregate network attribution rows by endpoint to surface
 * top hosts for diagnostic UIs.
 */
export function aggregateNetworkByEndpoint(
  rows: NetworkAttribution[] | undefined,
): Array<{endpoint: string; totalDurNs: number; totalBytes: number; rowCount: number}> {
  if (!rows || rows.length === 0) return [];
  const byEndpoint = new Map<
    string,
    {endpoint: string; totalDurNs: number; totalBytes: number; rowCount: number}
  >();
  for (const r of rows) {
    let entry = byEndpoint.get(r.endpoint);
    if (!entry) {
      entry = {endpoint: r.endpoint, totalDurNs: 0, totalBytes: 0, rowCount: 0};
      byEndpoint.set(r.endpoint, entry);
    }
    entry.totalDurNs += r.durNs;
    entry.totalBytes += (r.bytesIn ?? 0) + (r.bytesOut ?? 0);
    entry.rowCount += 1;
  }
  return Array.from(byEndpoint.values()).sort(
    (a, b) => b.totalDurNs - a.totalDurNs,
  );
}
