#!/usr/bin/env tsx
// The adapter as a command: fetch a live AP card, project it, print the entry and its loss report. It prints; it
// publishes nothing — registering an entry is the estate's act, with its own verified domain, and is not automated here.
//
//   pnpm nanda project --card https://town.faithnet.io/.well-known/agent-card.json --domain faithnet.io --name town
import { projectToIndexEntry } from '../src/project.js';
import { createOrg, orgRegistrationBody, readOrg, requestDomainChallenge, txtRecordFrom, verifyDomain, whoAmI, NANDA_API_BASE } from '../src/register.js';
import { assessResolution, fetchArtifact, surveyResolutions, type ResolutionAssessmentV1 } from '../src/resolve.js';
import type { NandaIndexEntryV1 } from '../src/types.js';

const args = process.argv.slice(2);
const flag = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const cmd = args[0];
if (cmd !== 'project' && cmd !== 'read' && cmd !== 'register') {
  console.error([
    'usage:',
    '  nanda project  --card <https://…/.well-known/agent-card.json> --domain <publisher domain> --name <short-name> [--estate <id>] [--chain <id>] [--agent 0x…]',
    '  nanda read     [--index https://api.nandaindex.org/api/v1/index] [--limit 12] [--urn urn:air:…]',
    '  nanda register --card … --domain … --name … --email <contact> [--org-id <id>] [--token <t>] [--publish | --challenge | --verify-domain]',
    '',
    'register prints the exact request and sends nothing unless one of --publish / --challenge / --verify-domain is given,',
    'and every one of those needs --token (or NANDA_TOKEN). Get the token with POST /auth/login at',
    'https://api.nandaindex.org — the account and the e-mail verification are the operator\'s, never a tool\'s.',
  ].join('\n'));
  process.exit(2);
}

if (cmd === 'read') {
  // READ THE INDEX THE WAY A STRANGER WOULD (spec 439 §5, discovery). Fetch the listings, fetch what they list, and
  // say what was checked. It decides nothing and stores nothing.
  const indexUrl = flag('index') ?? 'https://api.nandaindex.org/api/v1/index';
  const limit = Number(flag('limit') ?? 12);
  const urn = flag('urn');
  const r = await fetch(indexUrl, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(25_000) }).catch(() => null);
  if (!r?.ok) { console.error(`the index at ${indexUrl} did not answer (${r?.status ?? 'unreachable'})`); process.exit(1); }
  const all = (await r.json()) as NandaIndexEntryV1[];
  const entries = (urn ? all.filter((e) => e.identifier === urn) : all.filter((e) => e.type === 'application/a2a-agent-card+json')).slice(0, limit);
  if (!entries.length) { console.error(urn ? `no entry with identifier ${urn}` : 'no A2A card entries in that index'); process.exit(1); }
  console.log(`${indexUrl} — ${all.length} entr(ies); assessing ${entries.length}\n`);
  const rows: ResolutionAssessmentV1[] = [];
  for (const e of entries) {
    const a = assessResolution(e, e.url ? await fetchArtifact(e.url) : null);
    rows.push(a);
    const mark = (v: boolean | null) => (v === true ? 'yes' : v === false ? 'NO ' : ' — ');
    console.log(`${a.identifier}\n  reachable ${mark(a.reachable)}  signed ${mark(a.signed)}  served by its publisher ${mark(a.servedByPublisher)}  (${a.servedBy ?? 'no url'})`);
    for (const n of a.notes) console.log(`    · ${n}`);
  }
  const s = surveyResolutions(rows);
  console.log(`\nof ${s.total}: ${s.reachable} reachable, ${s.signed} signed, ${s.servedByPublisher} served by their own publisher, ${s.shapeMismatch} not the shape claimed`);
  console.log(`${s.says}`);
  console.log(rows[0]?.saysNothingAbout.map((x) => `  this says nothing about ${x}`).join('\n') ?? '');
  process.exit(0);
}

