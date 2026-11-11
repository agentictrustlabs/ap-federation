// THE DOOR'S ADMISSION POLICY, AS IT IS COMPOSED IN `src/index.ts` — the engine with this door's two evaluators and this
// door's accepted audience — without a chain and without a verifier (Ring 0 spec 445, ING-2).
//
// Three things `src/index.ts` now depends on and nothing else in this repository's offline tests showed:
//   1. request proofs here are signed for the door's PUBLIC ORIGIN, so the engine is told the origin is the accepted
//      audience — with the engine's default (`[boundaryId]`) every knock is refused;
//   2. a visitor who authenticates and cites NOTHING is refused: both evaluators abstain, and an abstention is not an
//      affirmative opinion (the visitor used to be admitted "as nobody-foreign" and forwarded);
//   3. one affirmative evaluator plus one abstention still admits — a credential visitor cites no foreign presentation.
import { describe, expect, it } from 'vitest';
import { createAdmissionEngine, credentialPresentationEvaluator, foreignEstateEvaluator, type AdmissionRequest } from '@agenticprimitives/admission';

const ORIGIN = 'https://door.example';
const BOUNDARY = 'urn:ap:boundary:door-test';
const NOW = new Date('2026-11-10T12:00:00.000Z');
const nowSec = Math.floor(NOW.getTime() / 1000);
const VISITOR = '0x' + '7a'.repeat(20);
const DECLARED_SIGNER = ('0x' + '5e'.repeat(20)) as `0x${string}`;
const ESTATE = '0x' + 'e5'.repeat(32);
const PRES_REF = `estate:${ESTATE}:presentation:${'ab'.repeat(16)}`;
const CRED_REF = `credential:issuer-key:sd-jwt:org-1:presentation:${'cd'.repeat(16)}`;

const audit = { append: async () => ({ receiptRef: 'rcpt-test', recordHash: 'sha256:00' }) };
const foreign = (verdict: 'member' | 'refuse' = 'member') => foreignEstateEvaluator({
  resolvePresentation: async (ref) => (ref === PRES_REF ? { estateId: ESTATE } : null),
  declaredSigner: async () => DECLARED_SIGNER,
  readRoots: async (estateId, signer) => ({ estateId, signer, sequence: 3, liveGrantRoot: `0x${'11'.repeat(32)}`, membershipRoot: `0x${'22'.repeat(32)}`, anchoredAt: nowSec - 60 }),
  verify: async () => (verdict === 'member' ? { ok: true, estateId: ESTATE as `0x${string}`, set: 'live-grant', sequence: 3, subject: VISITOR as `0x${string}`, grade: 'standing' } : { ok: false, code: 'opening_mismatch', reason: 'not this subject' }),
  challengeFor: () => ({ nonce: `0x${'33'.repeat(32)}`, audience: ORIGIN }),
  maxAgeSeconds: 86400,
  now: () => nowSec,
});
const credential = () => credentialPresentationEvaluator({
  resolve: async (ref) => (ref === CRED_REF ? { presentation: {}, request: { audience: ORIGIN, nonce: `0x${'33'.repeat(32)}` } } : null),
  verify: async () => ({ valid: true, reason: 'ok', issuerKeyId: 'issuer-key:sd-jwt:org-1', expressionResult: true }),
  predicateDigestOf: () => `0x${'44'.repeat(32)}`,
  now: () => nowSec,
});
const engine = (o: { acceptedAudiences?: string[]; withCredential?: boolean; foreignVerdict?: 'member' | 'refuse' } = {}) => createAdmissionEngine({
  boundaryId: BOUNDARY, audit, sign: async (d) => `test:${d}`, grantTtlSeconds: 300, now: () => NOW,
  ...(o.acceptedAudiences ? { acceptedAudiences: o.acceptedAudiences } : {}),
  evaluators: [...(o.withCredential ? [credential()] : []), foreign(o.foreignVerdict)],
});
/** The request `admit()` builds: a request proof signed for the door's ORIGIN, the references the visitor cited. */
const request = (o: { pres?: boolean; cred?: boolean; audience?: string } = {}): AdmissionRequest => {
  const at = NOW.toISOString();
  const agent = `eip155:34348:${VISITOR}`;
  const claims = {
    schemaVersion: '1', principalAgentId: agent, actingAgentId: agent, runtimeId: 'urn:ap:runtime:test', sessionKeyId: VISITOR, delegationRefs: o.pres ? [PRES_REF] : [],
    audience: o.audience ?? ORIGIN, issuedAt: nowSec - 5, expiresAt: nowSec + 115, replayId: 'r-1',
    http: { method: 'POST', authority: 'door.example', pathAndQuery: '/federation/knock', bodySha256: 'sha256:00' },
    a2a: { protocolVersion: '1.0', protocolBinding: 'HTTP+JSON', operation: 'SendMessage' },
  };
  return {
    schemaVersion: '1', requestId: 'req-1', receivedAt: at, boundaryId: BOUNDARY, targetAgentId: 'eip155:34348:0x' + '99'.repeat(20), targetRuntimeId: 'urn:ap:runtime:target',
    actor: { principalAgentId: agent, actingAgentId: agent, runtimeId: claims.runtimeId, authenticationMethods: ['AGENTIC_REQUEST_PROOF'], resolvedAt: at, cacheUntil: at, evidenceRefs: ['sha256:proof'] },
    transport: { protocol: 'HTTPS', mtls: false, assurance: 'HTTPS' },
    authentication: { requestProof: { keyId: VISITOR, proofDigest: 'sha256:proof', replayId: claims.replayId, issuedAt: new Date(claims.issuedAt * 1000).toISOString(), expiresAt: new Date(claims.expiresAt * 1000).toISOString(), claims } },
    a2a: { protocolVersion: '1.0', protocolBinding: 'HTTP+JSON', operation: 'SendMessage' },
    relationshipRefs: [], delegationRefs: o.pres ? [PRES_REF] : [], entitlementRefs: o.cred ? [CRED_REF] : [],
    situation: { timestamp: at, environment: 'prod' },
  } as unknown as AdmissionRequest;
};

