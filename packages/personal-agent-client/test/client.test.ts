// gate:pap-twin, at unit scale: our person's agent at a stub company's door (spec 443 §1.1 / §4; Ring 0 spec 442).
import { describe, expect, it, beforeEach } from 'vitest';
import { LocalEs256Signer, type ExternalAccountLinkV1 } from '@agenticprimitives/key-custody';
import type { ClientKeyBindingV1 } from '@agenticprimitives/agent-profile';
import { externalOperationIntentDigest, type ExternalOperationAuthorityFacts } from '@agenticprimitives/intent-engagement';
import { createPersonalAgentClient, type ParkedExternalOperation, type Session } from '../src/index.js';
import { stubCompany } from './stub-company.js';

process.env.A2A_ALLOW_LOCAL_DEVICE_KEY = 'true';
const PERSON_SA = '0x1111111111111111111111111111111111111111';
const PAP_SVC = 'eip155:34348:0x2222222222222222222222222222222222222222';
let now = 1_760_000_000;
const clock = () => now;

function world(opts: { requireNonce?: boolean; naming?: string } = {}) {
  const clientSigner = new LocalEs256Signer({ privateKeyHex: '11'.repeat(32) });
  const binding: ClientKeyBindingV1 = { canonicalAgentId: PAP_SVC, scope: 'service', clientId: 'https://pap.estate.example/client.json', jwkThumbprint: clientSigner.kid, alg: 'ES256', custodyEpoch: 1, notBefore: now - 10, notAfter: now + 90 * 86400 };
  const company = stubCompany({ domain: 'acme.example', issuer: 'https://auth.acme.example', clientJwks: async () => [clientSigner.publicJwk()], requireNonce: opts.requireNonce, now: clock });
  const links = new Map<string, ExternalAccountLinkV1>();
  const sealed = new Map<string, string>();
  const dpopKeys = new Map<string, LocalEs256Signer & { keyRef: string }>();
  let parkedActs: ParkedExternalOperation[] = [];
  let answer: ExternalOperationAuthorityFacts | null = null;
  const client = createPersonalAgentClient({
    clientKey: { binding, signer: clientSigner, redirectUris: ['https://www.estate.example/oauth/return'] },
    dpopKeys: { forIssuer: async (iss) => { let k = dpopKeys.get(iss); if (!k) { k = Object.assign(new LocalEs256Signer(), { keyRef: `kms:estate:dpop:${iss}` }); dpopKeys.set(iss, k); } return k; } },
    vault: {
      pairwiseSecret: async () => new Uint8Array(32).map((_, i) => i + 1),
      subjectDigestKey: async () => new Uint8Array(32).map((_, i) => 99 - i),
      readLink: async (iss) => links.get(iss) ?? null, writeLink: async (l) => { links.set(l.issuer, l); },
      seal: async (s) => { const ref = `vault:sealed:${sealed.size + 1}`; sealed.set(ref, s); return ref; }, unseal: async (ref) => sealed.get(ref)!,
    },
    approval: { park: async (act) => { parkedActs.push(act); return answer; } },
    proofs: { identity: async (ref) => `jws.by.${PERSON_SA}.over.${ref.operationId}.${ref.revision}` },
    posture: { naming: opts.naming ?? 'none', listing: 'none' },
    fetch: company.fetch, now: clock, random: (n) => new Uint8Array(n).map(() => Math.floor(Math.random() * 256)),
  });
  return { client, company, links, sealed, parked: () => parkedActs, setAnswer: (a: ExternalOperationAuthorityFacts | null) => { answer = a; }, resetParked: () => { parkedActs = []; } };
}