const cardUrl = flag('card') ?? ''; const domain = flag('domain') ?? ''; const shortName = flag('name') ?? '';
const r = await fetch(cardUrl, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
if (!r?.ok) { console.error(`the card at ${cardUrl} did not answer (${r?.status ?? 'unreachable'}) — a projection of a card nobody can fetch lists nothing`); process.exit(1); }
const card = (await r.json()) as Record<string, unknown>;
const out = projectToIndexEntry({
  card, cardUrl, publisherDomain: domain, shortName,
  canonical: { ...(flag('agent') ? { agentId: flag('agent')! } : {}), ...(flag('estate') ? { estate: flag('estate')! } : {}), ...(flag('chain') ? { chainId: Number(flag('chain')) } : {}) },
});
if (!out.ok) { console.error('refused:\n  ' + out.refusals.join('\n  ')); process.exit(1); }
console.log(JSON.stringify(out.entry, null, 2));
console.log(`\n— loss report (${out.loss.length}): what the index cannot carry —`);
for (const l of out.loss) console.log(`  ${l.code}: ${l.what}\n    instead read: ${l.insteadRead}`);
console.log('\nNothing was published. Registering this entry is the estate\'s own act, under a domain it verified there.');

if (cmd === 'register') {
  // THE ESTATE'S OWN ACT, in three steps that do not imply one another. Default: print and send nothing.
  const cardUrl = flag('card'); const domain = flag('domain'); const name = flag('name'); const email = flag('email');
  const token = flag('token') ?? process.env.NANDA_TOKEN;
  const base = flag('api') ?? NANDA_API_BASE;
  const orgId = flag('org-id') ?? name;
  const doPublish = args.includes('--publish');
  const doChallenge = args.includes('--challenge');
  const doVerify = args.includes('--verify-domain');
  if (!cardUrl || !domain || !name || !email) { console.error('register needs --card, --domain, --name and --email (the public contact for the record)'); process.exit(2); }
  if ((doPublish || doChallenge || doVerify) && !token) { console.error('a token is required to send anything: --token <t> or NANDA_TOKEN. POST /auth/login at the index returns one; the password stays with you.'); process.exit(2); }

  const r = await fetch(cardUrl, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(25_000) }).catch(() => null);
  if (!r?.ok) { console.error(`the card at ${cardUrl} did not answer (${r?.status ?? 'unreachable'})`); process.exit(1); }
  const card = (await r.json()) as Record<string, unknown>;
  const projected = projectToIndexEntry({
    card, cardUrl, publisherDomain: domain, shortName: name,
    ...(flag('estate') || flag('chain') || flag('agent')
      ? { canonical: { ...(flag('agent') ? { agentId: flag('agent') } : {}), ...(flag('estate') ? { estate: flag('estate') } : {}), ...(flag('chain') ? { chainId: Number(flag('chain')) } : {}) } }
      : {}),
  });
  if (!projected.ok) { console.error(`refused:\n  ${projected.refusals.join('\n  ')}`); process.exit(1); }
  // A listing of an UNSIGNED card is the thing our own index reading criticises. Say so loudly; do not refuse,
  // because whether to publish one is the estate's call and not this tool's.
  const signed = Array.isArray((card as { signatures?: unknown[] }).signatures) && ((card as { signatures?: unknown[] }).signatures ?? []).length > 0;
  if (!signed) console.error('WARNING: this card carries no signature. Listing it makes this agent one of the entries no reader can check (spec 439 §7.15). Sign the card first.');

  const body = orgRegistrationBody({ entry: projected.entry, orgId: orgId!, domain, contactEmail: email, registryUrl: cardUrl });
  console.log(`POST ${base}/api/v1/orgs\n${JSON.stringify(body, null, 2)}\n`);
  if (!doPublish && !doChallenge && !doVerify) {
    console.log('Nothing was sent. Add --publish to create the record, then --challenge for the DNS TXT, then --verify-domain once it resolves.');
    process.exit(0);
  }

  const me = await whoAmI(token!, base);
  if (!me.ok) { console.error(`the token does not identify anyone at ${base} (${me.status}): ${JSON.stringify(me.body).slice(0, 200)}`); process.exit(1); }
  const who = me.body as { email?: string; orgs?: unknown[] };
  console.log(`token belongs to ${who.email ?? '(no email in profile)'} with ${Array.isArray(who.orgs) ? who.orgs.length : 0} org(s)`);

  if (doPublish) {
    const res = await createOrg(token!, body, base);
    console.log(`POST /api/v1/orgs → ${res.status}\n${JSON.stringify(res.body, null, 2).slice(0, 1200)}`);
    if (!res.ok) process.exit(1);
    console.log('\nThe record exists and is NOT yet active: the domain is unproven. Next: --challenge');
  }
  if (doChallenge) {
    const res = await requestDomainChallenge(token!, orgId!, base);
    console.log(`POST /api/v1/orgs/${orgId}/domain-challenge → ${res.status}`);
    const txt = txtRecordFrom(res.body);
    if (txt.name && txt.value) console.log(`\n  place this TXT record:\n    name  ${txt.name}\n    value ${txt.value}\n`);
    else console.log(`\n  the challenge did not come back in a shape this tool recognises — the raw body, unguessed:\n${JSON.stringify(res.body, null, 2).slice(0, 1200)}\n`);
    if (!res.ok) process.exit(1);
    console.log('Once that record resolves publicly, run --verify-domain.');
  }
  if (doVerify) {
    const res = await verifyDomain(token!, orgId!, base);
    console.log(`POST /api/v1/orgs/${orgId}/verify-domain → ${res.status}\n${JSON.stringify(res.body, null, 2).slice(0, 900)}`);
    if (!res.ok) process.exit(1);
    const back = await readOrg(token!, orgId!, base);
    const ext = ((back.body as { extensions?: Record<string, Record<string, unknown>> })?.extensions ?? {})['org.projectnanda'] ?? {};
    console.log(`\nread back: status ${String(ext.status ?? '?')} · domainVerified ${String(ext.domainVerified ?? '?')} · emailVerified ${String(ext.emailVerified ?? '?')}`);
    console.log('Being listed authorizes nothing. Whether this agent may act is decided at its estate, per step, under a mandate its principal signed.');
  }
}