describe('the door admits on evidence addressed to its origin (445 ING-2)', () => {
  it('a foreign presentation, on a proof signed for the door\'s origin, is admitted when the origin is the accepted audience', async () => {
    const d = await engine({ acceptedAudiences: [ORIGIN] }).evaluate(request({ pres: true }));
    expect(d.effect).toBe('ADMIT');
    expect(d.reasonCodes).toContain('FOREIGN_ESTATE_LIVE_GRANT');
  });
  it('TWIN: the same knock under the engine\'s DEFAULT audience (the boundary id) is refused — why `acceptedAudiences: [PUBLIC_ORIGIN]` is not optional here', async () => {
    const d = await engine().evaluate(request({ pres: true }));
    expect(d.effect).toBe('DENY');
    expect(d.reasonCodes).toContain('REQUEST_AUDIENCE_MISMATCH');
  });
  it('TWIN: a proof signed for another door is refused by the engine, before any evaluator', async () => {
    const d = await engine({ acceptedAudiences: [ORIGIN] }).evaluate(request({ pres: true, audience: 'https://another.door.example' }));
    expect(d.effect).toBe('DENY');
    expect(d.reasonCodes).toContain('REQUEST_AUDIENCE_MISMATCH');
    expect(d.contributions).toEqual([]);
  });
});

describe('no evidence, no admission (445 ING-2)', () => {
  it('a visitor who authenticates and cites nothing is REFUSED: every evaluator abstains, and that is not consent', async () => {
    for (const withCredential of [false, true]) {
      const d = await engine({ acceptedAudiences: [ORIGIN], withCredential }).evaluate(request());
      expect(d.effect).toBe('DENY');
      expect(d.reasonCodes).toEqual(expect.arrayContaining(['FOREIGN_ESTATE_NOT_PRESENTED', 'NO_AFFIRMATIVE_OPINION']));
      expect(d.contributions.every((c) => c.effect === 'ABSTAIN')).toBe(true);
    }
  });
  it('a credential visitor is admitted on the credential alone: one affirmative opinion, the foreign-estate stage abstains', async () => {
    const d = await engine({ acceptedAudiences: [ORIGIN], withCredential: true }).evaluate(request({ cred: true }));
    expect(d.effect).toBe('ADMIT');
    expect(d.reasonCodes).toContain('CREDENTIAL_PREDICATE_HELD');
    expect(d.contributions.map((c) => c.effect).sort()).toEqual(['ABSTAIN', 'ALLOW']);
  });
  it('TWIN: an abstention never outvotes a refusal — a held credential beside a refused presentation is a DENY', async () => {
    const d = await engine({ acceptedAudiences: [ORIGIN], withCredential: true, foreignVerdict: 'refuse' }).evaluate(request({ cred: true, pres: true }));
    expect(d.effect).toBe('DENY');
    expect(d.reasonCodes).toContain('FOREIGN_ESTATE_OPENING_MISMATCH');
  });
});
