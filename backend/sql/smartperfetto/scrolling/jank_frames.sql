-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Copyright (C) 2024-2026 Gracker (Chris)
-- This file is part of SmartPerfetto. See LICENSE for details.
--
-- smartperfetto.scrolling.jank_frames
--
-- Janky-frame extraction view anchored on FrameTimeline ground truth
-- (Spark #16). Returns one row per janky frame with the canonical
-- attribution dimensions used by the scrolling decision tree.

INCLUDE PERFETTO MODULE android.frames.timeline;

CREATE PERFETTO VIEW smartperfetto_scrolling_jank_frames AS
SELECT
  s.surface_frame_token AS frame_id,
  s.ts AS start_ts,
  s.dur AS dur_ns,
  s.ts + s.dur AS end_ts,
  s.jank_type,
  s.process_name,
  s.layer_name,
  s.expected_dur AS expected_dur_ns,
  CASE
    WHEN s.jank_type IS NULL OR s.jank_type = 'None' THEN 0
    ELSE 1
  END AS is_jank
FROM actual_frame_timeline_slice AS s
WHERE s.jank_type IS NOT NULL AND s.jank_type != 'None';
