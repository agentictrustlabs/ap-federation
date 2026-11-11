// The door's `predicate` grade, the parts that need no chain and no verifier: the header is parsed strictly, the proof
// request is the DOOR'S, the predicate digest the door computes is the one the holder's wire names (the same compiled
// program), and the nullifier is consumed in the door's own store AFTER the verifier's verdict — a reused one flips a
// valid verdict to `nullifier_reused`, and a verdict that was not valid consumes nothing. Since Ring 0 spec 445 the
// request also states WHAT THE DOOR TRUSTS (credential types + issuer accounts, both from the register), and the
// challenge is spent only by a proof that verified.
import { describe, expect, it } from 'vitest';
import { compileOpenAcPredicates } from '@agenticprimitives/privacy-credentials';
import { intentDigest } from '@agenticprimitives/delegation';
import { credentialVerify, parsePresentation, parsePresentationRef, predicateDigestOf, presentationRef, proofRequestFor, verifierClient, type DoorCredentialPolicy, acceptedIssuers, issuerOfKey, type RegisterIssuer } from '../src/credential';

const policy: DoorCredentialPolicy = { predicates: [{ claim: 'age', op: 'gte', value: 18 }], claimSchema: ['age', 'roc_birthday'], vcSize: '1k', acceptedVersions: ['0.1.0'], nullifier: { require: true, grade: 'asserted' }, status: 'required' };
const ORIGIN = 'https://door.example';
const SA_ORG = '0x' + 'A1'.repeat(20); const SA_OTHER = '0x' + 'b2'.repeat(20);
const REGISTER = [
  { id: 'org-issuer', estate: 'a', sa: SA_ORG, chainId: 1, facets: [{ keyId: 'issuer-key:sd-jwt:org-issuer-1' }] },
  { id: 'other-issuer', estate: 'b', sa: SA_OTHER, chainId: 1, facets: [{ keyId: 'issuer-key:sd-jwt:other-issuer-1' }] },
] as unknown as RegisterIssuer[];
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const presentation = (payload: Record<string, unknown>) => ({ type: 'PrivatePresentationV1', suite: 'openac-sd-jwt-p256', payload: JSON.stringify({ v: 1, issuerKeyId: 'issuer-key:sd-jwt:x-1', audience: ORIGIN, nonce: '0xab', bundle: 'AAAA', ...payload }) });

describe('the credential presentation, POSTed ahead of the knock', () => {
  it('is parsed strictly: the suite, the shape, the issuer key id', () => {
    const ok = parsePresentation({ presentation: presentation({ nullifier: { audience: ORIGIN, value: '0x01', grade: 'asserted' } }) });
    expect(ok.ok && ok.issuerKeyId).toBe('issuer-key:sd-jwt:x-1');
    expect(parsePresentation(null)).toEqual({ ok: false, code: 'malformed' });
    expect(parsePresentation({ presentation: { ...presentation({}), suite: 'es256-sd-jwt' } })).toEqual({ ok: false, code: 'suite' });
    expect(parsePresentation({ presentation: { ...presentation({}), payload: '{"v":1}' } })).toEqual({ ok: false, code: 'malformed' });
  });
  it('derives a reference the evaluator can resolve back, keyed by the issuer facet; the knock header carries that reference only', async () => {
    const p = presentation({});
    const ref = await presentationRef('issuer-key:sd-jwt:x-1', p as never);
    expect(ref).toMatch(/^credential:issuer-key:sd-jwt:x-1:presentation:[0-9a-f]{32}$/);
    expect(await presentationRef('issuer-key:sd-jwt:x-1', p as never)).toBe(ref);
    expect(parsePresentationRef(ref)).toEqual({ ref, issuerKeyId: 'issuer-key:sd-jwt:x-1' });
    expect(parsePresentationRef(null)).toBeNull();
    expect(parsePresentationRef(b64url({ presentation: p }))).toEqual({ malformed: true });
  });
});

