#!/usr/bin/env tsx
// gate-f3-twin — the two-estate twin, both directions, on one chain (spec 439 §6 / §7.5).
//
// Standing anchored by ONE estate is presented at the OTHER estate's door and admitted on evidence read from neutral
// ground; the same five refusals hold at each door. Runs gate-f2-door twice (impact-agent → faithnet's door, faithnet →
// impact-agent's door) and fails if either fails. Needs both estates' leaves (setup-f2-test-grant.mts per estate),
// FEDERATION_RPC_URL, and both doors live. Honest limit, printed: one chain. The id is chain-scoped by construction;
// a second chain changes one line of config per estate and no verifier code — a design property, not a demonstration.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const fed = parse(readFileSync('federation.yaml', 'utf8')) as { doors: { estate: string; url: string }[]; estates: { id: string; governance: string | null }[] };
const projecting = fed.estates.filter((e) => e.governance).map((e) => e.id);
const doors = fed.doors.filter((d) => projecting.includes(d.estate));
if (doors.length < 2) { console.error(`the twin needs two projecting estates with doors; have ${doors.map((d) => d.estate).join(', ') || 'none'}`); process.exit(2); }
let red = 0;
for (const door of doors) {
  for (const from of projecting.filter((e) => e !== door.estate)) {
    console.log(`\n━━ standing in ${from} → ${door.estate}'s door (${door.url}) ━━`);
    const r = spawnSync('npx', ['tsx', 'scripts/gate-f2-door.mts'], { stdio: 'inherit', env: { ...process.env, FEDERATION_ESTATE: from, FEDERATION_DOOR_URL: door.url, NODE_OPTIONS: process.env.NODE_OPTIONS ?? '--dns-result-order=ipv4first' } });
    if (r.status !== 0) red++;
  }
}
console.log(red ? `\nF3 TWIN RED · ${red} direction(s) failed` : `\nF3 TWIN GREEN · ${doors.length * (projecting.length - 1)} directions on ONE chain (${[...new Set(fed.estates.map((e) => (e as { chainId?: number }).chainId))].join(', ')}) — cross-estate, not cross-chain`);
process.exit(red ? 1 : 0);
