// THE PROJECTOR'S SIGNER IS A KEY-SERVICE KEY — a delegate, never an identity (the service-agent-signing rule). Every
// key this job signs with is one the estate's key service holds: the registry agent's anchoring wire and its vault leaf
// name that key's ADDRESS, and the Worker holds only a caller token that can ask the service to sign with it. Revoking
// the wire stops the key; disabling the caller stops the token; neither touches the agent.
//
// THE PURPOSE IS NAMED PER ACT. The key service checks each signature's purpose against the caller's binding, and an
// unnamed one defaults to a userOp — which this caller may not sign. So: a transaction is `EIP155_TRANSACTION`, an EIP-191
// message `PERSONAL_SIGN_DIGEST`, and a bare digest (the vault's invocation proof) `RAW_32_BYTE_DIGEST`.
import { RemoteAgenticKmsSigner, loadSecret, staticTokenProvider, type AkcsSigningPurpose } from '@agenticprimitives/key-custody';
import { bytesToHex, hashMessage, hexToBytes, keccak256, serializeSignature, serializeTransaction, type Hex, type LocalAccount } from 'viem';

/** Which key, in which tenant — what a deployment's config names instead of a private key. */
export interface KeyServiceRef { tenant: string; keyId: string }

export const DEFAULT_KEY_SERVICE_URL = 'https://kms.faithnet.io';

/** The caller token for a tenant: `AKCS_TOKEN_<TENANT>` — one caller per Worker per tenant, bound to this job's keys only. */
export function tokenFor(env: Record<string, unknown>, tenant: string): string {
  const name = `AKCS_TOKEN_${tenant.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const t = env[name];
  if (typeof t !== 'string' || !t.trim()) throw new Error(`no ${name} on this deployment — the key service cannot be asked for ${tenant}'s key`);
  return t.trim();
}

/** A viem account whose every signature is made by the key service, and that always has `sign` (a bare digest — the vault's invocation proof needs it). */
export type KeyServiceAccount = LocalAccount & { sign: NonNullable<LocalAccount['sign']> };

export async function keyServiceAccount(ref: KeyServiceRef, i: { token: string; baseUrl?: string; fetch?: typeof fetch }): Promise<KeyServiceAccount> {
  const backend = new RemoteAgenticKmsSigner({
    baseUrl: i.baseUrl ?? DEFAULT_KEY_SERVICE_URL, tenantId: ref.tenant,
    tokenProvider: staticTokenProvider(loadSecret<'akcs-token'>(i.token)), acceptedProtectionLevels: ['CVM_WRAPPED', 'CVM_DERIVED'],
    ...(i.fetch ? { fetch: i.fetch } : {}),
  }, { kind: 'key', keyId: ref.keyId });
  const address = await backend.getSignerAddress();
  const signDigest = async (digest: Hex, signingPurpose: AkcsSigningPurpose) => {
    const { signature } = await backend.signA2AAction({ digest: hexToBytes(digest), signingPurpose });
    const v = signature[64];
    if (signature.length !== 65 || (v !== 27 && v !== 28)) throw new Error(`the key service returned a ${signature.length}-byte signature with v=${v}`);
    return { r: bytesToHex(signature.slice(0, 32)), s: bytesToHex(signature.slice(32, 64)), v: BigInt(v), yParity: v - 27 };
  };
  return {
    address, type: 'local', source: 'key-service', publicKey: '0x',
    async sign({ hash }) { return serializeSignature(await signDigest(hash, 'RAW_32_BYTE_DIGEST')); },
    async signMessage({ message }) { return serializeSignature(await signDigest(hashMessage(message), 'PERSONAL_SIGN_DIGEST')); },
    async signTransaction(tx, options) {
      const serializer = options?.serializer ?? serializeTransaction;
      const s = await signDigest(keccak256(await serializer(tx)), 'EIP155_TRANSACTION');
      return serializer(tx, s);
    },
    async signTypedData() { throw new Error('a key-service account signs no typed data here — its caller is not bound for EIP712'); },
  } as KeyServiceAccount;
}