describe('the proof request is the door\'s', () => {
  it('names the door, its policy and its challenge — and its predicate digest is the compiled program\'s', () => {
    const req = proofRequestFor(policy, ORIGIN, { nonce: '0xab', audience: ORIGIN }, REGISTER);
    expect(req).toMatchObject({ suite: 'openac-sd-jwt-p256', verifierId: 'door.example', requestedClaims: [], nonce: '0xab', audience: ORIGIN, openac: { claimSchema: ['age', 'roc_birthday'], vcSize: '1k', acceptedVersions: ['0.1.0'] } });
    const compiled = compileOpenAcPredicates(policy.predicates);
    expect(compiled.ok).toBe(true);
    expect(predicateDigestOf(req)).toBe(intentDigest((compiled as { ok: true; expression: unknown }).expression));
    // the nonce is not part of the program: a holder derives ONE mandate per (audience, program, facet), not per challenge
    expect(predicateDigestOf(proofRequestFor(policy, ORIGIN, { nonce: '0xcd', audience: ORIGIN }, REGISTER))).toBe(predicateDigestOf(req));
  });
  it('445 DATA-7: states the credential types and the issuer ACCOUNTS it trusts — both from the register, neither defaulted', () => {
    const stated = { ...policy, issuers: ['org-issuer'], credentialTypes: ['urn:test:membership'] };
    const req = proofRequestFor(stated, ORIGIN, { nonce: '0xab', audience: ORIGIN }, REGISTER);
    expect(req.credentialTypes).toEqual(['urn:test:membership']);
    // the accounts of the ids the policy names — lower-cased, and never an issuer the policy did not name
    expect(req.acceptedIssuers).toEqual([SA_ORG.toLowerCase()]);
  });
  it('445 DATA-7 twin: a policy that names no type, or no issuer, yields a request that states neither — which the suite refuses; there is no "any"', () => {
    const req = proofRequestFor(policy, ORIGIN, { nonce: '0xab', audience: ORIGIN }, REGISTER);
    expect('credentialTypes' in req).toBe(false);
    expect('acceptedIssuers' in req).toBe(false);
    const unknown = proofRequestFor({ ...policy, issuers: ['not-in-the-register'], credentialTypes: [] }, ORIGIN, { nonce: '0xab', audience: ORIGIN }, REGISTER);
    expect('credentialTypes' in unknown).toBe(false);
    expect('acceptedIssuers' in unknown).toBe(false);
  });
});

describe('one mechanism for the verifier', () => {
  it('refuses a door configured with both the Container binding and a URL, and one with neither', () => {
    expect(verifierClient({ BOUNDARY_ID: 'b', VERIFIER_URL: 'https://v.example', VERIFIER: {} as never, VERIFIER_SECRET: 's' })).toMatchObject({ error: expect.stringContaining('one mechanism') });
    expect(verifierClient({ BOUNDARY_ID: 'b' })).toMatchObject({ error: expect.stringContaining('no verifier') });
    expect(verifierClient({ BOUNDARY_ID: 'b', VERIFIER_URL: 'https://v.example' })).toMatchObject({ error: expect.stringContaining('VERIFIER_SECRET') });
  });
});

