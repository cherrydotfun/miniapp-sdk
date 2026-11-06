// Type-only imports: the kit entry stays free of a runtime @solana/kit dependency.
import type { AccountRole, Address } from '@solana/kit';
import {
  getAppReferenceAddress,
  planCherryFeeSplit,
  planCherryShareTransfer,
  type PlannedAccount,
  type PlannedInstruction,
} from '../attribution';

/** Anything with an `address` — typically a kit `TransactionSigner`. */
export interface CherryKitSignerLike {
  readonly address: string;
}

/** A kit account meta; `signer` is set when the payer was passed as a signer. */
export interface CherryKitAccountMeta {
  readonly address: Address;
  readonly role: AccountRole;
  readonly signer?: CherryKitSignerLike;
}

/** A kit instruction (assignable to `@solana/kit`'s `Instruction`). */
export interface CherryKitInstruction {
  readonly programAddress: Address;
  readonly accounts: readonly CherryKitAccountMeta[];
  readonly data: Uint8Array;
}

const READONLY = 0 as AccountRole.READONLY;
const WRITABLE = 1 as AccountRole.WRITABLE;
const READONLY_SIGNER = 2 as AccountRole.READONLY_SIGNER;
const WRITABLE_SIGNER = 3 as AccountRole.WRITABLE_SIGNER;

/**
 * Your app's reference key — `sha256("cherry:app:" + appId)` — as a kit
 * `Address`. Add it to every transaction (see {@link withAppReference}) so
 * the transaction is attributable to your app on-chain.
 */
export function getAppReferenceKey(appId: string): Address {
  return getAppReferenceAddress(appId) as Address;
}

/**
 * A copy of `instruction` with your app reference key appended as a
 * read-only, non-signer account (Solana Pay "reference" style). Put it on one
 * instruction per transaction that ignores trailing accounts — a System
 * transfer or an SPL `TransferChecked` from a regular (non-multisig) owner.
 * Idempotent.
 */
export function withAppReference<TInstruction extends { readonly accounts?: readonly unknown[] }>(
  instruction: TInstruction,
  appId: string,
): TInstruction {
  const reference = getAppReferenceKey(appId);
  const accounts = (instruction.accounts ?? []) as readonly { readonly address?: unknown }[];
  if (accounts.some((account) => account.address === reference)) return instruction;
  return {
    ...instruction,
    accounts: [...accounts, { address: reference, role: READONLY }],
  } as TInstruction;
}

export interface CherryKitFeeSplitParams {
  /**
   * Who pays: an address, or a kit `TransactionSigner` — which is then
   * attached to the payer's account metas (for
   * `signTransactionMessageWithSigners`). With `createCherrySigner(cherry)`,
   * pass `signer.address` and sign the compiled transaction with
   * `signer.signTransactions([...])`.
   */
  payer: CherryKitSignerLike | string;
  /** The developer's receiving wallet (an owner address, not a token account). */
  developer: string;
  /** Cherry's treasury wallet, from the developer portal. Never hard-code a guess. */
  treasury: string;
  /** Total amount in base units (lamports, or token base units). */
  amount: bigint;
  /** SPL mint. Omit for native SOL. */
  mint?: string;
  /** Mint decimals — required with `mint`. */
  decimals?: number;
  /** Cherry's share in basis points. Default `1000` (10%). */
  cherryBps?: number;
  /** Token program of `mint`. Default the SPL Token program. */
  tokenProgram?: string;
  /** Prepend idempotent ATA creation for developer and treasury (SPL). Default `true`. */
  createAssociatedTokenAccounts?: boolean;
  /** Attach your app reference key to the first transfer (recommended). */
  appId?: string;
}

/**
 * Kit instructions that pay `amount` from `payer`, split between the
 * developer and Cherry's treasury in the same transaction (an app whose
 * revenue is what users pay it).
 * Same semantics as the web3.js `buildCherryFeeSplit` in
 * `@cherrydotfun/miniapp-sdk/solana`: Cherry gets
 * `floor(amount * cherryBps / 10_000)`, the developer the rest; zero legs are
 * omitted; SPL legs use `TransferChecked` between associated token accounts.
 */
export function buildCherryFeeSplit(params: CherryKitFeeSplitParams): CherryKitInstruction[] {
  const payerSigner = typeof params.payer === 'string' ? null : params.payer;
  const payer = typeof params.payer === 'string' ? params.payer : params.payer.address;
  return planCherryFeeSplit({
    payer,
    developer: params.developer,
    treasury: params.treasury,
    amount: params.amount,
    mint: params.mint,
    decimals: params.decimals,
    cherryBps: params.cherryBps,
    tokenProgram: params.tokenProgram,
    createAssociatedTokenAccounts: params.createAssociatedTokenAccounts,
    appId: params.appId,
  }).map((ix) => toKitInstruction(ix, payerSigner));
}

export interface CherryKitShareTransferParams {
  /** Who pays: an address, or a kit `TransactionSigner` (attached to its metas). */
  payer: CherryKitSignerLike | string;
  /** Cherry's treasury wallet, from the developer portal. Never hard-code a guess. */
  treasury: string;
  /** Cherry's share itself, in base units: `cherryShareOf(yourFee)`. */
  amount: bigint;
  /** SPL mint. Omit for native SOL. */
  mint?: string;
  /** Mint decimals — required with `mint`. */
  decimals?: number;
  /** Token program of `mint`. Default the SPL Token program. */
  tokenProgram?: string;
  /** Prepend idempotent creation of the treasury's token account (SPL). Default `true`. */
  createAssociatedTokenAccounts?: boolean;
  /** Attach your app reference key (how Cherry credits the payment to your app). */
  appId?: string;
}

/**
 * Kit instructions for one transfer of Cherry's share to its treasury, for an
 * app whose own fee is collected elsewhere. Same semantics as the web3.js
 * `buildCherryShareTransfer` in `@cherrydotfun/miniapp-sdk/solana`.
 */
export function buildCherryShareTransfer(params: CherryKitShareTransferParams): CherryKitInstruction[] {
  const payerSigner = typeof params.payer === 'string' ? null : params.payer;
  const payer = typeof params.payer === 'string' ? params.payer : params.payer.address;
  return planCherryShareTransfer({
    payer,
    treasury: params.treasury,
    amount: params.amount,
    mint: params.mint,
    decimals: params.decimals,
    tokenProgram: params.tokenProgram,
    createAssociatedTokenAccounts: params.createAssociatedTokenAccounts,
    appId: params.appId,
  }).map((ix) => toKitInstruction(ix, payerSigner));
}

function toKitInstruction(planned: PlannedInstruction, payerSigner: CherryKitSignerLike | null): CherryKitInstruction {
  return {
    programAddress: planned.programAddress as Address,
    accounts: planned.accounts.map((account) => toKitAccount(account, payerSigner)),
    data: planned.data,
  };
}

function toKitAccount(account: PlannedAccount, payerSigner: CherryKitSignerLike | null): CherryKitAccountMeta {
  const role = account.signer
    ? account.writable
      ? WRITABLE_SIGNER
      : READONLY_SIGNER
    : account.writable
      ? WRITABLE
      : READONLY;
  const meta = { address: account.address as Address, role };
  return account.signer && payerSigner && payerSigner.address === account.address
    ? { ...meta, signer: payerSigner }
    : meta;
}
