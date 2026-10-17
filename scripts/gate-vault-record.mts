// GATE — the estate's submissions really are in the estate's own vault (ADR-0055; spec 439 §7.13).
//
// It writes one throwaway submission as the estate's registry agent, reads the family back, and retires it. Three
// things have to hold and each one is a separate claim:
//   1. the agent's own vault TAKES the record (the grant, the leaf and the key all line up at that estate's door);
//   2. a read under the same grant SEES it (a write-only credential would list nothing, which is a different bug);
//   3. the record round-trips field for field, including the BLIND — the one value that exists nowhere else.
//
//   set -a; . .secrets/projector-akcs.env; set +a   # the projector's caller tokens (AKCS_TOKEN_<TENANT>): it signs as the projector does
//   FEDERATION_VAULT_SECRET_DIR=.secrets npx tsx scripts/gate-vault-record.mts [estate…]
import { readFileSync } from 'node:fs';
import { loadSubmissions, submissionRecordType, vaultCredentialsFrom, writeSubmission } from '../apps/projector/src/vault-ledger.js';
import type { SubmissionV1 } from '../apps/projector/src/ledger.js';

const dir = process.env.FEDERATION_VAULT_SECRET_DIR ?? '.secrets';
const estates = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const which = estates.length ? estates : ['faithnet', 'impact-agent'];
// ONE FIXED, OBVIOUSLY SYNTHETIC LEAF, rewritten every run rather than a fresh one each time. A gate that minted a
// random digest would leave a retired record behind on every pass and grow a real estate's ledger forever — and it
// cannot tidy up after itself, because the grant has no `delete` scope ON PURPOSE: submissions are retired, never
// deleted (a projection that silently forgets a retirement cannot be audited). So the gate owns exactly one record.
const GATE_DIGEST = '0xdeadbeef00000000000000000000000000000000000000000000000000000001' as `0x${string}`;
const GATE_BLIND = '0xdeadbeef00000000000000000000000000000000000000000000000000000002' as `0x${string}`;
let failed = 0;

for (const estate of which) {
  const c = await vaultCredentialsFrom(readFileSync(`${dir}/vault-secret-${estate}.json`, 'utf8'), `${estate}.registry`);
  const digest = GATE_DIGEST;
  const row: SubmissionV1 = {
    type: 'ap.federation-submission.v1', estate, set: 'live-grant', digest, blind: GATE_BLIND,
    subject: '0x0000000000000000000000000000000000000001', submittedBy: 'gate:vault-record',
    source: 'gate-vault-record.mts', submittedAt: new Date().toISOString(),
  };
  const recordType = submissionRecordType('live-grant', digest);
  try {
    await writeSubmission(c, row);
    const rows = await loadSubmissions(c);
    const back = rows.find((x) => x.digest.toLowerCase() === digest.toLowerCase());
    if (!back) throw new Error(`written and not read back: ${recordType} is absent from ${rows.length} submission(s) the grant can read`);
    for (const k of ['blind', 'subject', 'submittedBy', 'source', 'submittedAt'] as const) {
      if (String(back[k]).toLowerCase() !== String(row[k]).toLowerCase()) throw new Error(`${k} changed in the round trip: wrote ${String(row[k])}, read ${String(back[k])}`);
    }
    // Retire it. A retirement is a rewrite of the same record, which is also the only way to check that path
    // without inventing a second one — and it leaves the ledger with nothing live that nobody submitted.
    await writeSubmission(c, { ...row, retired: { at: new Date().toISOString(), reason: 'gate-vault-record: a test leaf, never vouched for' } });
    const after = (await loadSubmissions(c)).find((x) => x.digest.toLowerCase() === digest.toLowerCase());
    if (!after?.retired) throw new Error('the retirement did not round-trip — the record still reads as live');
    console.log(`✓ ${estate}: ${c.agentName} wrote, read and retired ${recordType.slice(0, 58)}… at ${c.vaultUrl} (${rows.length} submission(s) readable, blind intact)`);
  } catch (e) {
    failed++;
    console.error(`✗ ${estate}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
if (failed) { console.error(`✗ gate:vault-record — ${failed} of ${which.length} estate(s) failed`); process.exit(1); }
console.log(`✓ gate:vault-record passed — ${which.length} estate(s) keep their submissions in their own registry agent's vault`);
