import { createHash, randomBytes } from 'node:crypto';
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
} from '@solana/kit';
import {
  Keypair,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  CHERRY_REVENUE_SHARE_BPS,
  cherryShareOf,
  getAppReferenceAddress,
  getAppReferenceKeyBytes,
  getAssociatedTokenAddress,
  splitCherryFee,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '../src/attribution';
import { decodeBase58, encodeBase58 } from '../src/internal/base58';
import { findProgramAddress, isOnCurve } from '../src/internal/pda';
import { sha256 } from '../src/internal/sha256';
import * as kit from '../src/kit';
import * as web3 from '../src/solana';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const nodeSha256 = (bytes: Uint8Array) => new Uint8Array(createHash('sha256').update(bytes).digest());

const PAYER = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const DEVELOPER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const TREASURY = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const BLOCKHASH = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';

describe('sha256', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    const enc = new TextEncoder();
    expect(hex(sha256(enc.encode('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(sha256(enc.encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex(sha256(enc.encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('matches node:crypto on every length around the block boundaries', () => {
    for (let length = 0; length < 300; length++) {
      const input = new Uint8Array(randomBytes(length));
      expect(hex(sha256(input))).toBe(hex(nodeSha256(input)));
    }
  });
});

describe('base58', () => {
  it('matches web3.js and round-trips, leading zeros included', () => {
    for (let i = 0; i < 200; i++) {
      const bytes = new Uint8Array(randomBytes(32));
      if (i % 10 === 0) bytes.fill(0, 0, (i / 10) % 4);
      const encoded = encodeBase58(bytes);
      expect(encoded).toBe(new PublicKey(bytes).toBase58());
      expect(hex(decodeBase58(encoded))).toBe(hex(bytes));
    }
    expect(encodeBase58(new Uint8Array(32))).toBe('11111111111111111111111111111111');
  });
});

describe('ed25519 curve check and PDAs', () => {
  it('uses d = -121665/121666 mod p', () => {
    const p = (1n << 255n) - 19n;
    const pow = (b: bigint, e: bigint): bigint => {
      let r = 1n;
      b %= p;
      for (; e > 0n; e >>= 1n, b = (b * b) % p) if (e & 1n) r = (r * b) % p;
      return r;
    };
    const d = (((-121665n * pow(121666n, p - 2n)) % p) + p) % p;
    expect(d).toBe(37095705934669439343138083508754565189542113879843219016388785533085940283555n);
  });

  it('agrees with web3.js PublicKey.isOnCurve', () => {
    let onCurve = 0;
    for (let i = 0; i < 400; i++) {
      const bytes = new Uint8Array(randomBytes(32));
      const expected = PublicKey.isOnCurve(bytes);
      expect(isOnCurve(bytes)).toBe(expected);
      if (expected) onCurve++;
    }
    expect(onCurve).toBeGreaterThan(100); // both outcomes exercised
    for (let i = 0; i < 20; i++) expect(isOnCurve(Keypair.generate().publicKey.toBytes())).toBe(true);
  });

  it('derives the same PDAs and bumps as web3.js', () => {
    for (let i = 0; i < 100; i++) {
      const seeds = [new Uint8Array(randomBytes(32)), new Uint8Array(randomBytes(i % 33))];
      const program = Keypair.generate().publicKey;
      const [address, bump] = findProgramAddress(seeds, program.toBytes());
      const [expected, expectedBump] = PublicKey.findProgramAddressSync(seeds, program);
      expect(encodeBase58(address)).toBe(expected.toBase58());
      expect(bump).toBe(expectedBump);
    }
  });

  it('derives associated token accounts (known vector + Token-2022)', () => {
    expect(getAssociatedTokenAddress(DEVELOPER, USDC)).toBe('FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B');
    const [expected] = PublicKey.findProgramAddressSync(
      [new PublicKey(DEVELOPER).toBytes(), new PublicKey(TOKEN_2022_PROGRAM_ADDRESS).toBytes(), new PublicKey(USDC).toBytes()],
      new PublicKey(ATA_PROGRAM),
    );
    expect(getAssociatedTokenAddress(DEVELOPER, USDC, TOKEN_2022_PROGRAM_ADDRESS)).toBe(expected.toBase58());
  });
});

describe('app reference key', () => {
  it('is sha256("cherry:app:" + appId) — stable known vectors', () => {
    expect(hex(getAppReferenceKeyBytes('example-app'))).toBe(
      '212f1e649962b9593c271dd4787061e7bf366e011a7a6e53e156a541d9960fdc',
    );
    expect(getAppReferenceAddress('example-app')).toBe('3EY8K5SVayw9Rx7sSKf1p4Q5cDeVoga6T6BRyLZZ2wZV');
    expect(getAppReferenceAddress('app_123')).toBe('6kVet2MKUWgsoMhteJ9rVZuKFY3qPzsV7YiC3NA1RrK1');
    expect(hex(getAppReferenceKeyBytes('ünïcødé-app'))).toBe(
      hex(nodeSha256(new TextEncoder().encode('cherry:app:ünïcødé-app'))),
    );
    expect(web3.getAppReferenceKey('example-app').toBase58()).toBe('3EY8K5SVayw9Rx7sSKf1p4Q5cDeVoga6T6BRyLZZ2wZV');
    expect(kit.getAppReferenceKey('example-app')).toBe('3EY8K5SVayw9Rx7sSKf1p4Q5cDeVoga6T6BRyLZZ2wZV');
  });

  it('rejects an empty app id', () => {
    expect(() => getAppReferenceKeyBytes('')).toThrow(TypeError);
  });

  it('web3.js withAppReference appends a read-only non-signer key, once, without mutating', () => {
    const ix = SystemProgram.transfer({ fromPubkey: new PublicKey(PAYER), toPubkey: new PublicKey(DEVELOPER), lamports: 5 });
    const tagged = web3.withAppReference(ix, 'example-app');
    expect(ix.keys).toHaveLength(2);
    expect(tagged.keys).toHaveLength(3);
    expect(tagged.keys[2]).toEqual({ pubkey: web3.getAppReferenceKey('example-app'), isSigner: false, isWritable: false });
    expect(tagged.data.equals(ix.data)).toBe(true);
    expect(web3.withAppReference(tagged, 'example-app')).toBe(tagged);
    // The System program still decodes it as the same transfer.
    expect(SystemInstruction.decodeTransfer(tagged).lamports).toBe(5n);
  });

  it('kit withAppReference appends a READONLY account, once', () => {
    const ix: Instruction = {
      programAddress: '11111111111111111111111111111111' as Address,
      accounts: [{ address: PAYER as Address, role: 3 }],
      data: new Uint8Array([1]),
    };
    const tagged = kit.withAppReference(ix, 'example-app');
    expect(tagged.accounts).toEqual([
      { address: PAYER, role: 3 },
      { address: '3EY8K5SVayw9Rx7sSKf1p4Q5cDeVoga6T6BRyLZZ2wZV', role: 0 },
    ]);
    expect(ix.accounts).toHaveLength(1);
    expect(kit.withAppReference(tagged, 'example-app')).toBe(tagged);
    const noAccounts: Instruction = { programAddress: ix.programAddress };
    expect(kit.withAppReference(noAccounts, 'x').accounts).toHaveLength(1);
  });
});

describe('splitCherryFee', () => {
  it.each([
    [1_000_000n, 3000, 700_000n, 300_000n],
    [10_001n, 3000, 7_001n, 3_000n],
    [1n, 3000, 1n, 0n],
    [3n, 3333, 3n, 0n],
    [999n, 0, 999n, 0n],
    [999n, 10_000, 0n, 999n],
    [(1n << 64n) - 1n, 3000, 12912720851596686131n, 5534023222112865484n],
  ])('%s at %i bps → developer %s, cherry %s', (amount, bps, developerAmount, cherryAmount) => {
    expect(splitCherryFee(amount, bps)).toEqual({ developerAmount, cherryAmount });
  });

  it("defaults to Cherry's 30% share", () => {
    expect(CHERRY_REVENUE_SHARE_BPS).toBe(3000);
    expect(splitCherryFee(100n)).toEqual({ developerAmount: 70n, cherryAmount: 30n });
  });

  it('always adds up, rounds Cherry down, gives the remainder to the developer', () => {
    for (let i = 0; i < 2000; i++) {
      const amount = BigInt(`0x${randomBytes(1 + (i % 8)).toString('hex')}`) + 1n;
      const bps = i % 10_001;
      const { developerAmount, cherryAmount } = splitCherryFee(amount, bps);
      expect(developerAmount + cherryAmount).toBe(amount);
      expect(cherryAmount * 10_000n <= amount * BigInt(bps)).toBe(true);
      expect((cherryAmount + 1n) * 10_000n > amount * BigInt(bps)).toBe(true);
    }
  });

  it('rejects bad input', () => {
    expect(() => splitCherryFee(0n)).toThrow(RangeError);
    expect(() => splitCherryFee(-1n)).toThrow(RangeError);
    expect(() => splitCherryFee(1n << 64n)).toThrow(RangeError);
    expect(() => splitCherryFee(100 as unknown as bigint)).toThrow(TypeError);
    expect(() => splitCherryFee(100n, 10_001)).toThrow(RangeError);
    expect(() => splitCherryFee(100n, -1)).toThrow(RangeError);
    expect(() => splitCherryFee(100n, 12.5)).toThrow(RangeError);
  });
});

describe('buildCherryFeeSplit (web3.js)', () => {
  it('splits SOL into two System transfers and tags the first', () => {
    const ixs = web3.buildCherryFeeSplit({
      payer: new PublicKey(PAYER),
      developer: DEVELOPER,
      treasury: TREASURY,
      amount: 1_000_000_001n,
      appId: 'example-app',
    });
    expect(ixs).toHaveLength(2);
    const [dev, cherry] = ixs.map((ix) => SystemInstruction.decodeTransfer(ix));
    expect(dev).toMatchObject({ lamports: 700_000_001n });
    expect(dev!.fromPubkey.toBase58()).toBe(PAYER);
    expect(dev!.toPubkey.toBase58()).toBe(DEVELOPER);
    expect(cherry).toMatchObject({ lamports: 300_000_000n });
    expect(cherry!.toPubkey.toBase58()).toBe(TREASURY);
    expect(ixs[0]!.keys.map((k) => k.pubkey.toBase58())).toContain('3EY8K5SVayw9Rx7sSKf1p4Q5cDeVoga6T6BRyLZZ2wZV');
    expect(ixs[1]!.keys).toHaveLength(2);
    // Byte-identical to web3.js's own transfer (plus the reference account).
    const own = SystemProgram.transfer({ fromPubkey: new PublicKey(PAYER), toPubkey: new PublicKey(TREASURY), lamports: 300_000_000n });
    expect(ixs[1]!.data.equals(own.data)).toBe(true);
  });

  it('omits a leg that rounds to zero', () => {
    const ixs = web3.buildCherryFeeSplit({ payer: PAYER, developer: DEVELOPER, treasury: TREASURY, amount: 3n });
    expect(ixs).toHaveLength(1);
    expect(SystemInstruction.decodeTransfer(ixs[0]!).lamports).toBe(3n);
  });

  it('builds an SPL split with idempotent ATA creation and TransferChecked', () => {
    const ixs = web3.buildCherryFeeSplit({
      payer: PAYER,
      developer: DEVELOPER,
      treasury: TREASURY,
      amount: 10_000_000n, // 10 USDC
      mint: USDC,
      decimals: 6,
      appId: 'example-app',
    });
    expect(ixs.map((ix) => ix.programId.toBase58())).toEqual([ATA_PROGRAM, ATA_PROGRAM, TOKEN_PROGRAM, TOKEN_PROGRAM]);

    const [createDev, createTreasury, toDev, toCherry] = ixs;
    const devAta = getAssociatedTokenAddress(DEVELOPER, USDC);
    const treasuryAta = getAssociatedTokenAddress(TREASURY, USDC);
    const payerAta = getAssociatedTokenAddress(PAYER, USDC);

    expect(Array.from(createDev!.data)).toEqual([1]);
    expect(createDev!.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual([
      [PAYER, true, true],
      [devAta, false, true],
      [DEVELOPER, false, false],
      [USDC, false, false],
      ['11111111111111111111111111111111', false, false],
      [TOKEN_PROGRAM, false, false],
    ]);
    expect(createTreasury!.keys[1]!.pubkey.toBase58()).toBe(treasuryAta);

    const checked = (ix: typeof toDev) => {
      const data = Buffer.from(ix!.data);
      return { tag: data[0], amount: data.readBigUInt64LE(1), decimals: data[9], length: data.length };
    };
    expect(checked(toDev)).toEqual({ tag: 12, amount: 7_000_000n, decimals: 6, length: 10 });
    expect(checked(toCherry)).toEqual({ tag: 12, amount: 3_000_000n, decimals: 6, length: 10 });
    expect(toDev!.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual([
      [payerAta, false, true],
      [USDC, false, false],
      [devAta, false, true],
      [PAYER, true, false],
      ['3EY8K5SVayw9Rx7sSKf1p4Q5cDeVoga6T6BRyLZZ2wZV', false, false],
    ]);
    expect(toCherry!.keys[2]!.pubkey.toBase58()).toBe(treasuryAta);
  });

  it('can skip ATA creation and use Token-2022', () => {
    const ixs = web3.buildCherryFeeSplit({
      payer: PAYER,
      developer: DEVELOPER,
      treasury: TREASURY,
      amount: 100n,
      mint: USDC,
      decimals: 6,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      createAssociatedTokenAccounts: false,
    });
    expect(ixs).toHaveLength(2);
    expect(ixs.every((ix) => ix.programId.toBase58() === TOKEN_2022_PROGRAM_ADDRESS)).toBe(true);
    expect(ixs[0]!.keys[2]!.pubkey.toBase58()).toBe(getAssociatedTokenAddress(DEVELOPER, USDC, TOKEN_2022_PROGRAM_ADDRESS));
  });

  it('validates its input', () => {
    const base = { payer: PAYER, developer: DEVELOPER, treasury: TREASURY, amount: 100n };
    expect(() => web3.buildCherryFeeSplit({ ...base, mint: USDC })).toThrow(/decimals/);
    expect(() => web3.buildCherryFeeSplit({ ...base, decimals: 6 })).toThrow(/SOL has 9 decimals/);
    expect(() => web3.buildCherryFeeSplit({ ...base, treasury: 'not-an-address' })).toThrow(/treasury/);
    expect(() => web3.buildCherryFeeSplit({ ...base, amount: 0n })).toThrow(RangeError);
  });

  it('serializes in legacy and v0 transactions', () => {
    const ixs = web3.buildCherryFeeSplit({ payer: PAYER, developer: DEVELOPER, treasury: TREASURY, amount: 10n, mint: USDC, decimals: 6, appId: 'a' });
    const legacy = new Transaction({ feePayer: new PublicKey(PAYER), recentBlockhash: BLOCKHASH }).add(...ixs);
    const bytes = legacy.serialize({ requireAllSignatures: false, verifySignatures: false });
    expect(Transaction.from(bytes).instructions).toHaveLength(4);
    const message = new TransactionMessage({ payerKey: new PublicKey(PAYER), recentBlockhash: BLOCKHASH, instructions: ixs }).compileToV0Message();
    const v0 = new VersionedTransaction(message);
    expect(VersionedTransaction.deserialize(v0.serialize()).message.compiledInstructions).toHaveLength(4);
  });
});

describe('buildCherryFeeSplit (kit)', () => {
  it('matches the web3.js instructions account for account', () => {
    const params = { payer: PAYER, developer: DEVELOPER, treasury: TREASURY, amount: 123_456_789n, mint: USDC, decimals: 6, appId: 'example-app' };
    const fromKit = kit.buildCherryFeeSplit(params);
    const fromWeb3 = web3.buildCherryFeeSplit(params);
    expect(fromKit).toHaveLength(fromWeb3.length);
    fromKit.forEach((ix, i) => {
      const other = fromWeb3[i]!;
      expect(ix.programAddress).toBe(other.programId.toBase58());
      expect(hex(ix.data)).toBe(other.data.toString('hex'));
      expect(ix.accounts.map((a) => [a.address, a.role])).toEqual(
        other.keys.map((k) => [k.pubkey.toBase58(), (k.isSigner ? 2 : 0) | (k.isWritable ? 1 : 0)]),
      );
    });
  });

  it('attaches the payer signer and compiles into a kit transaction', () => {
    const signer = { address: PAYER as Address, signTransactions: async () => [] };
    const ixs = kit.buildCherryFeeSplit({ payer: signer, developer: DEVELOPER, treasury: TREASURY, amount: 1_000n, appId: 'example-app' });
    expect(ixs[0]!.accounts[0]).toMatchObject({ address: PAYER, role: 3, signer });
    expect(ixs[0]!.accounts[1]).not.toHaveProperty('signer');

    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(PAYER as Address, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH as Blockhash, lastValidBlockHeight: 1n }, m),
      (m) => appendTransactionMessageInstructions(ixs, m),
    );
    const compiled = compileTransaction(message);
    expect(Object.keys(compiled.signatures)).toEqual([PAYER]);
  });
});

describe('buildCherryShareTransfer — Cherry\'s share alone', () => {
  it('cherryShareOf is floor(fee * 30%)', () => {
    expect(cherryShareOf(100n)).toBe(30n);
    expect(cherryShareOf(3n)).toBe(0n);
    expect(cherryShareOf(1_000_001n, 2500)).toBe(250_000n);
  });

  it('web3.js: one SOL transfer to the treasury, tagged with the app reference', () => {
    const ixs = web3.buildCherryShareTransfer({ payer: PAYER, treasury: TREASURY, amount: 300_000n, appId: 'example-app' });
    expect(ixs).toHaveLength(1);
    const t = SystemInstruction.decodeTransfer(ixs[0]!);
    expect(t.fromPubkey.toBase58()).toBe(PAYER);
    expect(t.toPubkey.toBase58()).toBe(TREASURY);
    expect(t.lamports).toBe(300_000n);
    expect(ixs[0]!.keys.map((k) => k.pubkey.toBase58())).toContain(getAppReferenceAddress('example-app'));
  });

  it('web3.js: SPL creates the treasury account idempotently, then TransferChecked from the payer', () => {
    const ixs = web3.buildCherryShareTransfer({ payer: PAYER, treasury: TREASURY, amount: 1_500_000n, mint: USDC, decimals: 6, appId: 'a' });
    expect(ixs).toHaveLength(2);
    expect(ixs[0]!.programId.toBase58()).toBe(ATA_PROGRAM);
    expect(ixs[1]!.programId.toBase58()).toBe(TOKEN_PROGRAM);
    expect(ixs[1]!.data[0]).toBe(12);
    expect(Buffer.from(ixs[1]!.data).readBigUInt64LE(1)).toBe(1_500_000n);
    expect(ixs[1]!.keys[2]!.pubkey.toBase58()).toBe(getAssociatedTokenAddress(TREASURY, USDC));
  });

  it('kit matches web3.js account for account', () => {
    const a = web3.buildCherryShareTransfer({ payer: PAYER, treasury: TREASURY, amount: 7n, mint: USDC, decimals: 6, appId: 'a' });
    const b = kit.buildCherryShareTransfer({ payer: PAYER, treasury: TREASURY, amount: 7n, mint: USDC, decimals: 6, appId: 'a' });
    expect(b.map((ix) => ix.accounts.map((m) => m.address))).toEqual(a.map((ix) => ix.keys.map((k) => k.pubkey.toBase58())));
  });

  it('refuses a zero or negative share', () => {
    expect(() => web3.buildCherryShareTransfer({ payer: PAYER, treasury: TREASURY, amount: 0n })).toThrow(RangeError);
    expect(() => web3.buildCherryShareTransfer({ payer: PAYER, treasury: TREASURY, amount: -1n })).toThrow(RangeError);
  });
});
