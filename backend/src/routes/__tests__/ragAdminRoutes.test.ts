// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {describe, it, expect, beforeEach, afterEach} from '@jest/globals';
import express from 'express';
import request from 'supertest';

import {createRagAdminRoutes} from '../ragAdminRoutes';
import {RagStore} from '../../services/ragStore';
import type {RagChunk} from '../../types/sparkContracts';

let tmpDir: string;
let store: RagStore;
let app: express.Express;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-admin-test-'));
  store = new RagStore(path.join(tmpDir, 'rag.json'));
  app = express();
  app.use(express.json({limit: '5mb'}));
  app.use('/api/rag', createRagAdminRoutes(store));
});

afterEach(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, {recursive: true, force: true});
  }
});

function makeChunk(overrides: Partial<RagChunk> = {}): RagChunk {
  return {
    chunkId: 'c-001',
    kind: 'androidperformance.com',
    uri: 'https://androidperformance.com/x',
    snippet: 'binder transactions',
    indexedAt: 1714600000000,
    ...overrides,
  };
}

describe('GET /api/rag/stats', () => {
  it('returns per-kind counts', async () => {
    store.addChunk(makeChunk({chunkId: 'a'}));
    store.addChunk(
      makeChunk({chunkId: 'b', kind: 'aosp', license: 'Apache-2.0'}),
    );
    const res = await request(app).get('/api/rag/stats');
    expect(res.status).toBe(200);
    expect(res.body.stats['androidperformance.com'].chunkCount).toBe(1);
    expect(res.body.stats.aosp.chunkCount).toBe(1);
  });
});

describe('GET / DELETE /api/rag/chunks/:chunkId', () => {
  it('returns a known chunk', async () => {
    store.addChunk(makeChunk({chunkId: 'a'}));
    const res = await request(app).get('/api/rag/chunks/a');
    expect(res.status).toBe(200);
    expect(res.body.chunk.chunkId).toBe('a');
  });

  it('404 on missing chunkId', async () => {
    const res = await request(app).get('/api/rag/chunks/missing');
    expect(res.status).toBe(404);
  });

  it('DELETE removes the chunk', async () => {
    store.addChunk(makeChunk({chunkId: 'a'}));
    const res = await request(app).delete('/api/rag/chunks/a');
    expect(res.status).toBe(200);
    expect(store.getChunk('a')).toBeUndefined();
  });

  it('DELETE returns 404 for missing chunk', async () => {
    const res = await request(app).delete('/api/rag/chunks/missing');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/rag/search', () => {
  beforeEach(() => {
    store.addChunk(
      makeChunk({chunkId: 'a', snippet: 'binder transactions reveal latency'}),
    );
    store.addChunk(
      makeChunk({chunkId: 'b', snippet: 'frame timeline tells the truth'}),
    );
  });

  it('runs a search and returns ranked hits', async () => {
    const res = await request(app)
      .post('/api/rag/search')
      .send({query: 'binder transactions'});
    expect(res.status).toBe(200);
    expect(res.body.result.results.length).toBeGreaterThan(0);
    expect(res.body.result.results[0].chunkId).toBe('a');
  });

  it('respects kinds filter', async () => {
    const res = await request(app)
      .post('/api/rag/search')
      .send({query: 'binder', kinds: ['aosp']});
    expect(res.body.result.results).toHaveLength(0);
  });

  it('400 on missing query', async () => {
    const res = await request(app).post('/api/rag/search').send({});
    expect(res.status).toBe(400);
  });
});
