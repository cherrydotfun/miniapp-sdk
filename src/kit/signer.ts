import type { CherryMiniApp } from '../client';
import { getSharedBridge } from '../bridge';

/**
 * Creates a Solana Kit TransactionSigner backed by the Cherry bridge.
 *
 * Usage:
 * ```ts
 * import { CherryMiniApp } from '@cherrydotfun/miniapp-sdk';
 * import { createCherrySigner } from '@cherrydotfun/miniapp-sdk/kit';
 *
 * const cherry = new CherryMiniApp();
 * await cherry.init();
 * const signer = createCherrySigner(cherry);
 * ```
 *
 * The returned object conforms to @solana/signers TransactionSigner interface.
 * We use structural typing — no runtime import of @solana/signers needed.
 */
export interface CherryTransactionSigner<TAddress extends string = string> {
  readonly address: TAddress;
  signTransactions(
    transactions: ReadonlyArray<{
      messageBytes: Uint8Array;
      signatures: Record<string, Uint8Array | null>;
    }>,
  ): Promise<
    ReadonlyArray<{
      messageBytes: Uint8Array;
      signatures: Record<string, Uint8Array>;
    }>
  >;
  signMessages?(messages: ReadonlyArray<Uint8Array>): Promise<ReadonlyArray<Uint8Array>>;
}

function uint8ArrayToBase64(arr: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]!);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Read `numRequiredSignatures` from a compiled Solana message.
 *
 * Wire format of the message:
 *   - v0+: [version byte (0x80|v)] [numRequiredSignatures] [...]
 *   - legacy: [numRequiredSignatures] [...]
 *
 * The high bit distinguishes: legacy messages always have
 * numRequiredSignatures < 0x80, so bit 7 unset → legacy.
 */
function readNumRequiredSignatures(messageBytes: Uint8Array): number {
  const first = messageBytes[0];
  if (first === undefined) throw new Error('Empty messageBytes');
  const isVersioned = (first & 0x80) !== 0;
  const idx = isVersioned ? 1 : 0;
  const n = messageBytes[idx];
  if (n === undefined || n === 0) {
    throw new Error('Cannot determine numRequiredSignatures from messageBytes');
  }
  return n;
}

/**
 * Encode a small integer as Solana's compact-u16 (shortvec) — 1–3 bytes,
 * 7 data bits per byte, MSB set on all but the last byte.
 */
function encodeCompactU16(n: number): Uint8Array {
  if (n < 0 || n > 0xffff) throw new Error(`compact-u16 out of range: ${n}`);
  if (n < 0x80) return new Uint8Array([n]);
  if (n < 0x4000) return new Uint8Array([(n & 0x7f) | 0x80, n >> 7]);
  return new Uint8Array([(n & 0x7f) | 0x80, ((n >> 7) & 0x7f) | 0x80, n >> 14]);
}

/** Decode a compact-u16 starting at offset. Returns value and how many bytes were consumed. */
function decodeCompactU16(bytes: Uint8Array, offset: number): { value: number; size: number } {
  let value = 0;
  let size = 0;
  let shift = 0;
  for (;;) {
    const b = bytes[offset + size];
    if (b === undefined) throw new Error('compact-u16: unexpected end of input');
    value |= (b & 0x7f) << shift;
    size += 1;
    if ((b & 0x80) === 0) break;
    shift += 7;
    if (size > 3) throw new Error('compact-u16: varint too long');
  }
  return { value, size };
}

