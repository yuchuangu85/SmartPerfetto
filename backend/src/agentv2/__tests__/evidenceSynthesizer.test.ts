import { describe, expect, it } from '@jest/globals';
import { EvidenceSynthesizer } from '../operations/evidenceSynthesizer';
import type { PrincipleDecision } from '../contracts/policy';
import type { Finding } from '../../agent/types';

function createDecision(
  outcome: PrincipleDecision['outcome'],
  reasonCodes?: string[],
): PrincipleDecision {
  return {
    outcome,
    matchedPrincipleIds: ['evidence-first-conclusion'],
    reasonCodes: reasonCodes ?? ['effect.min_evidence.3'],
    policy: {
      allowedDomains: ['frame'],
      requiredDomains: [],
      blockedDomains: [],
      minEvidenceBeforeConclusion: 3,
      maxOperationSteps: 4,
      requireApprovalForActions: [],
      forceReferencedEntityFocus: false,
      contradictionPriorityBoost: 0,
    },
  };
}

function createFinding(description: string): Finding {
  return {
    description,
    confidence: 0.8,
    evidence: [],
  } as unknown as Finding;
}

describe('EvidenceSynthesizer', () => {
  it('does not append principles block for allow outcomes', () => {
    const synthesizer = new EvidenceSynthesizer();
    const output = synthesizer.synthesize({
      originalConclusion: '结论正文',
      findings: [],
      decision: createDecision('allow'),
    });

    expect(output.conclusion).toBe('结论正文');
  });

  it('keeps principles block for non-allow outcomes with no findings', () => {
    const synthesizer = new EvidenceSynthesizer();
    const output = synthesizer.synthesize({
      originalConclusion: '结论正文',
      findings: [],
      decision: createDecision('require_more_evidence'),
    });

    expect(output.conclusion).toContain('## Principles Applied');
    expect(output.conclusion).toContain('Outcome: require_more_evidence');
  });

  it('suppresses stale require_more_evidence when findings were collected', () => {
    const synthesizer = new EvidenceSynthesizer();
    const decision = createDecision('require_more_evidence', [
      'policy.insufficient_evidence',
      'effect.min_evidence.3',
    ]);
    const output = synthesizer.synthesize({
      originalConclusion: '分析完成',
      findings: [createFinding('发现掉帧'), createFinding('CPU 调度延迟')],
      decision,
    });

    // The stale require_more_evidence should be suppressed — conclusion should be clean
    expect(output.conclusion).toBe('分析完成');
    expect(output.conclusion).not.toContain('Principles Applied');
    expect(output.conclusion).not.toContain('require_more_evidence');
  });

  describe('resolveEffectiveDecision', () => {
    const synthesizer = new EvidenceSynthesizer();

    it('overrides require_more_evidence + insufficient_evidence when findings exist', () => {
      const decision = createDecision('require_more_evidence', [
        'policy.insufficient_evidence',
      ]);
      const findings = [createFinding('evidence collected')];

      const result = synthesizer.resolveEffectiveDecision(decision, findings);

      expect(result.outcome).toBe('allow');
      expect(result.reasonCodes).not.toContain('policy.insufficient_evidence');
    });

    it('preserves require_more_evidence when findings are empty', () => {
      const decision = createDecision('require_more_evidence', [
        'policy.insufficient_evidence',
      ]);

      const result = synthesizer.resolveEffectiveDecision(decision, []);

      expect(result.outcome).toBe('require_more_evidence');
      expect(result.reasonCodes).toContain('policy.insufficient_evidence');
    });

    it('does not override deny outcomes even with findings', () => {
      const decision = createDecision('deny', ['policy.blocked_domain']);
      const findings = [createFinding('some finding')];

      const result = synthesizer.resolveEffectiveDecision(decision, findings);

      expect(result.outcome).toBe('deny');
    });

    it('does not override require_approval even with findings', () => {
      const decision = createDecision('require_approval', ['policy.needs_approval']);
      const findings = [createFinding('some finding')];

      const result = synthesizer.resolveEffectiveDecision(decision, findings);

      expect(result.outcome).toBe('require_approval');
    });

    it('does not override require_more_evidence without insufficient_evidence reason', () => {
      const decision = createDecision('require_more_evidence', [
        'some.other.reason',
      ]);
      const findings = [createFinding('some finding')];

      const result = synthesizer.resolveEffectiveDecision(decision, findings);

      expect(result.outcome).toBe('require_more_evidence');
    });

    it('preserves other reasonCodes when filtering insufficient_evidence', () => {
      const decision = createDecision('require_more_evidence', [
        'policy.insufficient_evidence',
        'effect.min_evidence.3',
      ]);
      const findings = [createFinding('evidence')];

      const result = synthesizer.resolveEffectiveDecision(decision, findings);

      expect(result.outcome).toBe('allow');
      expect(result.reasonCodes).toContain('effect.min_evidence.3');
      expect(result.reasonCodes).not.toContain('policy.insufficient_evidence');
    });
  });
});
