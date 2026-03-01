import type { Finding } from '../../agent/types';
import type { PrincipleDecision } from '../contracts/policy';

export interface EvidenceSynthesisInput {
  originalConclusion: string;
  findings: Finding[];
  decision: PrincipleDecision;
}

export interface EvidenceSynthesisOutput {
  conclusion: string;
  findings: Finding[];
}

export class EvidenceSynthesizer {
  synthesize(input: EvidenceSynthesisInput): EvidenceSynthesisOutput {
    const normalizedFindings = this.attachPrincipleEvidence(input.findings, input.decision);

    // If execution produced findings, the pre-execution evidence check is stale
    const effectiveDecision = this.resolveEffectiveDecision(input.decision, input.findings);
    const principleSummary = this.buildPrincipleSummary(effectiveDecision);

    const conclusion = principleSummary.length > 0
      ? `${input.originalConclusion}\n\n${principleSummary}`
      : input.originalConclusion;

    return {
      conclusion,
      findings: normalizedFindings,
    };
  }

  /**
   * Reconcile pre-execution PrincipleDecision with post-execution reality.
   *
   * PrincipleEngine evaluates *before* the executor runs, so its evidence
   * snapshot is always 0.  When execution actually produces findings, the
   * `require_more_evidence` + `policy.insufficient_evidence` combination
   * is stale and should be suppressed — otherwise the conclusion carries
   * a misleading "Principles Applied — Outcome: require_more_evidence" block.
   *
   * Only this specific combination is overridden; other outcomes like
   * `deny` or `require_approval` are left untouched.
   */
  resolveEffectiveDecision(
    decision: PrincipleDecision,
    findings: Finding[],
  ): PrincipleDecision {
    if (
      decision.outcome === 'require_more_evidence' &&
      decision.reasonCodes.includes('policy.insufficient_evidence') &&
      findings.length > 0
    ) {
      return {
        ...decision,
        outcome: 'allow',
        reasonCodes: decision.reasonCodes.filter(c => c !== 'policy.insufficient_evidence'),
      };
    }
    return decision;
  }

  private attachPrincipleEvidence(findings: Finding[], decision: PrincipleDecision): Finding[] {
    if (findings.length === 0) {
      return findings;
    }

    const principleEvidence = decision.matchedPrincipleIds.map(id => ({
      principleId: id,
      reasonCodes: decision.reasonCodes,
    }));

    return findings.map(finding => ({
      ...finding,
      evidence: [...(Array.isArray(finding.evidence) ? finding.evidence : []), ...principleEvidence],
    }));
  }

  private buildPrincipleSummary(decision: PrincipleDecision): string {
    // Keep "allow" outputs user-facing and concise.
    // Principle internals remain available via progress events and attached evidence.
    if (decision.outcome === 'allow' || decision.matchedPrincipleIds.length === 0) {
      return '';
    }

    return [
      '## Principles Applied',
      `- Outcome: ${decision.outcome}`,
      `- Matched principles: ${decision.matchedPrincipleIds.join(', ')}`,
      `- Reason codes: ${decision.reasonCodes.join(', ')}`,
    ].join('\n');
  }
}
