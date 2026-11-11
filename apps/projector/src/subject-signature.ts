// THE SUBJECT'S SIGNATURE, READ ON THE SUBJECT'S CHAIN (Ring 0 spec 445 §3.8, audit H-14).
//
// A presentation is proof of possession: the subject's Smart Agent signs the verifier's challenge (EIP-712, domain
// `AgenticAuthorityPresentation` v2 with the chain id of the chain its account lives on), and a verifier asks that
// account whether the signature is its own. This module is that question, for the CLI's `verify` and the F1 gate —
// the door asks the same one through its own client (`apps/door/src/index.ts`).
//
//   · ONE MECHANISM (ADR-0013): the town's `UniversalSignatureValidator.isValidSig(signer, digest, signature)`, which
//     answers for an EOA, a deployed Smart Agent (ERC-1271) and a counterfactual one (ERC-6492). The digest is the
//     EIP-712 digest itself — never wrapped in EIP-191 (that is the request proof's form, not this one's).
//   · THE CHAIN IS DECLARED OR IT IS AN ERROR. The chain is the subject's, named by whoever verifies; the register's
//     `towns[]` row for it gives the endpoint (an environment variable — it carries an app token) and the validator.
//     A chain with no row, no endpoint or no validator is a refusal with the reason, never a read on some other chain.
import { createPublicClient, http, type Address, type Hex } from 'viem';

/** The register's row for a chain: how to reach it and which validator answers for a signature there. */
export interface TownRow { id: string; chainId: number; rpcEnv?: string; universalSignatureValidator?: Address }

export const UNIVERSAL_VALIDATOR_ABI = [
  { type: 'function', name: 'isValidSig', stateMutability: 'view', inputs: [{ name: 'signer', type: 'address' }, { name: 'hash', type: 'bytes32' }, { name: 'sig', type: 'bytes' }], outputs: [{ type: 'bool' }] },
] as const;

export type SubjectSignatureCheck = (subject: `0x${string}`, digest: Hex, signature: Hex) => Promise<boolean>;

/** `--chain <id>` and its like: a positive integer, or a refusal that says what the number is for. */
export function declaredSubjectChain(value: string | number | undefined, what = '--chain <id>'): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (value === undefined || value === '' || !Number.isSafeInteger(n) || n <= 0) {
    throw new Error(`${what} is required: the chain the SUBJECT's account lives on, where its signature is checked. It is declared, never defaulted (not the registry's chain because that is the one at hand).`);
  }
  return n;
}

/** The check for one chain, from the register's town row. Throws — with the row's gap named — when this machine
 *  cannot ask that chain; the caller refuses, it does not fall back. */
export function subjectSignatureCheckFor(towns: readonly TownRow[] | undefined, chainId: number, env: Record<string, unknown> = process.env): SubjectSignatureCheck {
  const town = (towns ?? []).find((t) => t.chainId === chainId);
  if (!town) throw new Error(`no town in the register for eip155:${chainId} — a subject's signature cannot be checked on a chain the register does not describe`);
  if (!town.universalSignatureValidator) throw new Error(`town ${town.id} (eip155:${chainId}) names no universalSignatureValidator in the register`);
  const rpc = town.rpcEnv ? String(env[town.rpcEnv] ?? '').trim() : '';
  if (!rpc) throw new Error(`${town.rpcEnv ?? `an rpcEnv for town ${town.id}`} is not set — the subject's signature is read on eip155:${chainId} over it`);
  const pub = createPublicClient({ chain: { id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } }, transport: http(rpc) });
  const validator = town.universalSignatureValidator;
  return async (subject, digest, signature) =>
    (await pub.readContract({ address: validator, abi: UNIVERSAL_VALIDATOR_ABI, functionName: 'isValidSig', args: [subject, digest, signature] })) as boolean;
}
