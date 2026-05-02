// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {describe, it, expect, beforeEach, afterEach} from '@jest/globals';
import express from 'express';
import request from 'supertest';

import {createMemoryRoutes} from '../memoryRoutes';
import {ProjectMemory} from '../../agentv3/projectMemory';
import {
  type MemoryPromotionPolicy,
  type ProjectMemoryEntry,
} from '../../types/sparkContracts';

let tmpDir: string;
let memory: ProjectMemory;
let app: express.Express;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-routes-test-'));
  memory = new ProjectMemory(path.join(tmpDir, 'memory.json'));
  app = express();
  app.use(express.json({limit: '5mb'}));
  app.use('/api/memory', createMemoryRoutes(memory));
});

afterEach(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, {recursive: true, force: true});
  }
});

function makeEntry(
  overrides: Partial<ProjectMemoryEntry> = {},
): ProjectMemoryEntry {
  return {
    entryId: 'sha256:test001',
    scope: 'project',
    projectKey: 'com.example/pixel',
    tags: ['scrolling'],
    insight: 'Binder S>5ms before doFrame',
    confidence: 0.78,
    status: 'provisional',
    createdAt: 1714600000000,
    ...overrides,
  };
}

describe('GET /api/memory', () => {
  it('lists entries with count', async () => {
    memory.saveProjectMemoryEntry(makeEntry({entryId: 'a'}));
    memory.saveProjectMemoryEntry(makeEntry({entryId: 'b'}));
    const res = await request(app).get('/api/memory');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.entries.map((e: ProjectMemoryEntry) => e.entryId)).toEqual([
      'a',
      'b',
    ]);
  });

  it('respects scope filter', async () => {
    memory.saveProjectMemoryEntry(makeEntry({entryId: 'a', scope: 'project'}));
    memory.saveProjectMemoryEntry(
      makeEntry({
        entryId: 'b',
        scope: 'world',
        promotionPolicy: {
          fromScope: 'project',
          toScope: 'world',
          trigger: 'reviewer_approval',
          reviewer: 'chris',
          promotedAt: 1714600000000,
        },
      }),
    );
    const res = await request(app).get('/api/memory?scope=world');
    expect(res.body.count).toBe(1);
    expect(res.body.entries[0].entryId).toBe('b');
  });

  it('respects projectKey filter', async () => {
    memory.saveProjectMemoryEntry(
      makeEntry({entryId: 'a', projectKey: 'com.example/pixel'}),
    );
    memory.saveProjectMemoryEntry(
      makeEntry({entryId: 'b', projectKey: 'com.other/pixel'}),
    );
    const res = await request(app).get(
      '/api/memory?projectKey=com.example/pixel',
    );
    expect(res.body.count).toBe(1);
    expect(res.body.entries[0].entryId).toBe('a');
  });

  it('ignores invalid scope values silently', async () => {
    memory.saveProjectMemoryEntry(makeEntry({entryId: 'a'}));
    const res = await request(app).get('/api/memory?scope=invalid');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });
});

describe('GET /api/memory/audit', () => {
  it('returns the audit log including post-promotion entries', async () => {
    memory.saveProjectMemoryEntry(makeEntry({entryId: 'a', scope: 'project'}));
    memory.promoteEntry('a', {
      fromScope: 'project',
      toScope: 'world',
      trigger: 'reviewer_approval',
      reviewer: 'chris',
      promotedAt: 1714600000000,
    });
    const res = await request(app).get('/api/memory/audit');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.audit[0].entryId).toBe('a');
    expect(res.body.audit[0].policy.toScope).toBe('world');
  });

  it('returns empty audit when nothing promoted', async () => {
    const res = await request(app).get('/api/memory/audit');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });
});

describe('POST /api/memory/promote', () => {
  const REVIEWER_POLICY: MemoryPromotionPolicy = {
    fromScope: 'project',
    toScope: 'world',
    trigger: 'reviewer_approval',
    reviewer: 'chris',
    promotedAt: 1714600000000,
  };

  it('promotes a project entry to world', async () => {
    memory.saveProjectMemoryEntry(makeEntry({entryId: 'a', scope: 'project'}));
    const res = await request(app)
      .post('/api/memory/promote')
      .send({entryId: 'a', policy: REVIEWER_POLICY});
    expect(res.status).toBe(200);
    expect(res.body.entry.scope).toBe('world');
    expect(res.body.entry.promotionPolicy.trigger).toBe('reviewer_approval');
  });

  it('400 on missing body fields', async () => {
    const res = await request(app).post('/api/memory/promote').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('surfaces auto_inferred trigger rejection as 400', async () => {
    memory.saveProjectMemoryEntry(makeEntry({entryId: 'a', scope: 'project'}));
    const res = await request(app)
      .post('/api/memory/promote')
      .send({
        entryId: 'a',
        policy: {...REVIEWER_POLICY, trigger: 'auto_inferred'},
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/auto-promotion/i);
  });

  it("surfaces 'world without reviewer_approval' rejection as 400", async () => {
    memory.saveProjectMemoryEntry(makeEntry({entryId: 'a', scope: 'project'}));
    const res = await request(app)
      .post('/api/memory/promote')
      .send({
        entryId: 'a',
        policy: {...REVIEWER_POLICY, trigger: 'user_feedback'},
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/scope='world'/);
  });

  it('surfaces missing entry as 400', async () => {
    const res = await request(app)
      .post('/api/memory/promote')
      .send({entryId: 'missing', policy: REVIEWER_POLICY});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found/);
  });
});

describe('DELETE /api/memory/:entryId', () => {
  it('removes an entry and returns 200', async () => {
    memory.saveProjectMemoryEntry(makeEntry({entryId: 'a'}));
    const res = await request(app).delete('/api/memory/a');
    expect(res.status).toBe(200);
    expect(memory.getProjectMemoryEntry('a')).toBeUndefined();
  });

  it('returns 404 for unknown entryId', async () => {
    const res = await request(app).delete('/api/memory/missing');
    expect(res.status).toBe(404);
  });
});
