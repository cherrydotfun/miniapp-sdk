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
      // Wrap ALL transactions into wire format and encode to base64
      const base64Txs = transactions.map((tx) => {
        // Wire format: [compact-u16 num_sigs=1] [64 zero bytes (sig placeholder)] [messageBytes]
        const wireBytes = new Uint8Array(1 + 64 + tx.messageBytes.length);
        wireBytes[0] = 1; // compact-u16: 1 signature
        // bytes 1..64 stay zero (signature placeholder)
        wireBytes.set(tx.messageBytes, 65);
        return uint8ArrayToBase64(wireBytes);
      });

      // Single batch request — host presents all transactions to the wallet at once
      const result = await bridge.request('wallet.signTransactions', { transactions: base64Txs });
      const signedArray = (result as Record<string, unknown>)?.['transactions'] ?? result;

      // Extract signatures from all signed transactions
      return (signedArray as string[]).map((signedBase64, i) => {
        const signedWire = base64ToUint8Array(signedBase64);
        const signature = signedWire.slice(1, 65);
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
