#!/usr/bin/env tsx
// The adapter as a command: fetch a live AP card, project it, print the entry and its loss report. It prints; it
// publishes nothing — registering an entry is the estate's act, with its own verified domain, and is not automated here.
//
//   pnpm nanda project --card https://town.faithnet.io/.well-known/agent-card.json --domain faithnet.io --name town
import { projectToIndexEntry } from '../src/project.js';
import { assessResolution, fetchArtifact, surveyResolutions, type ResolutionAssessmentV1 } from '../src/resolve.js';
import type { NandaIndexEntryV1 } from '../src/types.js';

const args = process.argv.slice(2);
const flag = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const cmd = args[0];
if (cmd !== 'project' && cmd !== 'read') {
  console.error('usage:\n  nanda project --card <https://…/.well-known/agent-card.json> --domain <publisher domain> --name <short-name> [--estate <id>] [--chain <id>] [--agent 0x…]\n  nanda read [--index https://api.nandaindex.org/api/v1/index] [--limit 12] [--urn urn:air:…]');
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
