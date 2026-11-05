import { sha256 } from './sha256';

/**
 * Program-derived addresses, matching `PublicKey.findProgramAddressSync`
 * (web3.js) and `getProgramDerivedAddress` (@solana/kit), without either.
 */

// ed25519: p = 2^255 - 19, d = -121665 / 121666 mod p
const P = (1n << 255n) - 19n;
const D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;

const mod = (a: bigint): bigint => {
  const r = a % P;
  return r >= 0n ? r : r + P;
};

function powMod(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let b = mod(base);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % P;
    b = (b * b) % P;
    e >>= 1n;
  }
  return result;
}

/**
 * Whether 32 bytes decode to a point on the ed25519 curve (RFC 8032 §5.1.3,
 * the same strict rules web3.js's `PublicKey.isOnCurve` applies). A PDA is,
 * by definition, a hash that is NOT on the curve — no private key exists.
 */
export function isOnCurve(bytes: Uint8Array): boolean {
  if (bytes.length !== 32) return false;
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? bytes[i]! & 0x7f : bytes[i]!);
  if (y >= P) return false;
  const y2 = (y * y) % P;
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n); // never 0: d is not a square mod p
  const x2 = (u * powMod(v, P - 2n)) % P;
  if (x2 === 0n) return (bytes[31]! & 0x80) === 0; // x = 0 has no "negative" encoding
  return powMod(x2, (P - 1n) / 2n) === 1n; // Euler's criterion: x² has a root
}

const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** `create_program_address`: the address, or `null` when it lands on the curve. */
export function createProgramAddress(seeds: readonly Uint8Array[], programId: Uint8Array): Uint8Array | null {
  if (seeds.length > 16) throw new RangeError('A PDA takes at most 16 seeds');
  for (const seed of seeds) {
    if (seed.length > 32) throw new RangeError('A PDA seed is at most 32 bytes');
  }
  const hash = sha256(concat([...seeds, programId, PDA_MARKER]));
  return isOnCurve(hash) ? null : hash;
}

/** `find_program_address`: the canonical (highest-bump) PDA and its bump. */
export function findProgramAddress(
  seeds: readonly Uint8Array[],
  programId: Uint8Array,
): [address: Uint8Array, bump: number] {
  for (let bump = 255; bump >= 0; bump--) {
    const address = createProgramAddress([...seeds, new Uint8Array([bump])], programId);
    if (address) return [address, bump];
  }
  throw new Error('Unable to find a viable program address bump seed');
}