async function signedIn(w: ReturnType<typeof world>) {
  const d = await w.client.discover('acme.example'); if (!d.ok) throw new Error(d.refusal);
  const s = await w.client.startSession(d.company); if (!s.ok) throw new Error(s.error);
  const dev = await w.client.signIn.device.start(d.company, ['poppy:read', 'poppy:write']); if ('refusal' in dev) throw new Error(dev.refusal);
  w.company.approveDevice();
  const si = await w.client.signIn.device.poll(d.company, s.session, dev); if (!si.ok) throw new Error(si.error);
  return { company: d.company, session: si.session };
}

describe('personal-agent-client — the twin at unit scale', () => {
  beforeEach(() => { now = 1_760_000_000; });

  it('discovers the company the way PAP 3.1–3.2 says, and refuses a document that fails a check', async () => {
    const w = world();
    const d = await w.client.discover('acme.example');
    expect(d.ok).toBe(true);
    if (d.ok) { expect(d.company.issuer).toBe('https://auth.acme.example'); expect(d.company.operationsEndpoint).toBe('https://auth.acme.example/poppy/operations'); }
    const bad = await w.client.discover('other.example');
    expect(bad.ok).toBe(false);
  });

  it('starts a signed-out session: RFC 7523 assertions the company verified against the JWKS, DPoP-bound; the subject is pairwise and the person appears nowhere', async () => {
    const w = world();
    const d = await w.client.discover('acme.example'); if (!d.ok) throw new Error(d.refusal);
    const s = await w.client.startSession(d.company);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.session.signedIn).toBe(false);
    expect(s.session.tokenType).toBe('DPoP');
    const sub = await w.client.subjectAt(d.company);
    expect(sub).toMatch(/^usr_[A-Za-z0-9_-]{22}$/);
    expect(w.company.sessions.get(s.session.sessionId)?.sub).toBe(sub);
    const everything = JSON.stringify(w.company.requests);
    expect(everything.toLowerCase()).not.toContain(PERSON_SA.slice(2));
    expect(everything).not.toContain('alice');
    // renewal keeps the session; the same person at ANOTHER company is another subject
    const r = await w.client.startSession(d.company, { sessionId: s.session.sessionId });
    expect(r.ok && r.session.sessionId).toBe(s.session.sessionId);
    const w2 = world(); const d2 = await w2.client.discover('acme.example'); if (!d2.ok) throw new Error(d2.refusal);
    const other = { ...d2.company, issuer: 'https://auth.bravo.example' };
    expect(await w2.client.subjectAt(other)).not.toBe(sub);
  });

  it('honours the DPoP nonce dance at the token endpoint and at APIs', async () => {
    const w = world({ requireNonce: true });
    const { company, session } = await signedIn(w);
    expect(session.signedIn).toBe(true);
    const op = w.company.propose(session.sessionId, 'Exchange the jacket for size L', { order_id: 'ord_1', size: 'L' });
    const r = await w.client.operations.read(company, session, op.operation_id);
    expect(r.ok).toBe(true);
  });

  it('device sign-in is a Home ceremony that ends in a SEALED account token and an ExternalAccountLinkV1; the token never sits in the record', async () => {
    const w = world();
    const { company } = await signedIn(w);
    const link = w.links.get(company.issuer)!;
    expect(link.status).toBe('active');
    expect(link.signInKind).toBe('device');
    expect(link.accountToken.sealedRef).toMatch(/^vault:sealed:/);
    expect(JSON.stringify(link)).not.toContain('pat_');
    expect(link.pairwiseSubjectDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(link)).not.toContain(await w.client.subjectAt(company));
    // a signed-in session later, from the vault, without asking the person again
    const again = await w.client.signedInSession(company);
    expect(again.ok && again.session.signedIn).toBe(true);
  });

  it('GATE: mediated sign-in is refused; an operator policy for ANOTHER issuer does not open it', () => {
    const w = world();
    const company = { issuer: 'https://auth.acme.example' } as never;
    expect('refusal' in w.client.signIn.mediated(company)).toBe(true);
    const w2 = createPersonalAgentClient({ ...(w as never as { client: never }), clientKey: { binding: { canonicalAgentId: PAP_SVC, scope: 'service', clientId: 'https://pap.estate.example/client.json', jwkThumbprint: 'x', alg: 'ES256', custodyEpoch: 1, notBefore: 0, notAfter: 1 }, signer: new LocalEs256Signer(), redirectUris: [] }, dpopKeys: { forIssuer: async () => Object.assign(new LocalEs256Signer(), { keyRef: 'k' }) }, vault: {} as never, approval: { park: async () => null }, posture: { naming: 'none', listing: 'none' }, operatorPolicy: { allowMediatedSignIn: { policyRef: 'ops:1', allowedIssuers: ['https://auth.other.example'] } } });
    expect('refusal' in w2.signIn.mediated(company)).toBe(true);
  });

  it("GATE: an operation parks; nothing but a verified mandate over THIS ref's digest produces approved_by: user", async () => {
    const w = world();
    const { company, session } = await signedIn(w);
    const op = w.company.propose(session.sessionId, 'Exchange the jacket for size L, $20 more', { order_id: 'ord_1', size: 'L', price_difference: '20.00' });
    const parked = await w.client.operations.confirm(company, session, op as never);
    expect(parked.kind).toBe('parked');
    expect(w.company.operations.get(op.operation_id)?.state).toBe('proposed');
    const act = w.parked()[0]!;
    expect(act.companyName).toBe('Acme Books');
    expect(act.summary).toContain('size L');
    // a mandate over ANOTHER digest is not approval
    w.setAnswer({ mandateVerifiedForIntentDigest: `0x${'ab'.repeat(32)}` });
    expect((await w.client.operations.confirm(company, session, op as never)).kind).toBe('parked');
    // the person signed THIS one
    w.setAnswer({ mandateVerifiedForIntentDigest: externalOperationIntentDigest(act.ref) });
    const c = await w.client.operations.confirm(company, session, op as never);
    expect(c.kind).toBe('confirmed');
    if (c.kind !== 'confirmed') return;
    expect(c.approvedBy).toBe('user');
    expect(c.runState).toBe('completed');
    expect(w.company.operations.get(op.operation_id)?.confirmation?.approved_by).toBe('user');
    expect(c.result.ok && c.result.operation.result?.summary).toContain('Done');
  });

  it('GATE: standing_permission only from a covering wire; refused when the company requires user approval; a second confirm of the same revision is refused here and idempotent there', async () => {
    const w = world();
    const { company, session } = await signedIn(w);
    const op = w.company.propose(session.sessionId, 'Reorder coffee, $18', { sku: 'coffee-1kg', qty: 1 });
    const first = await w.client.operations.confirm(company, session, op as never);
    const ref = w.parked()[0]!.ref;
    w.setAnswer({ coveringStandingWire: { wireRef: 'wire:coffee', coversIntentDigest: externalOperationIntentDigest(ref) } });
    const c = await w.client.operations.confirm(company, session, op as never);
    expect(first.kind).toBe('parked');
    expect(c.kind).toBe('confirmed');
    if (c.kind === 'confirmed') expect(c.approvedBy).toBe('standing_permission');
    const again = await w.client.operations.confirm(company, session, op as never);
    expect(again.kind).toBe('refused');
    if (again.kind === 'refused') expect(again.reason).toBe('ALREADY_CONFIRMED_BY_THIS_CLIENT');
    // user_approval_required: the wire is not enough
    const op2 = w.company.propose(session.sessionId, 'Cancel the subscription', { sub: 's_1' }, { user_approval_required: true });
    w.resetParked();
    await w.client.operations.confirm(company, session, op2 as never);
    const ref2 = w.parked()[0]!.ref;
    w.setAnswer({ coveringStandingWire: { wireRef: 'wire:any', coversIntentDigest: externalOperationIntentDigest(ref2) } });
    const r2 = await w.client.operations.confirm(company, session, op2 as never);
    expect(r2.kind).toBe('refused');
    if (r2.kind === 'refused') expect(r2.reason).toBe('STANDING_NOT_ALLOWED_FOR_REVISION');
  });

  it('GATE: a new revision is a new intent — the old mandate covers nothing of it; cancel declines a proposal', async () => {
    const w = world();
    const { company, session } = await signedIn(w);
    const op = w.company.propose(session.sessionId, 'Jacket size M', { size: 'M' });
    await w.client.operations.confirm(company, session, op as never);
    const ref1 = w.parked()[0]!.ref;
    w.setAnswer({ mandateVerifiedForIntentDigest: externalOperationIntentDigest(ref1) });
    const revised = w.company.revise(op.operation_id, { size: 'L' }, 'Jacket size L');
    const r = await w.client.operations.confirm(company, session, revised as never);
    expect(r.kind).toBe('parked');
    expect(w.parked().at(-1)!.ref.revision).toBe(2);
    expect(externalOperationIntentDigest(w.parked().at(-1)!.ref)).not.toBe(externalOperationIntentDigest(ref1));
    const cancelled = await w.client.operations.cancel(company, session, op.operation_id);
    expect(cancelled.ok && cancelled.operation.state).toBe('cancelled');
  });

  it('GATE: the identity proof grade is refused for a nameless person and sent for a public one', async () => {
    const w = world();
    const { company, session } = await signedIn(w);
    const op = w.company.propose(session.sessionId, 'Book the room', { room: 7 });
    await w.client.operations.confirm(company, session, op as never);
    w.setAnswer({ mandateVerifiedForIntentDigest: externalOperationIntentDigest(w.parked()[0]!.ref) });
    const r = await w.client.operations.confirm(company, session, op as never, 'identity');
    expect(r.kind).toBe('refused');
    if (r.kind === 'refused') expect(r.reason).toBe('PROOF_GRADE_NOT_ALLOWED');
    const wp = world({ naming: 'public' });
    const sp = await signedIn(wp);
    const op2 = wp.company.propose(sp.session.sessionId, 'Book the room', { room: 7 });
    await wp.client.operations.confirm(sp.company, sp.session, op2 as never);
    wp.setAnswer({ mandateVerifiedForIntentDigest: externalOperationIntentDigest(wp.parked()[0]!.ref) });
    const r2 = await wp.client.operations.confirm(sp.company, sp.session, op2 as never, 'identity');
    expect(r2.kind).toBe('confirmed');
    expect(wp.company.operations.get(op2.operation_id)?.confirmation?.proof_received).toBe(true);
  });

  it('sign-out revokes at the company and RETIRES the link (never a quiet delete); afterwards signed-in sessions are refused as signed out', async () => {
    const w = world();
    const { company } = await signedIn(w);
    const r = await w.client.signOut(company);
    expect(r.ok && r.companyNotified).toBe(true);
    const link = w.links.get(company.issuer)!;
    expect(link.status).toBe('revoked');
    expect(link.revocation?.companyNotified).toBe(true);
    const s = await w.client.signedInSession(company);
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.error).toBe('signed_out');
  });

  it("refuses to be built as a scope:'person' client for a non-public person", () => {
    const w = world();
    expect(() => createPersonalAgentClient({ clientKey: { binding: { canonicalAgentId: PAP_SVC, scope: 'person', clientId: 'https://www.estate.example/agents/alice/client.json', jwkThumbprint: 'x', alg: 'ES256', custodyEpoch: 1, notBefore: 0, notAfter: 1 }, signer: new LocalEs256Signer(), redirectUris: [] }, dpopKeys: { forIssuer: async () => Object.assign(new LocalEs256Signer(), { keyRef: 'k' }) }, vault: {} as never, approval: { park: async () => null }, posture: { naming: 'none', listing: 'none' }, fetch: w.company.fetch })).toThrow(/never|service/);
  });
});
