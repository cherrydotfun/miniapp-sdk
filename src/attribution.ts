import { decodeAddress, encodeBase58 } from './internal/base58';
import { findProgramAddress } from './internal/pda';
import { sha256 } from './internal/sha256';

/**
 * On-chain attribution & Cherry fee helpers, independent of any Solana
 * library. The `/solana` (web3.js) and `/kit` (@solana/kit) entries wrap these
 * into their own instruction types.
 */

// ── fee models ─────────────────────────────────────────────────────────────

/** Model A — Cherry Pay split: Cherry's share of a payment, in basis points (30%). */
export const CHERRY_PAY_FEE_BPS = 3000;
/** Model B — protocol referral fees: Cherry's share of the referral fee, in basis points (30%). */
export const CHERRY_REFERRAL_SHARE_BPS = 3000;
/** Model D — volume metering: Cherry's fee on the app's confirmed volume, in basis points (0.25%). */
export const CHERRY_VOLUME_FEE_BPS = 25;

const BPS_DENOMINATOR = 10_000n;
const U64_MAX = (1n << 64n) - 1n;

// ── app reference key ──────────────────────────────────────────────────────

/** The domain-separation prefix of an app reference key: `sha256("cherry:app:" + appId)`. */
export const CHERRY_APP_REFERENCE_PREFIX = 'cherry:app:';

/**
 * The 32 bytes of your app's reference key: `sha256("cherry:app:" + appId)`
 * (UTF-8). Added as a read-only, non-signer account to one instruction of
 * every transaction, it makes the transaction attributable to your app
 * on-chain (Solana Pay "reference" style): your volume and fees become visible
 * on public dashboards such as Dune, and you can find your own transactions.
 * It is attribution only — Cherry does not bill from it (volume fees are
 * metered by the host's own transaction check), so leaving it out never
 * lowers a fee.
 */
export function getAppReferenceKeyBytes(appId: string): Uint8Array {
  if (typeof appId !== 'string' || appId.length === 0) {
    throw new TypeError('appId must be a non-empty string');
  }
  return sha256(new TextEncoder().encode(CHERRY_APP_REFERENCE_PREFIX + appId));
}

/** Your app's reference key as a base58 address. */
export function getAppReferenceAddress(appId: string): string {
  return encodeBase58(getAppReferenceKeyBytes(appId));
}

// ── fee split math ─────────────────────────────────────────────────────────

export interface CherryFeeSplitAmounts {
  /** What the developer receives: `amount - cherryAmount` (gets any rounding remainder). */
  developerAmount: bigint;
  /** Cherry's share: `floor(amount * cherryBps / 10_000)`. */
  cherryAmount: bigint;
}

/**
 * Split `amount` (base units: lamports, or token base units) between the
 * developer and Cherry with exact integer math. Cherry's share is rounded
 * DOWN; the developer gets the remainder, so the two always add up to
 * `amount`.
 */
export function splitCherryFee(amount: bigint, cherryBps: number = CHERRY_PAY_FEE_BPS): CherryFeeSplitAmounts {
  if (typeof amount !== 'bigint') throw new TypeError('amount must be a bigint (base units)');
  if (amount <= 0n) throw new RangeError('amount must be greater than 0');
  if (amount > U64_MAX) throw new RangeError('amount does not fit in a u64');
  if (!Number.isInteger(cherryBps) || cherryBps < 0 || cherryBps > 10_000) {
    throw new RangeError('cherryBps must be an integer between 0 and 10000');
  }
  const cherryAmount = (amount * BigInt(cherryBps)) / BPS_DENOMINATOR;
  return { developerAmount: amount - cherryAmount, cherryAmount };
}

// ── instruction plans (library-agnostic) ───────────────────────────────────

export const SYSTEM_PROGRAM_ADDRESS = '11111111111111111111111111111111';
export const TOKEN_PROGRAM_ADDRESS = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ADDRESS = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ASSOCIATED_TOKEN_PROGRAM_ADDRESS = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

/** @internal An account of a {@link PlannedInstruction}. */
export interface PlannedAccount {
  address: string;
  signer: boolean;
  writable: boolean;
}

/** @internal A library-agnostic instruction the `/solana` and `/kit` entries convert. */
export interface PlannedInstruction {
  programAddress: string;
  accounts: PlannedAccount[];
  data: Uint8Array;
}

/** The associated token account of `owner` for `mint` under `tokenProgram`. */
export function getAssociatedTokenAddress(
  owner: string,
  mint: string,
  tokenProgram: string = TOKEN_PROGRAM_ADDRESS,
): string {
  const [address] = findProgramAddress(
    [decodeAddress(owner, 'owner'), decodeAddress(tokenProgram, 'tokenProgram'), decodeAddress(mint, 'mint')],
    decodeAddress(ASSOCIATED_TOKEN_PROGRAM_ADDRESS),
  );
  return encodeBase58(address);
}

