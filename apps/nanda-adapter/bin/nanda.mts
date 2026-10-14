#!/usr/bin/env tsx
// The adapter as a command: fetch a live AP card, project it, print the entry and its loss report. It prints; it
// publishes nothing — registering an entry is the estate's act, with its own verified domain, and is not automated here.
//
//   pnpm nanda project --card https://town.faithnet.io/.well-known/agent-card.json --domain faithnet.io --name town
import { projectToIndexEntry } from '../src/project.js';

const args = process.argv.slice(2);
const flag = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
if (args[0] !== 'project') { console.error('usage: nanda project --card <https://…/.well-known/agent-card.json> --domain <publisher domain> --name <short-name> [--estate <id>] [--chain <id>] [--agent 0x…]'); process.exit(2); }
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
