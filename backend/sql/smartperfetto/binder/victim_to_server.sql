-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Copyright (C) 2024-2026 Gracker (Chris)
-- This file is part of SmartPerfetto. See LICENSE for details.
--
-- smartperfetto.binder.victim_to_server
--
-- Returns binder transaction pairs (client victim ↔ server callee) so the
-- binder root-cause chain analysis can join across processes without
-- re-implementing transaction matching for every skill that needs it.

INCLUDE PERFETTO MODULE android.binder;

CREATE PERFETTO VIEW smartperfetto_binder_victim_to_server AS
SELECT
  client.ts AS client_ts,
  client.dur AS client_dur_ns,
  client.client_pid AS client_pid,
  client.client_tid AS client_tid,
  client.client_process AS client_process,
  client.client_thread AS client_thread,
  client.aidl_name AS client_method,
  server.ts AS server_ts,
  server.dur AS server_dur_ns,
  server.server_pid AS server_pid,
  server.server_tid AS server_tid,
  server.server_process AS server_process,
  server.server_thread AS server_thread
FROM android_binder_client_server_breakdown AS client
JOIN android_binder_server_breakdown AS server
  USING (binder_txn_id);
