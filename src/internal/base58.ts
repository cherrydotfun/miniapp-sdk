/** Base58 (Bitcoin alphabet — the one Solana addresses use). */

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const INDEX: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) INDEX[ALPHABET[i]!] = i;

export function encodeBase58(bytes: Uint8Array): string {
  // Little-endian base-58 digits of the big-endian integer `bytes`.
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      const x = digits[i]! * 256 + carry;
      digits[i] = x % 58;
      carry = (x / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (const byte of bytes) {
    if (byte !== 0) break;
    out += '1';
  }
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]!];
  return out;
}

export function decodeBase58(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    const value = INDEX[char];
    if (value === undefined) throw new Error(`Invalid base58 character: ${char}`);
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      const x = bytes[i]! * 58 + carry;
      bytes[i] = x & 0xff;
      carry = x >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of text) {
    if (char !== '1') break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

/** Decode a base58 Solana address, insisting on exactly 32 bytes. */
export function decodeAddress(address: string, label = 'address'): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = decodeBase58(address);
  } catch {
    throw new TypeError(`${label} is not a base58 Solana address: ${address}`);
  }
  if (bytes.length !== 32) {
    throw new TypeError(`${label} is not a 32-byte Solana address: ${address}`);
  }
  return bytes;
}