/** @internal Inputs of a fee split, with every address as base58. */
export interface FeeSplitPlanInput {
  payer: string;
  developer: string;
  treasury: string;
  amount: bigint;
  mint?: string | undefined;
  decimals?: number | undefined;
  cherryBps?: number | undefined;
  tokenProgram?: string | undefined;
  createAssociatedTokenAccounts?: boolean | undefined;
  appId?: string | undefined;
}

function u64le(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

function systemTransfer(from: string, to: string, lamports: bigint): PlannedInstruction {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true); // SystemInstruction::Transfer
  view.setBigUint64(4, lamports, true);
  return {
    programAddress: SYSTEM_PROGRAM_ADDRESS,
    accounts: [
      { address: from, signer: true, writable: true },
      { address: to, signer: false, writable: true },
    ],
    data,
  };
}

function createAtaIdempotent(payer: string, ata: string, owner: string, mint: string, tokenProgram: string): PlannedInstruction {
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    accounts: [
      { address: payer, signer: true, writable: true },
      { address: ata, signer: false, writable: true },
      { address: owner, signer: false, writable: false },
      { address: mint, signer: false, writable: false },
      { address: SYSTEM_PROGRAM_ADDRESS, signer: false, writable: false },
      { address: tokenProgram, signer: false, writable: false },
    ],
    data: new Uint8Array([1]), // AssociatedTokenAccountInstruction::CreateIdempotent
  };
}

function transferChecked(
  source: string,
  mint: string,
  destination: string,
  owner: string,
  amount: bigint,
  decimals: number,
  tokenProgram: string,
): PlannedInstruction {
  const data = new Uint8Array(10);
  data[0] = 12; // TokenInstruction::TransferChecked
  data.set(u64le(amount), 1);
  data[9] = decimals;
  return {
    programAddress: tokenProgram,
    accounts: [
      { address: source, signer: false, writable: true },
      { address: mint, signer: false, writable: false },
      { address: destination, signer: false, writable: true },
      { address: owner, signer: true, writable: false },
    ],
    data,
  };
}

/** @internal Append the app reference key (read-only, non-signer) unless already present. */
export function withAppReferencePlan(instruction: PlannedInstruction, appId: string): PlannedInstruction {
  const reference = getAppReferenceAddress(appId);
  if (instruction.accounts.some((a) => a.address === reference)) return instruction;
  return {
    ...instruction,
    accounts: [...instruction.accounts, { address: reference, signer: false, writable: false }],
  };
}

/**
 * @internal The instructions of a Cherry Pay split, library-agnostic.
 * Order: [create developer ATA, create treasury ATA] (SPL only, when enabled
 * and the leg is non-zero), developer transfer, Cherry transfer. A zero leg is
 * omitted. With `appId`, the reference key rides on the first transfer.
 */
export function planCherryFeeSplit(input: FeeSplitPlanInput): PlannedInstruction[] {
  const payer = encodeBase58(decodeAddress(input.payer, 'payer'));
  const developer = encodeBase58(decodeAddress(input.developer, 'developer'));
  const treasury = encodeBase58(decodeAddress(input.treasury, 'treasury'));
  const { developerAmount, cherryAmount } = splitCherryFee(input.amount, input.cherryBps ?? CHERRY_PAY_FEE_BPS);
  const legs: Array<{ to: string; amount: bigint }> = [
    { to: developer, amount: developerAmount },
    { to: treasury, amount: cherryAmount },
  ].filter((leg) => leg.amount > 0n);

  const instructions: PlannedInstruction[] = [];
  const transfers: PlannedInstruction[] = [];

  if (input.mint === undefined) {
    if (input.decimals !== undefined && input.decimals !== 9) {
      throw new RangeError('SOL has 9 decimals — omit `decimals` (or pass 9) when `mint` is omitted');
    }
    for (const leg of legs) transfers.push(systemTransfer(payer, leg.to, leg.amount));
  } else {
    const mint = encodeBase58(decodeAddress(input.mint, 'mint'));
    const tokenProgram = encodeBase58(decodeAddress(input.tokenProgram ?? TOKEN_PROGRAM_ADDRESS, 'tokenProgram'));
    const decimals = input.decimals;
    if (decimals === undefined || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
      throw new RangeError('`decimals` (the mint decimals, 0-255) is required for an SPL token split');
    }
    const source = getAssociatedTokenAddress(payer, mint, tokenProgram);
    const createAtas = input.createAssociatedTokenAccounts ?? true;
    for (const leg of legs) {
      const destination = getAssociatedTokenAddress(leg.to, mint, tokenProgram);
      if (createAtas) instructions.push(createAtaIdempotent(payer, destination, leg.to, mint, tokenProgram));
      transfers.push(transferChecked(source, mint, destination, payer, leg.amount, decimals, tokenProgram));
    }
  }

  if (input.appId !== undefined && transfers[0]) {
    transfers[0] = withAppReferencePlan(transfers[0], input.appId);
  }
  return [...instructions, ...transfers];
}
