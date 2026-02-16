import { describe, expect, it } from '@jest/globals';
import { scrollingStrategy } from '../scrollingStrategy';

describe('scrollingStrategy', () => {
  it('defines analyze_scrolling as focused tool for overview and session_overview stages', () => {
    const overviewTask = scrollingStrategy.stages[0].tasks[0];
    const sessionOverviewTask = scrollingStrategy.stages[1].tasks[0];

    expect(overviewTask.focusTools).toEqual(['analyze_scrolling']);
    expect(sessionOverviewTask.focusTools).toEqual(['analyze_scrolling']);
  });

  it('keeps frame_analysis in direct skill mode with jank_frame_detail', () => {
    const frameAnalysisTask = scrollingStrategy.stages[2].tasks[0];

    expect(frameAnalysisTask.executionMode).toBe('direct_skill');
    expect(frameAnalysisTask.directSkillId).toBe('jank_frame_detail');
  });
});
