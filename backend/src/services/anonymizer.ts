// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * Anonymizer + Large-Trace Streaming Helpers (Spark Plan 06)
 *
 * Stable identifier mapping per AnonymizationDomain so the same package
 * always becomes the same placeholder across runs (Spark #29). Placeholder
 * suffixes are derived from a deterministic hash of `domain + original`
 * so cross-run diffs and correlations stay valid — Codex review caught
 * that order-dependent counters meant the same package could be `app_1`
 * on one run and `app_2` on another. Streaming progress reporter for
 * large-trace ingestion (Spark #30).
 */

import * as crypto from 'crypto';
import {
  makeSparkProvenance,
  type AnonymizationContract,
  type AnonymizationDomain,
  type AnonymizationMapping,
  type LargeTraceStreamProgress,
} from '../types/sparkContracts';

const DOMAIN_PREFIX: Record<AnonymizationDomain, string> = {
  package: 'app_',
  process: 'proc_',
  thread: 'thread_',
  path: 'path_',
  user_id: 'user_',
  device_id: 'device_',
};

/** Length of the hex suffix; 8 hex chars = 32 bits, ~negligible collision risk in practice. */
const HASH_SUFFIX_LEN = 8;

function deterministicSuffix(domain: AnonymizationDomain, original: string): string {
  // SHA-256 is overkill but uniformly available in Node and produces a
  // stable hex string regardless of process state, which is exactly what
  // we need for cross-run mapping stability.
  const hash = crypto
    .createHash('sha256')
    .update(domain)
    .update('|')
    .update(original)
    .digest('hex');
  return hash.slice(0, HASH_SUFFIX_LEN);
}

/**
 * Stable anonymizer. Same input value always maps to same placeholder for
 * the same domain — order-independent, no shared mutable counter.
 */
export class Anonymizer {
  private mappings: Map<string, AnonymizationMapping> = new Map();
  /**
   * Reverse lookup so we can detect collisions and assign a numeric
   * `collisionIndex` if two distinct originals hash to the same suffix.
   * Keyed by `${domain}:${placeholder}` to keep domains separate.
   */
  private placeholderOwners: Map<string, string> = new Map();

  private keyOf(domain: AnonymizationDomain, original: string): string {
    return `${domain}:${original}`;
  }

  /** Map a value to its placeholder, creating one on first sight. */
  redact(domain: AnonymizationDomain, original: string): string {
    const key = this.keyOf(domain, original);
    const cached = this.mappings.get(key);
    if (cached) return cached.placeholder;

    const prefix = DOMAIN_PREFIX[domain] ?? 'redacted_';
    const baseSuffix = deterministicSuffix(domain, original);
    let placeholder = `${prefix}${baseSuffix}`;
    let collisionIndex: number | undefined;
    let collisionTry = 1;

    // Resolve hash collision: another `original` already owns this
    // placeholder for this domain. Walk a sub-suffix counter until free.
    while (true) {
      const ownerKey = `${domain}:${placeholder}`;
      const existingOwner = this.placeholderOwners.get(ownerKey);
      if (!existingOwner || existingOwner === original) break;
      collisionIndex = collisionTry;
      placeholder = `${prefix}${baseSuffix}_${collisionTry}`;
      collisionTry += 1;
      if (collisionTry > 1000) {
        // Defensive cap; mathematically unreachable for SHA-256 + 8 hex
        // chars at any realistic input size, but bail rather than spin.
        throw new Error(`Anonymizer: too many collisions for ${domain}/${original}`);
      }
    }

    this.placeholderOwners.set(`${domain}:${placeholder}`, original);
    this.mappings.set(key, {
      domain,
      original,
      placeholder,
      ...(collisionIndex !== undefined ? {collisionIndex} : {}),
    });
    return placeholder;
  }

  /** Replace every original-value occurrence in a free-form string. */
  redactString(domain: AnonymizationDomain, original: string, body: string): string {
    if (!original) return body;
    const placeholder = this.redact(domain, original);
    return body.split(original).join(placeholder);
  }

  /** Snapshot all mappings (sorted by domain then original for stability). */
  getMappings(): AnonymizationMapping[] {
    return Array.from(this.mappings.values()).sort((a, b) => {
      if (a.domain !== b.domain) return a.domain.localeCompare(b.domain);
      return a.original.localeCompare(b.original);
    });
  }

  /** Build a contract describing the current redaction state. */
  toContract(opts: {
    state?: 'raw' | 'partial' | 'redacted';
    pendingDomains?: AnonymizationDomain[];
    streamProgress?: LargeTraceStreamProgress;
  } = {}): AnonymizationContract {
    return {
      ...makeSparkProvenance({source: 'anonymizer'}),
      state: opts.state ?? (opts.pendingDomains && opts.pendingDomains.length > 0 ? 'partial' : 'redacted'),
      mappings: this.getMappings(),
      ...(opts.pendingDomains ? {pendingDomains: opts.pendingDomains} : {}),
      ...(opts.streamProgress ? {streamProgress: opts.streamProgress} : {}),
      coverage: [
        {sparkId: 29, planId: '06', status: 'implemented'},
        {sparkId: 30, planId: '06', status: opts.streamProgress ? 'implemented' : 'scaffolded'},
      ],
    };
  }
}

/** Streaming progress reporter for large-trace ingestion. */
export class LargeTraceStreamReporter {
  private startedAt = Date.now();
  private chunksEmitted = 0;
  private processedBytes = 0;
  private lastChunkAt = this.startedAt;
  private done = false;

  constructor(private totalBytes: number) {}

  /** Record progress after a chunk is processed. */
  report(chunkBytes: number): LargeTraceStreamProgress {
    const now = Date.now();
    this.processedBytes += chunkBytes;
    this.chunksEmitted += 1;
    const lastChunkMs = now - this.lastChunkAt;
    this.lastChunkAt = now;
    return {
      totalBytes: this.totalBytes,
      processedBytes: Math.min(this.processedBytes, this.totalBytes),
      chunksEmitted: this.chunksEmitted,
      done: this.done || this.processedBytes >= this.totalBytes,
      lastChunkMs,
    };
  }

  /** Mark the stream as completed. */
  complete(): LargeTraceStreamProgress {
    this.done = true;
    return {
      totalBytes: this.totalBytes,
      processedBytes: this.totalBytes,
      chunksEmitted: this.chunksEmitted,
      done: true,
    };
  }
}
