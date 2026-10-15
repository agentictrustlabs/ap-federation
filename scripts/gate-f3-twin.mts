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

const fed = parse(readFileSync('federation.yaml', 'utf8')) as { registry?: { chainId: number }; doors: { estate: string; url: string }[]; estates: { id: string; governance: string | null; chainId?: number; homeChainId?: number }[] };
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
// W4: the chains a presenter's ACCOUNT lives on — `homeChainId` when the register says the estate's people live elsewhere
// than its projection anchors. Two chains here is the cross-chain twin; one is cross-estate, and the line says which.
const homeChains = [...new Set(fed.estates.map((e) => (e as { homeChainId?: number; chainId?: number }).homeChainId ?? (e as { chainId?: number }).chainId))];
console.log(red ? `\nF3 TWIN RED · ${red} direction(s) failed` : `\nF3 TWIN GREEN · ${doors.length * (projecting.length - 1)} directions ${homeChains.length > 1 ? `ACROSS ${homeChains.length} CHAINS (${homeChains.join(' ↔ ')}) — presenters verified on their own chain, roots read on ${fed.registry?.chainId ?? '?'}` : `on ONE chain (${homeChains[0]}) — cross-estate, not cross-chain`}`);
process.exit(red ? 1 : 0);
