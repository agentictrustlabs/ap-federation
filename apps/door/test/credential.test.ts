// The door's `predicate` grade, the parts that need no chain and no verifier: the header is parsed strictly, the proof
// request is the DOOR'S, the predicate digest the door computes is the one the holder's wire names (the same compiled
// program), and the nullifier is consumed in the door's own store AFTER the verifier's verdict — a reused one flips a
// valid verdict to `nullifier_reused`, and a verdict that was not valid consumes nothing.
import { describe, expect, it } from 'vitest';
import { compileOpenAcPredicates } from '@agenticprimitives/privacy-credentials';
import { intentDigest } from '@agenticprimitives/delegation';
import { credentialVerify, parsePresentationHeader, predicateDigestOf, presentationRef, proofRequestFor, verifierClient, type DoorCredentialPolicy } from '../src/credential';

const policy: DoorCredentialPolicy = { predicates: [{ claim: 'age', op: 'gte', value: 18 }], claimSchema: ['age', 'roc_birthday'], vcSize: '1k', acceptedVersions: ['0.1.0'], nullifier: { require: true, grade: 'asserted' }, status: 'required' };
const ORIGIN = 'https://door.example';
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const presentation = (payload: Record<string, unknown>) => ({ type: 'PrivatePresentationV1', suite: 'openac-sd-jwt-p256', payload: JSON.stringify({ v: 1, issuerKeyId: 'issuer-key:sd-jwt:x-1', audience: ORIGIN, nonce: '0xab', bundle: 'AAAA', ...payload }) });

describe('the credential presentation header', () => {
  it('is parsed strictly: the suite, the shape, the issuer key id', () => {
    const ok = parsePresentationHeader(b64url({ presentation: presentation({ nullifier: { audience: ORIGIN, value: '0x01', grade: 'asserted' } }) }));
    expect(ok && ok.ok && ok.issuerKeyId).toBe('issuer-key:sd-jwt:x-1');
    expect(ok && ok.ok && ok.nullifier?.value).toBe('0x01');
    expect(parsePresentationHeader(null)).toBeNull();
    expect(parsePresentationHeader('not-base64url-json')).toEqual({ ok: false, code: 'malformed' });
    expect(parsePresentationHeader(b64url({ presentation: { ...presentation({}), suite: 'es256-sd-jwt' } }))).toEqual({ ok: false, code: 'suite' });
    expect(parsePresentationHeader(b64url({ presentation: { ...presentation({}), payload: '{"v":1}' } }))).toEqual({ ok: false, code: 'malformed' });
  });
  it('derives a reference the evaluator can resolve back, keyed by the issuer facet', async () => {
    const p = presentation({});
    const ref = await presentationRef('issuer-key:sd-jwt:x-1', p as never);
    expect(ref).toMatch(/^credential:issuer-key:sd-jwt:x-1:presentation:[0-9a-f]{32}$/);
    expect(await presentationRef('issuer-key:sd-jwt:x-1', p as never)).toBe(ref);
  });
});

describe('the proof request is the door\'s', () => {
  it('names the door, its policy and its challenge — and its predicate digest is the compiled program\'s', () => {
    const req = proofRequestFor(policy, ORIGIN, { nonce: '0xab', audience: ORIGIN });
    expect(req).toMatchObject({ suite: 'openac-sd-jwt-p256', verifierId: 'door.example', requestedClaims: [], nonce: '0xab', audience: ORIGIN, openac: { claimSchema: ['age', 'roc_birthday'], vcSize: '1k', acceptedVersions: ['0.1.0'] } });
    const compiled = compileOpenAcPredicates(policy.predicates);
    expect(compiled.ok).toBe(true);
    expect(predicateDigestOf(req)).toBe(intentDigest((compiled as { ok: true; expression: unknown }).expression));
    // the nonce is not part of the program: a holder derives ONE mandate per (audience, program, facet), not per challenge
    expect(predicateDigestOf(proofRequestFor(policy, ORIGIN, { nonce: '0xcd', audience: ORIGIN }))).toBe(predicateDigestOf(req));
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
  const req = proofRequestFor(policy, ORIGIN, { nonce: '0xab', audience: ORIGIN });
  it('consumes once per (audience, value); the second is `nullifier_reused`', async () => {
    const seen = new Set<string>();
    const consume = async (ns: string, id: string) => { const k = `${ns}|${id}`; if (seen.has(k)) return 'REPLAY' as const; seen.add(k); return 'CONSUMED' as const; };
    const verify = credentialVerify({ client: client({ valid: true, reason: 'ok', issuerKeyId: 'k', expressionResult: true, nullifier: { audience: ORIGIN, value: '0xAA', grade: 'asserted' } }), issuers: [], chains, policy, consume });
    expect(await verify({}, req)).toMatchObject({ valid: true });
    expect(await verify({}, req)).toMatchObject({ valid: false, reason: 'nullifier_reused' });
    expect([...seen]).toEqual([`nullifier:${ORIGIN}|0xaa`]);
  });
  it('consumes nothing for a verdict that was not valid', async () => {
    let calls = 0;
    const verify = credentialVerify({ client: client({ valid: false, reason: 'status_not_live', nullifier: { audience: ORIGIN, value: '0xBB', grade: 'asserted' } }), issuers: [], chains, policy, consume: async () => { calls++; return 'CONSUMED' as const; } });
    expect(await verify({}, req)).toMatchObject({ valid: false, reason: 'status_not_live' });
    expect(calls).toBe(0);
  });
});
