import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { getAppReferenceKeyBytes, planCherryFeeSplit, type PlannedInstruction } from '../attribution';

/** An address as web3.js `PublicKey` or base58 string. */
export type PublicKeyLike = PublicKey | string;

/**
 * Your app's reference key — `sha256("cherry:app:" + appId)` — as a
 * `PublicKey`. Add it to every transaction (see {@link withAppReference}) so
 * the transaction is attributable to your app on-chain.
 */
export function getAppReferenceKey(appId: string): PublicKey {
  return new PublicKey(getAppReferenceKeyBytes(appId));
}

/**
 * A copy of `instruction` with your app reference key appended as a
 * read-only, non-signer account (Solana Pay "reference" style). Programs
 * ignore trailing accounts they don't read — the System program transfer and
 * SPL Token `TransferChecked` (non-multisig owner) do — so put it on one such
 * instruction per transaction. Idempotent: an instruction that already
 * carries the key is returned unchanged.
 */
export function withAppReference(instruction: TransactionInstruction, appId: string): TransactionInstruction {
  const reference = getAppReferenceKey(appId);
  if (instruction.keys.some((key) => key.pubkey.equals(reference))) return instruction;
  return new TransactionInstruction({
    programId: instruction.programId,
    keys: [...instruction.keys, { pubkey: reference, isSigner: false, isWritable: false }],
    data: instruction.data,
  });
}

export interface CherryFeeSplitParams {
  /** Who pays: signs the transfers (and funds any token-account creation). */
  payer: PublicKeyLike;
  /** The developer's receiving wallet (an owner address, not a token account). */
  developer: PublicKeyLike;
  /**
   * Cherry's treasury wallet — take it from the developer portal / Cherry's
   * published config. Never hard-code a guess: payments sent elsewhere are
   * not credited.
   */
  treasury: PublicKeyLike;
  /** Total amount in base units (lamports, or token base units). */
  amount: bigint;
  /** SPL mint. Omit for native SOL. */
  mint?: PublicKeyLike;
  /** Mint decimals — required with `mint` (TransferChecked verifies it). */
  decimals?: number;
  /** Cherry's share in basis points. Default `3000` (30%, the Cherry Pay rate). */
  cherryBps?: number;
  /** Token program of `mint`. Default the SPL Token program; pass Token-2022's id for Token-2022 mints. */
  tokenProgramId?: PublicKeyLike;
  /**
   * Prepend idempotent associated-token-account creation for the developer
   * and treasury (SPL only). Default `true`; the payer funds rent if one is
   * missing. The payer's own token account must already exist.
   */
  createAssociatedTokenAccounts?: boolean;
  /** Attach your app reference key to the first transfer (recommended). */
  appId?: string;
}

/**
 * Instructions that pay `amount` from `payer`, split between the developer
 * and Cherry's treasury inside the SAME transaction (fee model A, Cherry Pay).
 *
 * Exact integer math: Cherry gets `floor(amount * cherryBps / 10_000)`, the
 * developer gets the rest. SOL legs are System transfers; SPL legs are
 * `TransferChecked` between associated token accounts, preceded by
 * idempotent ATA creation. A leg that rounds to zero is omitted.
 *
 * ```ts
 * const ixs = buildCherryFeeSplit({ payer, developer, treasury, amount: 1_000_000n, appId });
 * const tx = new Transaction({ feePayer: payer, recentBlockhash }).add(...ixs);
 * ```
 */
export function buildCherryFeeSplit(params: CherryFeeSplitParams): TransactionInstruction[] {
  return planCherryFeeSplit({
    payer: toBase58(params.payer),
    developer: toBase58(params.developer),
    treasury: toBase58(params.treasury),
    amount: params.amount,
    mint: params.mint === undefined ? undefined : toBase58(params.mint),
    decimals: params.decimals,
    cherryBps: params.cherryBps,
    tokenProgram: params.tokenProgramId === undefined ? undefined : toBase58(params.tokenProgramId),
    createAssociatedTokenAccounts: params.createAssociatedTokenAccounts,
    appId: params.appId,
  }).map(toTransactionInstruction);
}

/** @internal */
export function toTransactionInstruction(planned: PlannedInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(planned.programAddress),
    keys: planned.accounts.map((a) => ({
      pubkey: new PublicKey(a.address),
      isSigner: a.signer,
      isWritable: a.writable,
    })),
    data: toBuffer(planned.data),
  });
}

function toBase58(value: PublicKeyLike): string {
  return typeof value === 'string' ? value : value.toBase58();
}

/**
 * web3.js types instruction data as a Node `Buffer` and some of its code
 * calls Buffer methods on it. Borrow the Buffer class web3.js itself bundles
 * (a `PublicKey#toBuffer()` result) instead of relying on a global `Buffer`,
 * which browsers don't have.
 */
type BufferClass = { from(data: Uint8Array): TransactionInstruction['data'] };
let bufferClass: BufferClass | null = null;
function toBuffer(data: Uint8Array): TransactionInstruction['data'] {
  if (!bufferClass) {
    bufferClass = PublicKey.default.toBuffer().constructor as unknown as BufferClass;
  }
  return bufferClass.from(data);
}
