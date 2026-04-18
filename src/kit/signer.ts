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
      // Build a correctly-sized wire format for each transaction.
      // Wire: [compact-u16 sigCount] [sigCount * 64 zero bytes] [messageBytes]
      //
      // sigCount MUST equal `numRequiredSignatures` from the message header,
      // otherwise the host's `VersionedTransaction.deserialize` produces a
      // transaction whose sig-array length doesn't match its header — the
      // wallet then either refuses to sign or returns a malformed tx.
      //
      // We fill all signature slots with zeros and rely on the host wallet
      // to add its own signature in the correct slot; any pre-existing
      // signatures from other signers are preserved by the caller below
      // via `...tx.signatures` in the returned object.
      const txMeta = transactions.map((tx) => {
        const sigCount = readNumRequiredSignatures(tx.messageBytes);
        const sigCountBytes = encodeCompactU16(sigCount);
        const wireBytes = new Uint8Array(
          sigCountBytes.length + 64 * sigCount + tx.messageBytes.length,
        );
        wireBytes.set(sigCountBytes, 0);
        wireBytes.set(tx.messageBytes, sigCountBytes.length + 64 * sigCount);
        return { wireBytes, sigCount, sigStart: sigCountBytes.length };
      });

      const base64Txs = txMeta.map(({ wireBytes }) => uint8ArrayToBase64(wireBytes));

      // Single batch request — host presents all transactions to the wallet at once
      const result = await bridge.request('wallet.signTransactions', { transactions: base64Txs });
      const signedArray = (result as Record<string, unknown>)?.['transactions'] ?? result;

      // Extract this signer's signature from each signed transaction.
      // Since we sent all-zero signatures, the host wallet writes its
      // signature into its own slot — we find it by scanning for the
      // first non-zero 64-byte slot.
      return (signedArray as string[]).map((signedBase64, i) => {
        const meta = txMeta[i]!;
        const signedWire = base64ToUint8Array(signedBase64);
        let signature: Uint8Array | null = null;
        for (let j = 0; j < meta.sigCount; j++) {
          const slot = signedWire.slice(meta.sigStart + j * 64, meta.sigStart + (j + 1) * 64);
          if (slot.some((b) => b !== 0)) {
            signature = slot;
            break;
          }
        }
        if (!signature) {
          throw new Error('Host returned transaction with no signature from this signer');
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
