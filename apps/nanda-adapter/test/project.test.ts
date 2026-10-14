import { describe, expect, it } from 'vitest';
import { projectToIndexEntry, readIndexEntry, AIR_URN } from '../src/project';
import { NANDA_MEDIA_TYPE } from '../src/types';

// The faithchain town's live card, trimmed to the fields the projection reads (fetched 2026-10-14).
const CARD = {
  name: 'faithchain town',
  description: 'What this town offers, and whether each service is up.',
  version: '0.1.0',
  provider: { organization: 'The faithchain town', url: 'https://town.faithnet.io' },
  supportedInterfaces: [{ url: 'https://town.faithnet.io/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
  capabilities: { streaming: false },
  skills: [
    { id: 'town.describe', name: 'Describe the town', tags: ['town', 'directory', 'health'] },
    { id: 'town.service', name: 'One service', tags: ['directory', 'health'] },
  ],
  signatures: [{ protected: 'x', signature: 'y' }],
} as const;
const base = { card: CARD as never, cardUrl: 'https://town.faithnet.io/.well-known/agent-card.json', publisherDomain: 'faithnet.io', shortName: 'town' };

describe('the entry', () => {
  it('is an ARD URN, the A2A card media type, and a pointer at the card — never a copy of it', () => {
    const r = projectToIndexEntry(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entry.identifier).toBe('urn:air:faithnet.io:agent:town');
    expect(AIR_URN.test(r.entry.identifier)).toBe(true);
    expect(r.entry.type).toBe(NANDA_MEDIA_TYPE.a2aAgentCard);
    expect(r.entry.url).toBe(base.cardUrl);
    expect(r.entry.publisher).toEqual({ identifier: 'faithnet.io', displayName: 'The faithchain town', identityType: 'domain' });
    expect(JSON.stringify(r.entry)).not.toContain('"signatures"');
  });
  it('tags come from the skills the agent already published, deduplicated and sorted', () => {
    const r = projectToIndexEntry(base);
    expect(r.ok && r.entry.tags).toEqual(['directory', 'health', 'town']);
  });
  it('writes only under our own extension namespace, and says in the record that it grants nothing', () => {
    const r = projectToIndexEntry({ ...base, canonical: { agentId: 'eip155:34348:0xabc', estate: 'faithnet', chainId: 34348 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.entry.extensions ?? {})).toEqual(['dev.agenticprimitives']);
    expect(String(r.entry.extensions!['dev.agenticprimitives']!.authority)).toMatch(/listing|mandate/);
  });
});

describe('the loss report — what the index cannot carry, named rather than dropped', () => {
  it('always names authority, and names the signature, the canonical identity, the estate and the skills when they exist', () => {
    const r = projectToIndexEntry({ ...base, canonical: { agentId: 'eip155:34348:0xabc', estate: 'faithnet', chainId: 34348 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const codes = r.loss.map((l) => l.code);
    expect(codes).toContain('authority-not-carried');
    expect(codes).toContain('signature-not-carried');
    expect(codes).toContain('canonical-identity-not-carried');
    expect(codes).toContain('estate-not-carried');
    expect(codes).toContain('skill-detail-not-carried');
    for (const l of r.loss) expect(l.insteadRead.length).toBeGreaterThan(10);
  });
  it('names authority even for the barest card — a listing never carries one', () => {
    const r = projectToIndexEntry({ ...base, card: { name: 'bare' } as never });
    expect(r.ok && r.loss.map((l) => l.code)).toEqual(['authority-not-carried']);
  });
  it('the codes are mirrored into the entry, so a reader of the index sees that something was left behind', () => {
    const r = projectToIndexEntry(base);
    expect(r.ok && (r.entry.extensions!['dev.agenticprimitives']!.lossReportCodes as string[])).toContain('authority-not-carried');
  });
});

describe('refusals — a projection that guessed would publish a claim nobody made', () => {
  it('refuses a publisher that is not a domain, a bad short name, a non-https card URL and a nameless card', () => {
    expect(projectToIndexEntry({ ...base, publisherDomain: 'localhost' }).ok).toBe(false);
    expect(projectToIndexEntry({ ...base, shortName: 'Town Agent' }).ok).toBe(false);
    expect(projectToIndexEntry({ ...base, cardUrl: 'http://town.faithnet.io/card.json' }).ok).toBe(false);
    const nameless = projectToIndexEntry({ ...base, card: {} as never });
    expect(nameless.ok).toBe(false);
    if (!nameless.ok) expect(nameless.refusals.join(' ')).toContain('no name');
  });
  it('never emits the retired urn:ai: form', () => {
    const r = projectToIndexEntry(base);
    expect(r.ok && r.entry.identifier.startsWith('urn:air:')).toBe(true);
  });
});

describe('reading one back', () => {
  it('says what an entry is evidence of, and what it is not', () => {
    const r = projectToIndexEntry(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const read = readIndexEntry(r.entry);
    expect(read.isApCard).toBe(true);
    expect(read.publisherDomain).toBe('faithnet.io');
    expect(read.says).toMatch(/not evidence|estate/);
  });
});

// ─── Reading the index back (spec 439 §5's discovery row) ───────────────────────────────────────────

describe('assessing a listing the way a stranger would', () => {
  const entry = {
    identifier: 'urn:air:sunrisetours.com:agent:booking',
    displayName: 'Sunrise Tours Booking Agent',
    type: NANDA_MEDIA_TYPE.a2aAgentCard,
    url: 'https://agentcards.host39.org/sunrisetours.com/booking.json',
    publisher: { identifier: 'sunrisetours.com', displayName: 'Sunrise Tours', identityType: 'domain' as const },
  };
  it('names the publisher from the URN and the host from the URL, and says when they differ', async () => {
    const { assessResolution } = await import('../src/resolve');
    const a = assessResolution(entry, { ok: true, status: 200, body: { name: 'Sunrise Tours Booking Agent' } });
    expect(a.publisherDomain).toBe('sunrisetours.com');
    expect(a.servedBy).toBe('agentcards.host39.org');
    expect(a.servedByPublisher).toBe(false);
    expect(a.notes.join(' ')).toContain('did not vouch for');
  });
  it('says an unsigned card is not authenticated, however reachable it is', async () => {
    const { assessResolution } = await import('../src/resolve');
    const a = assessResolution(entry, { ok: true, status: 200, body: { name: 'x' } });
    expect(a.reachable).toBe(true);
    expect(a.signed).toBe(false);
    expect(a.notes.join(' ')).toMatch(/reachability is not authenticity/);
  });
  it('says a listing outlives what it lists', async () => {
    const { assessResolution } = await import('../src/resolve');
    const a = assessResolution(entry, { ok: false, status: 404, body: null });
    expect(a.reachable).toBe(false);
    expect(a.signed).toBeNull();
    expect(a.notes.join(' ')).toMatch(/outlives/);
  });
  it('always says what it is not evidence of, starting with authority', async () => {
    const { assessResolution } = await import('../src/resolve');
    for (const f of [null, { ok: true, status: 200, body: { name: 'x', signatures: [{}] } }]) {
      const a = assessResolution(entry, f as never);
      expect(a.saysNothingAbout[0]).toMatch(/may do anything|ADR-0056/);
    }
  });
  it('a survey counts and never ranks', async () => {
    const { assessResolution, surveyResolutions } = await import('../src/resolve');
    const rows = [assessResolution(entry, { ok: true, status: 200, body: { name: 'a' } }), assessResolution(entry, { ok: false, status: 404, body: null })];
    const s = surveyResolutions(rows);
    expect(s).toMatchObject({ total: 2, reachable: 1, signed: 0, servedByPublisher: 0 });
    expect(s.says).toMatch(/nothing here ranks/i);
  });
});
