// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * Startup / ANR / Method-Trace Graph builder (Spark Plan 17)
 *
 * Combines startup phase rows, ANR attribution and method-trace nodes
 * into one `StartupAnrMethodGraphContract`. Performs minimal validation:
 *  - Method-trace nodes must reference valid child ids; orphans are
 *    dropped from the children[] arrays so the contract can render.
 *  - Each child id is recorded in `coverage` to surface implementation
 *    completeness per spark.
 */

import {
  makeSparkProvenance,
  type AnrAttribution,
  type JankDecisionNode,
  type MethodTraceNode,
  type NsTimeRange,
  type StartupAnrMethodGraphContract,
  type StartupPhaseRow,
} from '../types/sparkContracts';

export interface StartupAnrMethodGraphOptions {
  range: NsTimeRange;
  startupPhases?: StartupPhaseRow[];
  anrAttributions?: AnrAttribution[];
  methodTraceGraph?: MethodTraceNode[];
  decisionTree?: JankDecisionNode;
}

/** Drop dangling child ids from method trace nodes. */
function pruneMethodTraceChildren(
  nodes: MethodTraceNode[] | undefined,
): MethodTraceNode[] | undefined {
  if (!nodes || nodes.length === 0) return nodes;
  const validIds = new Set(nodes.map(n => n.id));
  return nodes.map(n => ({
    ...n,
    ...(n.children
      ? {children: n.children.filter(childId => validIds.has(childId))}
      : {}),
  }));
}

export function buildStartupAnrMethodGraph(
  options: StartupAnrMethodGraphOptions,
): StartupAnrMethodGraphContract {
  const methodTraceGraph = pruneMethodTraceChildren(options.methodTraceGraph);

  const allEmpty =
    !options.startupPhases
    && !options.anrAttributions
    && !methodTraceGraph
    && !options.decisionTree;

  // Phase coverage detection — flips coverage entries when a phase row
  // surfaces evidence for a particular spark.
  const hasArtJit = options.startupPhases?.some(
    p => p.artVerifierDurNs !== undefined || p.jitDurNs !== undefined || p.classLoadingDurNs !== undefined,
  );
  const hasCompose = options.startupPhases?.some(
    p => p.recompositionCount !== undefined && p.recompositionCount > 0,
  );
  const hasInitializers = options.startupPhases?.some(
    p => p.initializersFired && p.initializersFired.length > 0,
  );
  const methodSources = new Set(
    (methodTraceGraph ?? []).map(n => n.source).filter(Boolean) as string[],
  );

  return {
    ...makeSparkProvenance({
      source: 'startup-anr-method-graph',
      ...(allEmpty ? {unsupportedReason: 'no startup / ANR / method-trace facets supplied'} : {}),
    }),
    range: options.range,
    ...(options.startupPhases ? {startupPhases: options.startupPhases} : {}),
    ...(options.anrAttributions ? {anrAttributions: options.anrAttributions} : {}),
    ...(methodTraceGraph ? {methodTraceGraph} : {}),
    ...(options.decisionTree ? {decisionTree: options.decisionTree} : {}),
    coverage: [
      {sparkId: 32, planId: '17', status: options.startupPhases ? 'implemented' : 'scaffolded'},
      {sparkId: 33, planId: '17', status: options.anrAttributions ? 'implemented' : 'scaffolded'},
      {sparkId: 49, planId: '17', status: options.anrAttributions?.some(a => a.threadSamples?.length) ? 'implemented' : 'scaffolded'},
      {sparkId: 68, planId: '17', status: hasCompose ? 'implemented' : 'scaffolded'},
      {sparkId: 69, planId: '17', status: hasInitializers ? 'implemented' : 'scaffolded'},
      {sparkId: 72, planId: '17', status: methodSources.has('matrix') || methodSources.has('btrace') || methodSources.has('rheatrace') || methodSources.has('koom') ? 'implemented' : 'scaffolded'},
      {sparkId: 78, planId: '17', status: methodSources.has('bytecode') ? 'implemented' : 'scaffolded'},
      {sparkId: 132, planId: '17', status: hasArtJit ? 'implemented' : 'scaffolded'},
    ],
  };
}
