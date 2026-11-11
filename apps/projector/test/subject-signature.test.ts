// WHERE A SUBJECT'S SIGNATURE IS READ (Ring 0 spec 445 §3.8) — the chain is declared or it is an error, and a chain
// this machine cannot ask is a refusal with the gap named, never a read somewhere else.
import { describe, expect, it } from 'vitest';
import { declaredSubjectChain, subjectSignatureCheckFor, type TownRow } from '../src/subject-signature.js';

const TOWNS: TownRow[] = [
  { id: 'faithchain', chainId: 34348, rpcEnv: 'FEDERATION_RPC_URL', universalSignatureValidator: '0xeDd56f500325D4701B9985A34e5Fa6EED6716137' },
  { id: 'hopenet', chainId: 34349, rpcEnv: 'HOPECHAIN_RPC_URL', universalSignatureValidator: '0xa5855906C0De3813E74BEe201973071e0c844115' },
  { id: 'no-validator', chainId: 7, rpcEnv: 'SEVEN_RPC_URL' },
];

describe('the subject\'s chain', () => {
  it('is declared — absent, empty, zero or not a number is refused, never defaulted', () => {
    for (const bad of [undefined, '', '0', '-1', 'faithchain', '1.5']) expect(() => declaredSubjectChain(bad)).toThrow(/declared, never defaulted/);
    expect(declaredSubjectChain('34349')).toBe(34349);
    expect(declaredSubjectChain(34348)).toBe(34348);
  });

  it('must be a chain the register describes, with a validator and an endpoint this machine has', () => {
    expect(() => subjectSignatureCheckFor(TOWNS, 1, {})).toThrow(/no town in the register for eip155:1/);
    expect(() => subjectSignatureCheckFor(undefined, 34348, {})).toThrow(/no town in the register/);
    expect(() => subjectSignatureCheckFor(TOWNS, 7, { SEVEN_RPC_URL: 'http://x.invalid' })).toThrow(/names no universalSignatureValidator/);
    // The other town's endpoint being set does not make this one reachable: no fall back to the chain at hand.
    expect(() => subjectSignatureCheckFor(TOWNS, 34349, { FEDERATION_RPC_URL: 'http://x.invalid' })).toThrow(/HOPECHAIN_RPC_URL is not set/);
    expect(typeof subjectSignatureCheckFor(TOWNS, 34349, { HOPECHAIN_RPC_URL: 'http://x.invalid' })).toBe('function');
  });
});
