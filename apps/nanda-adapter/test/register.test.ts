// Registration is an ACT, so these tests are about what it refuses and what it never invents.
import { describe, expect, it } from 'vitest';
import { orgRegistrationBody, txtRecordFrom, NANDA_API_BASE } from '../src/register.js';
import type { NandaIndexEntryV1 } from '../src/types.js';

const entry: NandaIndexEntryV1 = {
  identifier: 'urn:air:faithnet.io:agent:town',
  displayName: 'faithchain town',
  type: 'application/a2a-agent-card+json',
  url: 'https://town.faithnet.io/.well-known/agent-card.json',
  description: 'the town',
  tags: ['town'],
  publisher: { identifier: 'faithnet.io', displayName: 'faithnet.io', identityType: 'domain' },
  extensions: { 'dev.agenticprimitives': { estate: 'faithnet' } },
};
const base = { entry, orgId: 'town', domain: 'faithnet.io', contactEmail: 'ops@faithnet.io', registryUrl: entry.url };

describe('the org registration body', () => {
  it('refuses a domain that is not the one in the URN — a URN naming a domain nobody proved is worse than no entry', () => {
    expect(() => orgRegistrationBody({ ...base, domain: 'example.com' })).toThrow(/nobody proved/);
  });

  it('carries the projected entry verbatim, so the record and the projection cannot disagree', () => {
    const b = orgRegistrationBody(base);
    expect(b.identifier).toBe(entry.identifier);
    expect(b.media_type).toBe(entry.type);
    expect(b.registry_url).toBe(entry.url);
    expect(b.extensions).toBe(entry.extensions);
  });

  it('invents no field: an entry without tags or a description sends neither', () => {
    const bare: NandaIndexEntryV1 = { ...entry, description: undefined, tags: [], extensions: undefined };
    const b = orgRegistrationBody({ ...base, entry: bare });
    expect('description' in b).toBe(false);
    expect('tags' in b).toBe(false);
    expect('extensions' in b).toBe(false);
  });

  it('sends the index to its own host by default, so a typo cannot silently publish somewhere else', () => {
    expect(NANDA_API_BASE).toBe('https://api.nandaindex.org');
  });
});

describe('the DNS challenge', () => {
  it('reads the obvious field names', () => {
    expect(txtRecordFrom({ txt_name: '_nanda.faithnet.io', txt_value: 'abc' })).toMatchObject({ name: '_nanda.faithnet.io', value: 'abc' });
    expect(txtRecordFrom({ challenge: { name: '_n', value: 'v' } })).toMatchObject({ name: '_n', value: 'v' });
  });

  it('GUESSES NOTHING when the shape is unfamiliar — a TXT record placed from a guess is a verification that never completes', () => {
    const r = txtRecordFrom({ some: { nested: 'surprise' } });
    expect(r.name).toBeUndefined();
    expect(r.value).toBeUndefined();
    expect(r.raw).toEqual({ some: { nested: 'surprise' } });
  });
});