describe('the nullifier is the door\'s to consume', () => {
  const chains = { chains: {}, registry: { chainId: 1, address: '0x' + '11'.repeat(20), rpcEnv: 'X' } };
  const client = (verdict: Record<string, unknown>) => ({ placement: 'url' as const, verify: async () => verdict as never, health: async () => ({ ok: true, status: 200, body: null }) });
  const req = proofRequestFor(policy, ORIGIN, { nonce: '0xab', audience: ORIGIN }, REGISTER);
  const freshChallenge = async () => 'CONSUMED' as const;
  it('consumes once per (audience, value); the second is `nullifier_reused`', async () => {
    const seen = new Set<string>();
    const consume = async (ns: string, id: string) => { const k = `${ns}|${id}`; if (seen.has(k)) return 'REPLAY' as const; seen.add(k); return 'CONSUMED' as const; };
    const verify = credentialVerify({ client: client({ valid: true, reason: 'ok', issuerKeyId: 'k', expressionResult: true, nullifier: { audience: ORIGIN, value: '0xAA', grade: 'asserted' } }), issuers: [], chains, policy, consume, consumeChallenge: freshChallenge });
    expect(await verify({}, req)).toMatchObject({ valid: true });
    expect(await verify({}, req)).toMatchObject({ valid: false, reason: 'nullifier_reused' });
    expect([...seen]).toEqual([`nullifier:${ORIGIN}:w${365 * 86400}|0xaa`]);
  });
  it('consumes nothing — no nullifier and no challenge — for a verdict that was not valid', async () => {
    let calls = 0; let challenges = 0;
    const verify = credentialVerify({ client: client({ valid: false, reason: 'status_not_live', nullifier: { audience: ORIGIN, value: '0xBB', grade: 'asserted' } }), issuers: [], chains, policy, consume: async () => { calls++; return 'CONSUMED' as const; }, consumeChallenge: async () => { challenges++; return 'CONSUMED' as const; } });
    expect(await verify({}, req)).toMatchObject({ valid: false, reason: 'status_not_live' });
    expect(calls).toBe(0);
    expect(challenges).toBe(0);
  });
  it('445 DATA-17: the challenge is spent AFTER the proof verifies and BEFORE the nullifier is stored — a junk bundle does not burn it, the genuine one still gets through once, and a second valid answer is `nonce_replayed`', async () => {
    const order: string[] = []; const spent = new Set<string>();
    const consumeChallenge = async (c: { audience: string; nonce: string }) => { order.push('challenge'); const k = `${c.audience}|${c.nonce}`; if (spent.has(k)) return 'REPLAY' as const; spent.add(k); return 'CONSUMED' as const; };
    const consume = async () => { order.push('nullifier'); return 'CONSUMED' as const; };
    const good = { valid: true, reason: 'ok', issuerKeyId: 'k', expressionResult: true, nullifier: { audience: ORIGIN, value: '0xCC', grade: 'asserted' } };
    // 1. junk under the visitor's nonce: refused by the verifier — nothing is written
    const junk = credentialVerify({ client: client({ valid: false, reason: 'proof_invalid' }), issuers: [], chains, policy, consume, consumeChallenge });
    expect(await junk({}, req)).toMatchObject({ valid: false, reason: 'proof_invalid' });
    expect(order).toEqual([]);
    // 2. the genuine presentation under the SAME nonce still verifies — challenge first, then the nullifier
    const genuine = credentialVerify({ client: client(good), issuers: [], chains, policy, consume, consumeChallenge });
    expect(await genuine({}, req)).toMatchObject({ valid: true });
    expect(order).toEqual(['challenge', 'nullifier']);
    // 3. the same challenge answered again: a replay, and the nullifier store is not touched for it
    expect(await genuine({}, req)).toMatchObject({ valid: false, reason: 'nonce_replayed' });
    expect(order).toEqual(['challenge', 'nullifier', 'challenge']);
  });
  it('445 DATA-18: the status policy reaches the verifier as the register states it — never defaulted to "none"', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const spy = { placement: 'url' as const, verify: async (b: unknown) => { sent.push((b as { policy: Record<string, unknown> }).policy); return { valid: false, reason: 'x' } as never; }, health: async () => ({ ok: true, status: 200, body: null }) };
    const { status: _s, ...unstated } = policy;
    await credentialVerify({ client: spy, issuers: [], chains, policy, consume: freshChallenge, consumeChallenge: freshChallenge })({}, req);
    await credentialVerify({ client: spy, issuers: [], chains, policy: unstated, consume: freshChallenge, consumeChallenge: freshChallenge })({}, req);
    expect(sent[0]!.status).toBe('required');
    expect('status' in sent[1]!).toBe(false);
  });
});

describe('the trust set — a door accepts credentials under the issuers it names, and no other', () => {
  const issuers = [
    { id: 'org-issuer', estate: 'a', sa: '0x1', chainId: 1, facets: [{ keyId: 'issuer-key:sd-jwt:org-issuer-1' }] },
    { id: 'other-issuer', estate: 'b', sa: '0x2', chainId: 1, facets: [{ keyId: 'issuer-key:sd-jwt:other-issuer-1' }] },
  ] as unknown as RegisterIssuer[];
  it('filters the register to the policy\'s ids; a policy naming none accepts none', () => {
    const policy = { predicates: [], claimSchema: [], vcSize: '1k', acceptedVersions: [], issuers: ['org-issuer'] } as DoorCredentialPolicy;
    expect(acceptedIssuers(policy, issuers).map((i) => i.id)).toEqual(['org-issuer']);
    expect(acceptedIssuers({ ...policy, issuers: undefined }, issuers)).toEqual([]);
    expect(acceptedIssuers(null, issuers)).toEqual([]);
  });
  it('resolves a presentation\'s facet only within the set', () => {
    const accepted = acceptedIssuers({ predicates: [], claimSchema: [], vcSize: '1k', acceptedVersions: [], issuers: ['org-issuer'] } as DoorCredentialPolicy, issuers);
    expect(issuerOfKey(accepted, 'issuer-key:sd-jwt:org-issuer-1')?.id).toBe('org-issuer');
    expect(issuerOfKey(accepted, 'issuer-key:sd-jwt:other-issuer-1')).toBeNull();
  });
});