/** Minimal base58 decoder (Bitcoin alphabet, same as Solana). */
function decodeBase58(s: string): Uint8Array {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const bytes: number[] = [0];
  for (const c of s) {
    const val = ALPHABET.indexOf(c);
    if (val < 0) throw new Error(`Invalid base58 character: ${c}`);
    let carry = val;
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
  for (const c of s) {
    if (c !== '1') break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

/**
 * Extract the first `numSigners` static account keys (32 bytes each) from a
 * compiled Solana message. These are the accounts that must sign — by spec,
 * signer accounts can only come from the static keys section, never from
 * address lookup tables.
 */
function parseSignerPubkeys(messageBytes: Uint8Array, numSigners: number): Uint8Array[] {
  const first = messageBytes[0];
  if (first === undefined) throw new Error('Empty messageBytes');
  const isVersioned = (first & 0x80) !== 0;
  // Skip: [version (v0 only, 1 byte)] [header (3 bytes)]
  const keysLenOffset = (isVersioned ? 1 : 0) + 3;
  const { size: lenSize } = decodeCompactU16(messageBytes, keysLenOffset);
  const keysStart = keysLenOffset + lenSize;
  const signers: Uint8Array[] = [];
  for (let i = 0; i < numSigners; i++) {
    const slice = messageBytes.slice(keysStart + i * 32, keysStart + (i + 1) * 32);
    if (slice.length !== 32) {
      throw new Error(`Malformed messageBytes: signer ${i} is truncated`);
    }
    signers.push(slice);
  }
  return signers;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Create a TransactionSigner from an initialized CherryMiniApp instance.
 */
export function createCherrySigner(cherry: CherryMiniApp): CherryTransactionSigner {
  if (!cherry.isReady) {
    throw new Error('CherryMiniApp must be initialized before creating a signer. Call cherry.init() first.');
  }

  const address = cherry.user.publicKey;
  const bridge = getSharedBridge();

  return {
    address,

    async signTransactions(transactions) {
      // Decode Cherry's own pubkey once so we can match it against the
      // message's signer list (first numRequiredSignatures static keys).
      const cherryPubkeyBytes = decodeBase58(address);
      if (cherryPubkeyBytes.length !== 32) {
        throw new Error(`Invalid Cherry public key length: ${cherryPubkeyBytes.length}`);
      }

      // Build a correctly-sized wire format for each transaction and
      // pre-compute which slot index belongs to Cherry.
      //
      // Wire: [compact-u16 sigCount] [sigCount * 64 zero bytes] [messageBytes]
      // sigCount MUST equal `numRequiredSignatures` from the message header,
      // otherwise the host's `VersionedTransaction.deserialize` produces a
      // transaction whose sig-array length doesn't match its header — the
      // wallet then either refuses to sign or returns a malformed tx.
      const txMeta = transactions.map((tx, txIndex) => {
        const sigCount = readNumRequiredSignatures(tx.messageBytes);
        const signerPubkeys = parseSignerPubkeys(tx.messageBytes, sigCount);
        const cherrySlot = signerPubkeys.findIndex((pk) => bytesEqual(pk, cherryPubkeyBytes));
        if (cherrySlot < 0) {
          throw new Error(
            `Cherry wallet (${address}) is not a required signer for transaction #${txIndex}. ` +
              `Signers are: ${signerPubkeys.map((_, i) => `[${i}] <32 bytes>`).join(', ')}`,
          );
        }

        const sigCountBytes = encodeCompactU16(sigCount);
        const wireBytes = new Uint8Array(
          sigCountBytes.length + 64 * sigCount + tx.messageBytes.length,
        );
        wireBytes.set(sigCountBytes, 0);
        // Leave all sig slots as zeros — the host wallet fills its slot.
        wireBytes.set(tx.messageBytes, sigCountBytes.length + 64 * sigCount);
        return { wireBytes, sigCount, sigStart: sigCountBytes.length, cherrySlot };
      });

      const base64Txs = txMeta.map(({ wireBytes }) => uint8ArrayToBase64(wireBytes));

      // Single batch request — host presents all transactions to the wallet at once.
      const result = await bridge.request('wallet.signTransactions', { transactions: base64Txs });
      const signedArray = (result as Record<string, unknown>)?.['transactions'] ?? result;

      // Extract Cherry's signature from each signed transaction — from the
      // exact slot that matches Cherry's pubkey, not just "first non-zero".
      return (signedArray as string[]).map((signedBase64, i) => {
        const meta = txMeta[i]!;
        const signedWire = base64ToUint8Array(signedBase64);
        const slotOffset = meta.sigStart + meta.cherrySlot * 64;
        const signature = signedWire.slice(slotOffset, slotOffset + 64);
        if (signature.length !== 64 || signature.every((b) => b === 0)) {
          throw new Error(
            `Host returned transaction ${i} with no signature in Cherry's slot (index ${meta.cherrySlot})`,
          );
        }
        return {
          messageBytes: transactions[i]!.messageBytes,
          signatures: {
            ...transactions[i]!.signatures,
            [address]: signature,
          } as Record<string, Uint8Array>,
        };
      });
    },

    async signMessages(messages) {
      const results = [];
      for (const message of messages) {
        const base64 = uint8ArrayToBase64(message);
        const result = await bridge.request('wallet.signMessage', { message: base64 });
        const sig = (result as Record<string, unknown>)?.['signature'] ?? result;
        results.push(base64ToUint8Array(sig as string));
      }
      return results;
    },
  };
}
