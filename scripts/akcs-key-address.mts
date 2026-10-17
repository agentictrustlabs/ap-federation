// THE ADDRESS OF A KEY-SERVICE KEY, read through the caller that will use it — so the address a wire is issued to is the
// one the Worker's own credential reaches, and a caller bound to the wrong purpose fails here rather than at a gate.
//
//   AKCS_TOKEN_ENV_FILE=.secrets/projector-akcs.env npx tsx scripts/akcs-key-address.mts --tenant faithnet --key <id> --token-var AKCS_TOKEN_FAITHNET
import { readFileSync } from 'node:fs';
import { RemoteAgenticKmsSigner, loadSecret, staticTokenProvider } from '@agenticprimitives/key-custody';

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const tenant = arg('tenant'); const keyId = arg('key'); const tokenVar = arg('token-var');
if (!tenant || !keyId || !tokenVar) { console.error('usage: akcs-key-address.mts --tenant <t> --key <keyId> --token-var <VAR>'); process.exit(2); }
const file = process.env.AKCS_TOKEN_ENV_FILE ?? '.secrets/projector-akcs.env';
const token = new RegExp(`^${tokenVar}=(.+)$`, 'm').exec(readFileSync(file, 'utf8'))?.[1]?.trim();
if (!token) { console.error(`${tokenVar} is not in ${file}`); process.exit(1); }
const signer = new RemoteAgenticKmsSigner({ baseUrl: process.env.AKCS_BASE_URL ?? 'https://kms.faithnet.io', tenantId: tenant, tokenProvider: staticTokenProvider(loadSecret<'akcs-token'>(token)), acceptedProtectionLevels: ['CVM_WRAPPED', 'CVM_DERIVED'] }, { kind: 'key', keyId });
console.log(`${tenant}/${keyId} → ${await signer.getSignerAddress()}`);
