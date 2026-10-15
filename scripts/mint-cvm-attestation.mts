// MINT THE CVM'S ATTESTATION — spec 440 A5 step 4, without giving the CVM a way out to the internet.
//
// THE POINT: a confidential VM's attestation says what the hardware measured, and MAA verifies the AMD
// signature chain inside the report. Nothing about that requires the REPORT to be submitted by the machine
// it describes. So the CVM keeps zero egress — it has no NAT gateway and does not need one — and the three
// pieces are gathered from three places that each already allow it:
//
//   1. the HCL report   from the vTPM, read over /dev/tpmrm0 with raw TPM2 commands. The CVM has libtss2 but
//                       no tpm2-tools and cannot install them (its NSG denies everything but four Azure
//                       service tags, which is correct), so scripts/tpm-nvread.py speaks the protocol itself.
//   2. the VCEK chain   from AMD's public KDS, by the chip id and reported TCB inside the report. Azure's own
//                       client takes it from the host's THIM endpoint instead; AMD's is reachable from here.
//   3. the JWT          from MAA, posted from this machine.
//
// THE ENVELOPE IS THE PART THAT IS NOT GUESSABLE, and eight wrong shapes were tried before Azure's own API
// example settled it: `report` is base64url of a JSON DOCUMENT { SnpReport, VcekCertChain }, each field
// base64URL (a '+' makes MAA refuse), and `runtimeData` is the JSON blob that binds the vTPM's key into the
// report. MAA's error for every wrong shape is "Error parsing SevSnp JSON payload", which is literal: it was
// base64-decoding the report field and trying to parse the result as JSON.
//
// THE TOKEN LIVES 8 HOURS. What is durable is the launch measurement, which changes only with the VM image;
// the token is a dated statement about it. Re-mint after an image upgrade, or whenever a verifier wants a
// fresh one — this script is the whole ceremony.
//
//   npx tsx scripts/mint-cvm-attestation.mts [--out apps/site/assets/attestation.jwt]
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const RG = 'RG-AKCS-PILOT-WESTUS';
const VM = 'vm-akcs-pilot-0';
const MAA = process.env.MAA_URL ?? 'https://sharedwus.wus.attest.azure.net';
const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'apps/site/assets/attestation.jwt';

const onVm = (script: string): string =>
  execFileSync('az', ['vm', 'run-command', 'invoke', '-g', RG, '-n', VM, '--command-id', 'RunShellScript',
    '--scripts', script, '--query', 'value[0].message', '-o', 'tsv'], { encoding: 'utf8', maxBuffer: 1 << 24 });

// 1 — the HCL report, in base64 so the az channel carries it intact. Chunked because run-command truncates
// its reply FROM THE FRONT, so a long single line comes back headless and silently wrong.
console.log('reading the HCL report from the vTPM…');
let b64 = '';
for (let i = 0; ; i++) {
  const part = onVm(`base64 -w0 /tmp/hcl.bin | cut -c${i * 1500 + 1}-${(i + 1) * 1500}`)
    .split('\n').map((l) => l.trim()).filter((l) => /^[A-Za-z0-9+/=]+$/.test(l)).pop() ?? '';
  if (!part) break;
  b64 += part;
  if (part.length < 1500) break;
}
const blob = Buffer.from(b64, 'base64');
if (blob.subarray(0, 4).toString() !== 'HCLA') throw new Error(`not an HCL report (${blob.subarray(0, 4).toString('hex')}); run scripts/tpm-nvread.py on the CVM first`);
const snp = blob.subarray(0x20, 0x20 + 1184);

// the runtime data, found by parsing rather than by trusting an offset
let runtime: Buffer | undefined;
for (let i = 0; i < blob.length - 2 && !runtime; i++) {
  if (blob[i] !== 0x7b || blob[i + 1] !== 0x22) continue;
  for (let j = blob.length; j > i; j--) {
    try { JSON.parse(blob.subarray(i, j).toString()); runtime = blob.subarray(i, j); break; } catch { /* keep shrinking */ }
  }
}
if (!runtime) throw new Error('no runtime-data JSON inside the report');

// 2 — the VCEK, by chip id and reported TCB. Genoa vs Milan is decided by which one KDS answers, not by a guess.
const tcb = snp.subarray(0x180, 0x188);
const chipId = snp.subarray(0x1a0, 0x1e0).toString('hex');
const q = `blSPL=${tcb[0]}&teeSPL=${tcb[1]}&snpSPL=${tcb[6]}&ucodeSPL=${tcb[7]}`;
let vcek: Buffer | undefined; let product = '';
for (const p of ['Genoa', 'Milan', 'Turin']) {
  const r = await fetch(`https://kdsintf.amd.com/vcek/v1/${p}/${chipId}?${q}`);
  if (r.ok) { vcek = Buffer.from(await r.arrayBuffer()); product = p; break; }
}
if (!vcek) throw new Error(`AMD KDS has no VCEK for chip ${chipId.slice(0, 16)}… at TCB ${tcb.toString('hex')}`);
const chainPem = await (await fetch(`https://kdsintf.amd.com/vcek/v1/${product}/cert_chain`)).text();
const pem = (der: Buffer) => `-----BEGIN CERTIFICATE-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '')}\n-----END CERTIFICATE-----\n`;
console.log(`  ${product}, TCB bl=${tcb[0]} tee=${tcb[1]} snp=${tcb[6]} ucode=${tcb[7]}`);

// 3 — MAA. base64URL everywhere, including inside the report document.
const u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const res = await fetch(`${MAA}/attest/SevSnpVm?api-version=2022-08-01`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    report: u(Buffer.from(JSON.stringify({ SnpReport: u(snp), VcekCertChain: u(pem(vcek) + chainPem) }))),
    runtimeData: { data: u(runtime), dataType: 'JSON' },
  }),
});
if (!res.ok) throw new Error(`MAA ${res.status}: ${(await res.text()).slice(0, 300)}`);
const token = ((await res.json()) as { token: string }).token;
const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as Record<string, unknown>;
writeFileSync(OUT, token);
console.log(`\nattested ✓  ${OUT}`);
console.log(`  type ${claims['x-ms-attestation-type']} · ${claims['x-ms-compliance-status']} · debuggable=${claims['x-ms-sevsnpvm-is-debuggable']}`);
console.log(`  launch measurement ${String(claims['x-ms-sevsnpvm-launchmeasurement']).slice(0, 48)}…`);
console.log(`  valid ${new Date(Number(claims.iat) * 1000).toISOString()} → ${new Date(Number(claims.exp) * 1000).toISOString()}`);
