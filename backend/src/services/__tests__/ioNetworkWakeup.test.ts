// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import {describe, it, expect} from '@jest/globals';
import {
  aggregateNetworkByEndpoint,
  buildIoNetworkWakeup,
} from '../ioNetworkWakeup';
import {isUnsupported} from '../../types/sparkContracts';

describe('buildIoNetworkWakeup', () => {
  it('passes through facets and stamps coverage', () => {
    const c = buildIoNetworkWakeup({
      range: {startNs: 0, endNs: 1},
      ioEvents: [
        {ts: 0, durNs: 100, op: 'fsync', fs: 'f2fs'},
      ],
      wakelockBaseline: [
        {process: 'app', uid: 1, totalMs: 100, wakeCount: 5},
      ],
    });
    const status15 = c.coverage.find(x => x.sparkId === 15)?.status;
    const status20 = c.coverage.find(x => x.sparkId === 20)?.status;
    expect(status15).toBe('implemented');
    expect(status20).toBe('scaffolded');
  });

  it('marks unsupported when nothing supplied', () => {
    const c = buildIoNetworkWakeup({range: {startNs: 0, endNs: 1}});
    expect(isUnsupported(c)).toBe(true);
  });
});

describe('aggregateNetworkByEndpoint', () => {
  it('aggregates duration and bytes per endpoint, ordered by duration', () => {
    const aggregated = aggregateNetworkByEndpoint([
      {endpoint: 'api.x:443', ts: 0, durNs: 500, bytesIn: 1000, bytesOut: 100},
      {endpoint: 'api.x:443', ts: 0, durNs: 200, bytesIn: 500, bytesOut: 50},
      {endpoint: 'cdn.y:443', ts: 0, durNs: 1000, bytesIn: 5000, bytesOut: 200},
    ]);
    expect(aggregated[0].endpoint).toBe('cdn.y:443');
    expect(aggregated[0].totalDurNs).toBe(1000);
    expect(aggregated[1].endpoint).toBe('api.x:443');
    expect(aggregated[1].totalDurNs).toBe(700);
    expect(aggregated[1].rowCount).toBe(2);
  });

  it('returns [] for empty input', () => {
    expect(aggregateNetworkByEndpoint(undefined)).toEqual([]);
    expect(aggregateNetworkByEndpoint([])).toEqual([]);
  });
});
