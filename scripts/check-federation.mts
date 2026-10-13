#!/usr/bin/env tsx
// check:federation — the register is fit to publish (spec 440): the towns are well-formed and reachable by a Worker
// (custom domains), one tenant per estate and never a shared one, CVM levels only, the four KMS conditions each with a
// status, and one live town on the naming root chain. Pure: reads federation.yaml, fetches nothing.
import { readFileSync } from 'node:fs';
import { parseFederation, validateFederation } from '../apps/site/src/federation';

const text = readFileSync('federation.yaml', 'utf8');
const fed = parseFederation(text);
const errs = validateFederation(fed);
if (errs.length) {
  console.error(`✗ check:federation — ${errs.length} problem(s) in federation.yaml:\n`);
  for (const e of errs) console.error(`  ${e}`);
  process.exit(1);
}
const open = fed.kms.conditions.filter((c) => c.status === 'open');
const billable = (fed.kms.platformRoots ?? []).filter((r) => r.billable).length;
console.log(`  KMS keys the cloud bills for: ${billable} of a budget of ${fed.kms.billableKeyBudget ?? 2} (${(fed.kms.platformRoots ?? []).map((r) => r.key).join(', ') || 'none recorded'}); logical keys under them: ${fed.kms.evidence?.logicalKeys ?? '?'} (${Object.entries(fed.kms.evidence?.byProtection ?? {}).map(([k, v]) => `${k} ${v}`).join(', ')}) — checked ${fed.kms.evidence?.checked ?? 'never'}`);
console.log(`✓ check:federation — ${fed.towns.length} town(s) (${fed.towns.filter((t) => t.status === 'live').length} live), ${fed.kms.tenants.length} KMS tenant(s), root chain eip155:${fed.naming.rootChain}`);
if (open.length) console.log(`  KMS conditions open (said, not hidden): ${open.map((c) => `#${c.id}`).join(', ')} — a NEW town's estate may not bind until #1 and #4 are met`);
