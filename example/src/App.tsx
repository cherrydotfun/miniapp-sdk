import { useState } from 'react';
import {
  useCherryMiniApp,
  useCherryApp,
  useCherryWallet,
  useCherryNavigate,
  useCherryEnvironment,
} from '@cherrydotfun/miniapp-sdk/react';
import { createCherrySigner, type CherryTransactionSigner } from '@cherrydotfun/miniapp-sdk/kit';
import type { Blockhash } from '@solana/kit';
import { RawSignals } from './StandaloneView';

function toBase64(arr: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]!);
  }
  return btoa(binary);
}

async function decodeBase64(s: string): Promise<Uint8Array> {
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function App() {
  const { user, room, launchToken, isReady, error } = useCherryMiniApp();
  const cherryWallet = useCherryWallet();
  const navigate = useCherryNavigate();
  const { isEmbedded, platform } = useCherryEnvironment();

  // Tab state
  const [activeTab, setActiveTab] = useState<'web3js' | 'kit'>('web3js');

  // Transaction version (legacy or versioned v0) — applied to all tx-building handlers
  const [txVersion, setTxVersion] = useState<'legacy' | 'v0'>('legacy');

  // Navigate state (shared)
  const [navResult, setNavResult] = useState<string | null>(null);
  const [navError, setNavError] = useState<string | null>(null);

  // Verify state (shared)
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h2 style={styles.heading}>Connection Error</h2>
          <p style={styles.errorText}>{error.message}</p>
          <p style={styles.hint}>Make sure this app is running inside Cherry messenger.</p>
        </div>
        <RawSignals />
      </div>
    );
  }

  if (!isReady) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.spinner} />
          <p style={styles.hint}>Connecting to Cherry...</p>
        </div>
        <RawSignals />
      </div>
    );
  }

  const truncate = (s: string, len = 8) =>
    s.length > len * 2 ? `${s.slice(0, len)}...${s.slice(-len)}` : s;

  const handleNavigateProfile = async () => {
    setNavResult(null); setNavError(null);
    try { await navigate.userProfile('cherrydev.sol'); setNavResult('Opened cherrydev.sol'); }
    catch (err) { setNavError(err instanceof Error ? err.message : String(err)); }
  };

  const handleNavigateRoom = async () => {
    setNavResult(null); setNavError(null);
    try { await navigate.openRoom('@solminer'); setNavResult('Opened @solminer'); }
    catch (err) { setNavError(err instanceof Error ? err.message : String(err)); }
  };

  const handleVerifyToken = async () => {
    setVerifyLoading(true); setVerifyError(null); setVerifyResult(null);
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: launchToken }),
      });
      const data = await res.json();
      if (data.verified) setVerifyResult(`Verified: ${data.payload.sub}`);
      else setVerifyError(`Rejected: ${data.error}`);
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : String(err));
    } finally { setVerifyLoading(false); }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.card}>
        <h2 style={{ ...styles.heading, fontSize: 16, marginBottom: 4 }}>Cherry Mini-App SDK Example</h2>
        <Row label="Platform" value={<span style={styles.badge}>{platform}</span>} />
        <Row label="Wallet" value={<span style={styles.mono}>{truncate(cherryWallet.publicKey ?? '')}</span>} />
        <Row label="User" value={user?.displayName || '—'} />
        <Row label="Room" value={`${room?.title || '—'} (${room?.memberCount ?? 0})`} />
      </div>

      {/* Tab switcher */}
      <div style={styles.tabBar}>
        <button
          style={activeTab === 'web3js' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('web3js')}
        >
          @solana/web3.js
        </button>
        <button
          style={activeTab === 'kit' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('kit')}
        >
          @solana/kit
        </button>
      </div>

      {/* Transaction version switcher */}
      <div style={styles.card}>
        <div style={{ ...styles.sectionHeader, marginBottom: 8 }}>
          <h2 style={styles.heading}>Transaction Version</h2>
          <span style={styles.libBadge}>applies to all sign-tx calls</span>
        </div>
        <div style={styles.tabBar}>
          <button
            style={txVersion === 'legacy' ? styles.tabActive : styles.tab}
            onClick={() => setTxVersion('legacy')}
          >
            Legacy
          </button>
          <button
            style={txVersion === 'v0' ? styles.tabActive : styles.tab}
            onClick={() => setTxVersion('v0')}
          >
            Versioned (v0)
          </button>
        </div>
        <p style={{ ...styles.hint, marginTop: 8 }}>
          {txVersion === 'legacy'
            ? 'Builds plain Transaction (no version prefix).'
            : 'Builds VersionedTransaction with MessageV0 (0x80 version byte).'}
        </p>
      </div>

      {/* Solana-specific sections */}
      {activeTab === 'web3js' ? (
        <Web3JsSection wallet={cherryWallet} publicKey={cherryWallet.publicKey} txVersion={txVersion} />
      ) : (
        <KitSection publicKey={cherryWallet.publicKey} txVersion={txVersion} />
      )}

      {/* Multisig test (shared) */}
      <MultisigSection publicKey={cherryWallet.publicKey} wallet={cherryWallet} />

      {/* Navigation (shared) */}
      <div style={styles.card}>
        <h2 style={styles.heading}>Navigation</h2>
        <p style={styles.hint}>Opens screens in Cherry host app.</p>
        <div style={styles.buttonRow}>
          <button style={styles.buttonHalf} onClick={handleNavigateProfile}>cherrydev.sol</button>
          <button style={styles.buttonHalf} onClick={handleNavigateRoom}>@solminer</button>
        </div>
        {navResult && <ResultRow label="Result" value={navResult} />}
        {navError && <p style={styles.errorText}>{navError}</p>}
      </div>

      {/* Token verification (shared) */}
      <div style={styles.card}>
        <h2 style={styles.heading}>Launch Token Verification</h2>
        <div style={styles.tokenBox}>
          <code style={styles.tokenText}>{launchToken ? launchToken.slice(0, 80) + '...' : '—'}</code>
        </div>
        <p style={styles.hint}>Verifies JWT signature against Cherry JWKS endpoint.</p>
        <ActionButton label="Verify on Server" loadingLabel="Verifying..." loading={verifyLoading} disabled={!launchToken} onClick={handleVerifyToken} />
        {verifyResult && <ResultRow label="Result" value={verifyResult} />}
        {verifyError && <p style={styles.errorText}>{verifyError}</p>}
      </div>
    </div>
  );
}

// ============================================================================
// Transaction builders (shared between web3.js and kit sections)
// ============================================================================

const DUMMY_BLOCKHASH = 'GfVcyD4kkTNSKKyLBbhPgqNBJTiJKBRCRVjzCUjrjXvP';

/**
 * Build a transaction (legacy `Transaction` or `VersionedTransaction` with
 * MessageV0) containing a single self-transfer of `lamports`.
 */
async function buildWeb3Tx(
  publicKey: string,
  lamports: number,
  version: 'legacy' | 'v0',
): Promise<unknown> {
  const {
    Transaction,
    VersionedTransaction,
    TransactionMessage,
    SystemProgram,
    PublicKey,
  } = await import('@solana/web3.js');
  const pk = new PublicKey(publicKey);
  const ix = SystemProgram.transfer({ fromPubkey: pk, toPubkey: pk, lamports });

  if (version === 'v0') {
    const message = new TransactionMessage({
      payerKey: pk,
      recentBlockhash: DUMMY_BLOCKHASH,
      instructions: [ix],
    }).compileToV0Message();
    return new VersionedTransaction(message);
  }

  const tx = new Transaction().add(ix);
  tx.recentBlockhash = DUMMY_BLOCKHASH;
  tx.feePayer = pk;
  return tx;
}

/**
 * Build raw `messageBytes` (the compiled message body, including the v0 prefix
 * for versioned) suitable for `signer.signTransactions([{ messageBytes, ... }])`.
 *
 * Uses `@solana/kit` and `@solana-program/system` — the idiomatic path for
 * modern Solana apps that want a tree-shakable, web3.js-free stack.
 */
async function buildKitMessageBytes(
  publicKeyStr: string,
  transferLamports: number,
  version: 'legacy' | 'v0',
): Promise<Uint8Array> {
  const {
    address,
    createNoopSigner,
    createTransactionMessage,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    appendTransactionMessageInstruction,
    compileTransaction,
    pipe,
    lamports,
  } = await import('@solana/kit');
  const { getTransferSolInstruction } = await import('@solana-program/system');

  const signer = createNoopSigner(address(publicKeyStr));
  const lifetime = {
    blockhash: DUMMY_BLOCKHASH as unknown as Blockhash,
    lastValidBlockHeight: 0n,
  };

  const message = pipe(
    createTransactionMessage({ version: version === 'v0' ? 0 : 'legacy' }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
    (m) =>
      appendTransactionMessageInstruction(
        getTransferSolInstruction({
          source: signer,
          destination: address(publicKeyStr),
          amount: lamports(BigInt(transferLamports)),
        }),
        m,
      ),
  );

  const compiled = compileTransaction(message);
  return compiled.messageBytes as unknown as Uint8Array;
}

// ============================================================================
// @solana/web3.js section
// ============================================================================

function Web3JsSection({ wallet, publicKey, txVersion }: {
  wallet: {
    signMessage: (m: Uint8Array) => Promise<Uint8Array>;
    signTransaction: (tx: unknown) => Promise<unknown>;
    signAllTransactions: (txs: unknown[]) => Promise<Uint8Array[]>;
    connected: boolean;
  };
  publicKey: string | null;
  txVersion: 'legacy' | 'v0';
}) {
  const [signMsgResult, setSignMsgResult] = useState<string | null>(null);
  const [signMsgLoading, setSignMsgLoading] = useState(false);
  const [signMsgError, setSignMsgError] = useState<string | null>(null);
  const [signTxResult, setSignTxResult] = useState<string | null>(null);
  const [signTxLoading, setSignTxLoading] = useState(false);
  const [signTxError, setSignTxError] = useState<string | null>(null);
  const [signAllResult, setSignAllResult] = useState<string | null>(null);
  const [signAllLoading, setSignAllLoading] = useState(false);
  const [signAllError, setSignAllError] = useState<string | null>(null);

  const handleSignMessage = async () => {
    setSignMsgLoading(true); setSignMsgError(null); setSignMsgResult(null);
    try {
      const msg = new TextEncoder().encode(`web3.js signMessage test: ${Date.now()}`);
      const sig = await wallet.signMessage(msg);
      setSignMsgResult(toBase64(sig).slice(0, 44) + '...');
    } catch (err) { setSignMsgError(err instanceof Error ? err.message : String(err)); }
    finally { setSignMsgLoading(false); }
  };

  const handleSignTransaction = async () => {
    setSignTxLoading(true); setSignTxError(null); setSignTxResult(null);
    try {
      const tx = await buildWeb3Tx(publicKey!, 0, txVersion);
      const signed = await wallet.signTransaction(tx);
      setSignTxResult(`[${txVersion}] Signed ${(signed as Uint8Array).length} bytes`);
    } catch (err) { setSignTxError(err instanceof Error ? err.message : String(err)); }
    finally { setSignTxLoading(false); }
  };

  const handleSignAllTransactions = async () => {
    setSignAllLoading(true); setSignAllError(null); setSignAllResult(null);
    try {
      const txs = await Promise.all([1, 2, 3].map((i) => buildWeb3Tx(publicKey!, i, txVersion)));
      const signed = await wallet.signAllTransactions(txs);
      const details = signed.map((tx, i) => {
        const bytes = tx as Uint8Array;
        const hasSig = bytes.length > 65 && bytes.slice(1, 65).some((b) => b !== 0);
        return `tx${i + 1}: ${hasSig ? toBase64(bytes.slice(1, 65)).slice(0, 16) + '...' : 'no sig'}`;
      });
      setSignAllResult(`[${txVersion}] ${signed.length} txs signed\n${details.join('\n')}`);
    } catch (err) { setSignAllError(err instanceof Error ? err.message : String(err)); }
    finally { setSignAllLoading(false); }
  };

  return (
    <>
      <div style={styles.card}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.heading}>Sign Message</h2>
          <span style={styles.libBadge}>@solana/web3.js</span>
        </div>
        <CodeBlock>{`import { useCherryWallet } from '@cherrydotfun/miniapp-sdk/react';

const { signMessage } = useCherryWallet();
const sig = await signMessage(messageBytes);`}</CodeBlock>
        <ActionButton label="Sign Message" loadingLabel="Signing..." loading={signMsgLoading} disabled={!wallet.connected} onClick={handleSignMessage} />
        {signMsgResult && <ResultRow label="Signature" value={signMsgResult} />}
        {signMsgError && <p style={styles.errorText}>{signMsgError}</p>}
      </div>

      <div style={styles.card}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.heading}>Sign Transaction</h2>
          <span style={styles.libBadge}>@solana/web3.js</span>
        </div>
        <CodeBlock>{`import { CherryWalletAdapter } from '@cherrydotfun/miniapp-sdk/solana';

// Drop-in for @solana/wallet-adapter-react
const wallets = [new CherryWalletAdapter()];`}</CodeBlock>
        <ActionButton label="Sign Transaction" loadingLabel="Signing..." loading={signTxLoading} disabled={!wallet.connected} onClick={handleSignTransaction} />
        {signTxResult && <ResultRow label="Result" value={signTxResult} />}
        {signTxError && <p style={styles.errorText}>{signTxError}</p>}
      </div>

      <div style={styles.card}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.heading}>Sign All Transactions</h2>
          <span style={styles.libBadge}>@solana/web3.js</span>
        </div>
        <CodeBlock>{`const { signAllTransactions } = useCherryWallet();

// Signs 3 transactions in a single batch request
// — one wallet confirmation for all transactions
const signed = await signAllTransactions([tx1, tx2, tx3]);`}</CodeBlock>
        <ActionButton label="Sign 3 Transactions (Batch)" loadingLabel="Signing..." loading={signAllLoading} disabled={!wallet.connected} onClick={handleSignAllTransactions} />
        {signAllResult && <ResultRow label="Result" value={signAllResult} />}
        {signAllError && <p style={styles.errorText}>{signAllError}</p>}
      </div>
    </>
  );
}

// ============================================================================
// @solana/kit section
// ============================================================================

function KitSection({ publicKey, txVersion }: { publicKey: string | null; txVersion: 'legacy' | 'v0' }) {
  const app = useCherryApp();
  const [signerInfo, setSignerInfo] = useState<string | null>(null);
  const [signMsgResult, setSignMsgResult] = useState<string | null>(null);
  const [signMsgLoading, setSignMsgLoading] = useState(false);
  const [signMsgError, setSignMsgError] = useState<string | null>(null);
  const [signTxResult, setSignTxResult] = useState<string | null>(null);
  const [signTxLoading, setSignTxLoading] = useState(false);
  const [signTxError, setSignTxError] = useState<string | null>(null);
  const [signBatchResult, setSignBatchResult] = useState<string | null>(null);
  const [signBatchLoading, setSignBatchLoading] = useState(false);
  const [signBatchError, setSignBatchError] = useState<string | null>(null);

  const handleCreateSigner = () => {
    if (!app) { setSignerInfo('CherryMiniApp not ready'); return; }
    try {
      const signer = createCherrySigner(app);
      setSignerInfo(`TransactionSigner created: ${signer.address.slice(0, 8)}...`);
    } catch (err) { setSignerInfo(err instanceof Error ? err.message : String(err)); }
  };

  const handleSignMessage = async () => {
    if (!app) return;
    setSignMsgLoading(true); setSignMsgError(null); setSignMsgResult(null);
    try {
      const signer = createCherrySigner(app);
      if (!signer.signMessages) throw new Error('signMessages not supported');
      const msg = new TextEncoder().encode(`kit signMessages test: ${Date.now()}`);
      const [sig] = await signer.signMessages([msg]);
      setSignMsgResult(toBase64(sig!).slice(0, 44) + '...');
    } catch (err) { setSignMsgError(err instanceof Error ? err.message : String(err)); }
    finally { setSignMsgLoading(false); }
  };

  const handleSignTransaction = async () => {
    if (!app || !publicKey) return;
    setSignTxLoading(true); setSignTxError(null); setSignTxResult(null);
    try {
      const signer = createCherrySigner(app);
      const messageBytes = await buildKitMessageBytes(publicKey, 0, txVersion);

      const [signed] = await signer.signTransactions([{
        messageBytes,
        signatures: {},
      }]);
      const hasSig = signed!.signatures[signer.address];
      setSignTxResult(`[${txVersion}] sig: ${hasSig ? toBase64(hasSig).slice(0, 32) + '...' : 'none'}`);
    } catch (err) { setSignTxError(err instanceof Error ? err.message : String(err)); }
    finally { setSignTxLoading(false); }
  };

  const handleSignBatch = async () => {
    if (!app || !publicKey) return;
    setSignBatchLoading(true); setSignBatchError(null); setSignBatchResult(null);
    try {
      const signer = createCherrySigner(app);
      const txInputs = await Promise.all([1, 2, 3].map(async (i) => ({
        messageBytes: await buildKitMessageBytes(publicKey, i, txVersion),
        signatures: {},
      })));

      const signed = await signer.signTransactions(txInputs);
      const details = signed.map((s, i) => {
        const sig = s.signatures[signer.address];
        return `tx${i + 1}: ${sig ? toBase64(sig).slice(0, 16) + '...' : 'no sig'}`;
      });
      setSignBatchResult(`[${txVersion}] ${signed.length} txs signed\n${details.join('\n')}`);
    } catch (err) { setSignBatchError(err instanceof Error ? err.message : String(err)); }
    finally { setSignBatchLoading(false); }
  };

  return (
    <>
      <div style={styles.card}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.heading}>Create Signer</h2>
          <span style={{ ...styles.libBadge, background: '#059669' }}>@solana/kit</span>
        </div>
        <CodeBlock>{`import { CherryMiniApp } from '@cherrydotfun/miniapp-sdk';
import { createCherrySigner } from '@cherrydotfun/miniapp-sdk/kit';

const cherry = new CherryMiniApp();
await cherry.init();

const signer = createCherrySigner(cherry);
// signer: TransactionSigner — use with @solana/kit`}</CodeBlock>
        <ActionButton label="Create TransactionSigner" loadingLabel="Creating..." loading={false} disabled={!app} onClick={handleCreateSigner} />
        {signerInfo && <ResultRow label="Signer" value={signerInfo} />}
      </div>

      <div style={styles.card}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.heading}>Sign Transaction (Kit)</h2>
          <span style={{ ...styles.libBadge, background: '#059669' }}>@solana/kit</span>
        </div>
        <CodeBlock>{`const signer = createCherrySigner(cherry);
const [signed] = await signer.signTransactions([{
  messageBytes,
  signatures: {},
}]);`}</CodeBlock>
        <ActionButton label="Sign Transaction via Signer" loadingLabel="Signing..." loading={signTxLoading} disabled={!app} onClick={handleSignTransaction} />
        {signTxResult && <ResultRow label="Result" value={signTxResult} />}
        {signTxError && <p style={styles.errorText}>{signTxError}</p>}
      </div>

      <div style={styles.card}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.heading}>Sign All Transactions (Kit)</h2>
          <span style={{ ...styles.libBadge, background: '#059669' }}>@solana/kit</span>
        </div>
        <CodeBlock>{`const signer = createCherrySigner(cherry);

// Batch: all 3 transactions signed in a single request
const signed = await signer.signTransactions([
  { messageBytes: tx1Bytes, signatures: {} },
  { messageBytes: tx2Bytes, signatures: {} },
  { messageBytes: tx3Bytes, signatures: {} },
]);`}</CodeBlock>
        <ActionButton label="Sign 3 Transactions (Batch)" loadingLabel="Signing..." loading={signBatchLoading} disabled={!app} onClick={handleSignBatch} />
        {signBatchResult && <ResultRow label="Result" value={signBatchResult} />}
        {signBatchError && <p style={styles.errorText}>{signBatchError}</p>}
      </div>

      <div style={styles.card}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.heading}>Sign Message (Kit)</h2>
          <span style={{ ...styles.libBadge, background: '#059669' }}>@solana/kit</span>
        </div>
        <CodeBlock>{`const signer = createCherrySigner(cherry);
const [signature] = await signer.signMessages([messageBytes]);`}</CodeBlock>
        <ActionButton label="Sign Message via Signer" loadingLabel="Signing..." loading={signMsgLoading} disabled={!app} onClick={handleSignMessage} />
        {signMsgResult && <ResultRow label="Signature" value={signMsgResult} />}
        {signMsgError && <p style={styles.errorText}>{signMsgError}</p>}
      </div>
    </>
  );
}

// ============================================================================
// Multi-sig section — all 4 variants (web3.js/kit × legacy/v0)
// ============================================================================

type MultisigVariant = 'web3-legacy' | 'web3-v0' | 'kit-legacy' | 'kit-v0';

interface MultisigResult {
  variant: MultisigVariant;
  messageBytesLen: number;
  /** Did the host return the exact same messageBytes we sent? If false, the host/wallet mutated the tx. */
  messageBytesIntact: boolean;
  /** First byte offset where messageBytes differ (if any). */
  firstDiffAt?: number;
  slot0: { address: string; role: string; sigPreview: string; valid: boolean };
  slot1: { address: string; role: string; sigPreview: string; valid: boolean };
  /** When messageBytes were mutated: is Cherry's sig valid against the RETURNED (mutated) messageBytes? */
  cherryValidAgainstReturned?: boolean;
  error?: string;
}

function bytesEqualU8(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function firstDifference(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length !== b.length ? n : -1;
}

async function verifySig(sig: Uint8Array, message: Uint8Array, pubkeyBase58: string): Promise<boolean> {
  try {
    const { ed25519 } = await import('@noble/curves/ed25519');
    const { PublicKey } = await import('@solana/web3.js');
    const pubkey = new PublicKey(pubkeyBase58).toBytes();
    return ed25519.verify(sig, message, pubkey);
  } catch {
    return false;
  }
}

/** Generate a random keypair and return its base58 address + raw 32-byte secret. */
async function generateLocalKeypair() {
  const { Keypair } = await import('@solana/web3.js');
  const kp = Keypair.generate();
  return {
    keypair: kp,
    address: kp.publicKey.toBase58(),
    secret32: kp.secretKey.slice(0, 32),
  };
}

/** Ed25519-sign raw bytes locally (outside the wallet). */
async function localSign(message: Uint8Array, secret32: Uint8Array): Promise<Uint8Array> {
  const { ed25519 } = await import('@noble/curves/ed25519');
  return ed25519.sign(message, secret32);
}

function MultisigSection({ publicKey, wallet }: {
  publicKey: string | null;
  wallet: {
    signAllTransactions: (txs: unknown[]) => Promise<Uint8Array[]>;
    connected: boolean;
  };
}) {
  const app = useCherryApp();
  const [loading, setLoading] = useState<MultisigVariant | null>(null);
  const [results, setResults] = useState<Partial<Record<MultisigVariant, MultisigResult>>>({});

  const run = async (variant: MultisigVariant) => {
    if (!publicKey) return;
    setLoading(variant);
    setResults((r) => ({ ...r, [variant]: undefined }));
    try {
      const result = await runMultisigTest(variant, publicKey, wallet, app);
      setResults((r) => ({ ...r, [variant]: result }));
    } catch (err) {
      setResults((r) => ({
        ...r,
        [variant]: {
          variant,
          messageBytesLen: 0,
          slot0: { address: '—', role: '—', sigPreview: '—', valid: false },
          slot1: { address: '—', role: '—', sigPreview: '—', valid: false },
          error: err instanceof Error ? err.message : String(err),
        },
      }));
    } finally {
      setLoading(null);
    }
  };

  const variants: { id: MultisigVariant; label: string; lib: string }[] = [
    { id: 'web3-legacy', label: 'Legacy', lib: '@solana/web3.js' },
    { id: 'web3-v0', label: 'Versioned (v0)', lib: '@solana/web3.js' },
    { id: 'kit-legacy', label: 'Legacy', lib: '@solana/kit' },
    { id: 'kit-v0', label: 'Versioned (v0)', lib: '@solana/kit' },
  ];

  return (
    <div style={styles.card}>
      <div style={styles.sectionHeader}>
        <h2 style={styles.heading}>Multi-sig Test (2 signers)</h2>
        <span style={styles.libBadge}>slot 0: Cherry · slot 1: local random</span>
      </div>
      <p style={styles.hint}>
        Builds a 2-signer tx, pre-signs slot 1 locally with a random keypair,
        passes it to <code>cherry.signer.signTransactions(...)</code> (or wallet-adapter) and
        verifies both signatures against the exact messageBytes that were sent.
      </p>

      {variants.map(({ id, label, lib }) => (
        <div key={id} style={{ marginTop: 10, padding: 10, background: '#111', borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: '#e5e5e5', fontWeight: 600 }}>{label}</span>
              <span style={{ ...styles.libBadge, background: lib === '@solana/kit' ? '#059669' : '#4f46e5' }}>
                {lib}
              </span>
            </div>
            <button
              onClick={() => run(id)}
              disabled={loading !== null || !publicKey || (id.startsWith('kit') && !app) || (id.startsWith('web3') && !wallet.connected)}
              style={{
                ...styles.button,
                width: 'auto',
                marginTop: 0,
                padding: '6px 14px',
                fontSize: 12,
                opacity: loading === id ? 0.5 : 1,
              }}
            >
              {loading === id ? 'Signing…' : 'Run'}
            </button>
          </div>
          {results[id] && <MultisigResultView result={results[id]!} />}
        </div>
      ))}
    </div>
  );
}

function MultisigResultView({ result }: { result: MultisigResult }) {
  if (result.error) {
    return <p style={{ ...styles.errorText, marginTop: 4, fontSize: 12 }}>{result.error}</p>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4, fontSize: 11 }}>
      <div style={{ color: '#737373' }}>
        messageBytes: {result.messageBytesLen} B
        {' · '}
        <span style={{ color: result.messageBytesIntact ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
          {result.messageBytesIntact ? 'intact' : `MUTATED @ byte ${result.firstDiffAt}`}
        </span>
      </div>
      {!result.messageBytesIntact && result.cherryValidAgainstReturned !== undefined && (
        <div style={{ color: result.cherryValidAgainstReturned ? '#f59e0b' : '#dc2626', fontSize: 10 }}>
          Cherry sig vs RETURNED messageBytes: {result.cherryValidAgainstReturned ? 'valid (host re-compiled tx)' : 'invalid'}
        </div>
      )}
      <MultisigSlotRow idx={0} slot={result.slot0} />
      <MultisigSlotRow idx={1} slot={result.slot1} />
    </div>
  );
}

function MultisigSlotRow({ idx, slot }: { idx: number; slot: MultisigResult['slot0'] }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{ color: '#525252', minWidth: 18 }}>[{idx}]</span>
      <span style={{
        fontSize: 10, fontWeight: 700, color: '#fff',
        background: slot.valid ? '#16a34a' : '#dc2626',
        padding: '1px 6px', borderRadius: 4,
      }}>
        {slot.valid ? 'VALID' : 'INVALID'}
      </span>
      <span style={{ color: '#a3a3a3', fontSize: 10 }}>{slot.role}</span>
      <code style={{ fontSize: 10, color: '#c4b5fd' }}>{slot.address.slice(0, 8)}…{slot.address.slice(-4)}</code>
      <code style={{ fontSize: 10, color: '#737373' }}>{slot.sigPreview}</code>
    </div>
  );
}

/** Run one multi-sig test variant end-to-end. */
async function runMultisigTest(
  variant: MultisigVariant,
  cherryPubkey: string,
  wallet: { signAllTransactions: (txs: unknown[]) => Promise<Uint8Array[]>; connected: boolean },
  app: ReturnType<typeof useCherryApp>,
): Promise<MultisigResult> {
  const local = await generateLocalKeypair();
  const isV0 = variant.endsWith('v0');
  const version: 'legacy' | 'v0' = isV0 ? 'v0' : 'legacy';

  if (variant.startsWith('kit')) {
    if (!app) throw new Error('CherryMiniApp not ready');
    // Build messageBytes with kit — 2 signers: cherry (slot 0, fee payer) + local (slot 1)
    const messageBytes = await buildKitMultisigMessageBytes(cherryPubkey, local.address, version);
    const localSigBytes = await localSign(messageBytes, local.secret32);

    // Call the bridge directly so we can inspect the raw signed wire that the
    // host returns — this lets us detect whether the host/wallet mutated the
    // messageBytes during signing (a common cause of "my sig is Invalid").
    const { getSharedBridge } = await import('@cherrydotfun/miniapp-sdk');
    const bridge = getSharedBridge();
    const sigCountBytes = new Uint8Array([2]); // compact-u16: 2 signatures
    const wire = new Uint8Array(sigCountBytes.length + 2 * 64 + messageBytes.length);
    wire.set(sigCountBytes, 0);
    // sig slot 0 (cherry) left zero
    // sig slot 1 (local) left zero — kit signer does NOT forward pre-existing sigs into the wire
    wire.set(messageBytes, sigCountBytes.length + 2 * 64);
    const rawResult = await bridge.request('wallet.signTransactions', {
      transactions: [toBase64(wire)],
    });
    const signedBase64 = ((rawResult as Record<string, unknown>)?.['transactions'] as string[])?.[0];
    if (!signedBase64) throw new Error('Host did not return a signed transaction');

    const signedWire = await decodeBase64(signedBase64);
    const msgStartReturned = sigCountBytes.length + 2 * 64;
    const returnedMessageBytes = signedWire.slice(msgStartReturned);
    const messageBytesIntact = bytesEqualU8(returnedMessageBytes, messageBytes);
    const firstDiffAt = messageBytesIntact ? undefined : firstDifference(returnedMessageBytes, messageBytes);

    const cherrySig = signedWire.slice(1, 65);
    const localSigReturned = signedWire.slice(65, 129);
    const hasCherrySig = cherrySig.some((b) => b !== 0);
    const hasLocalSig = localSigReturned.some((b) => b !== 0);

    const cherryValid = hasCherrySig ? await verifySig(cherrySig, messageBytes, cherryPubkey) : false;
    const cherryValidAgainstReturned = hasCherrySig && !messageBytesIntact
      ? await verifySig(cherrySig, returnedMessageBytes, cherryPubkey)
      : undefined;
    const localValid = hasLocalSig ? await verifySig(localSigReturned, messageBytes, local.address) : false;
    // Use our (unchanged) local sig as authoritative for slot 1 verification;
    // if the host returned a different one, note it in the preview.
    const localValidPre = await verifySig(localSigBytes, messageBytes, local.address);

    return {
      variant,
      messageBytesLen: messageBytes.length,
      messageBytesIntact,
      firstDiffAt: firstDiffAt === -1 ? undefined : firstDiffAt,
      slot0: {
        address: cherryPubkey,
        role: 'Cherry (fee payer)',
        sigPreview: hasCherrySig ? toBase64(cherrySig).slice(0, 16) + '…' : 'no sig',
        valid: cherryValid,
      },
      slot1: {
        address: local.address,
        role: 'local (pre-signed)',
        sigPreview: hasLocalSig
          ? toBase64(localSigReturned).slice(0, 16) + '…'
          : (localValidPre ? toBase64(localSigBytes).slice(0, 16) + '… (local)' : 'no sig'),
        valid: hasLocalSig ? localValid : localValidPre,
      },
      cherryValidAgainstReturned,
    };
  }

  // web3.js path — uses wallet-adapter-react's signAllTransactions on our CherryWalletAdapter
  const tx = await buildWeb3MultisigTx(cherryPubkey, local.keypair, version);
  // Capture messageBytes BEFORE Cherry signs so we know exactly what got signed
  const messageBytes = extractMessageBytes(tx);

  const [signedRaw] = await wallet.signAllTransactions([tx]);
  const parsed = await parseSignedWeb3(signedRaw!, version);

  const messageBytesIntact = bytesEqualU8(parsed.messageBytes, messageBytes);
  const firstDiffAt = messageBytesIntact ? undefined : firstDifference(parsed.messageBytes, messageBytes);

  // Verify Cherry's sig against the ORIGINAL messageBytes (what the user sent).
  const cherryValid = parsed.cherrySig
    ? await verifySig(parsed.cherrySig, messageBytes, cherryPubkey)
    : false;
  const cherryValidAgainstReturned = parsed.cherrySig && !messageBytesIntact
    ? await verifySig(parsed.cherrySig, parsed.messageBytes, cherryPubkey)
    : undefined;
  const localValid = parsed.localSig
    ? await verifySig(parsed.localSig, messageBytes, local.address)
    : false;

  return {
    variant,
    messageBytesLen: messageBytes.length,
    messageBytesIntact,
    firstDiffAt: firstDiffAt === -1 ? undefined : firstDiffAt,
    slot0: {
      address: cherryPubkey,
      role: 'Cherry (fee payer)',
      sigPreview: parsed.cherrySig ? toBase64(parsed.cherrySig).slice(0, 16) + '…' : 'no sig',
      valid: cherryValid,
    },
    slot1: {
      address: local.address,
      role: 'local (pre-signed)',
      sigPreview: parsed.localSig ? toBase64(parsed.localSig).slice(0, 16) + '…' : 'no sig',
      valid: localValid,
    },
    cherryValidAgainstReturned,
  };
}

/** Build a 2-signer web3.js tx: cherry = slot 0 (fee payer), local = slot 1 (pre-signed). */
async function buildWeb3MultisigTx(
  cherryPubkey: string,
  localKp: import('@solana/web3.js').Keypair,
  version: 'legacy' | 'v0',
): Promise<import('@solana/web3.js').Transaction | import('@solana/web3.js').VersionedTransaction> {
  const {
    Transaction,
    VersionedTransaction,
    TransactionMessage,
    SystemProgram,
    PublicKey,
  } = await import('@solana/web3.js');
  const cherry = new PublicKey(cherryPubkey);
  const ix1 = SystemProgram.transfer({ fromPubkey: cherry, toPubkey: cherry, lamports: 0 });
  const ix2 = SystemProgram.transfer({ fromPubkey: localKp.publicKey, toPubkey: cherry, lamports: 0 });

  if (version === 'v0') {
    const msg = new TransactionMessage({
      payerKey: cherry,
      recentBlockhash: DUMMY_BLOCKHASH,
      instructions: [ix1, ix2],
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    const sig = await localSign(tx.message.serialize(), localKp.secretKey.slice(0, 32));
    tx.addSignature(localKp.publicKey, sig);
    return tx;
  }

  const tx = new Transaction().add(ix1, ix2);
  tx.recentBlockhash = DUMMY_BLOCKHASH;
  tx.feePayer = cherry;
  tx.partialSign(localKp);
  return tx;
}

function extractMessageBytes(
  tx: import('@solana/web3.js').Transaction | import('@solana/web3.js').VersionedTransaction,
): Uint8Array {
  // Lazy check for VersionedTransaction via presence of `message.staticAccountKeys`
  const maybeMsg = (tx as { message?: { staticAccountKeys?: unknown; serialize?: () => Uint8Array } }).message;
  if (maybeMsg && 'staticAccountKeys' in maybeMsg && typeof maybeMsg.serialize === 'function') {
    return maybeMsg.serialize();
  }
  return (tx as { serializeMessage(): Uint8Array }).serializeMessage();
}

/** Parse the signed wire bytes returned from the host, extract messageBytes + sig per slot. */
async function parseSignedWeb3(
  signedWire: Uint8Array,
  version: 'legacy' | 'v0',
): Promise<{ messageBytes: Uint8Array; cherrySig: Uint8Array | null; localSig: Uint8Array | null }> {
  const { VersionedTransaction, Transaction } = await import('@solana/web3.js');

  if (version === 'v0') {
    const vtx = VersionedTransaction.deserialize(signedWire);
    const messageBytes = vtx.message.serialize();
    const slot0 = vtx.signatures[0];
    const slot1 = vtx.signatures[1];
    return {
      messageBytes,
      cherrySig: slot0 && slot0.some((b) => b !== 0) ? slot0 : null,
      localSig: slot1 && slot1.some((b) => b !== 0) ? slot1 : null,
    };
  }

  const ltx = Transaction.from(signedWire);
  const messageBytes = ltx.serializeMessage();
  const slot0 = ltx.signatures[0]?.signature ?? null;
  const slot1 = ltx.signatures[1]?.signature ?? null;
  return {
    messageBytes,
    cherrySig: slot0 && slot0.some((b) => b !== 0) ? new Uint8Array(slot0) : null,
    localSig: slot1 && slot1.some((b) => b !== 0) ? new Uint8Array(slot1) : null,
  };
}

/** Build kit messageBytes with 2 signers: cherry (fee payer) + local (pre-signed via second transfer). */
async function buildKitMultisigMessageBytes(
  cherryPubkeyStr: string,
  localPubkeyStr: string,
  version: 'legacy' | 'v0',
): Promise<Uint8Array> {
  const {
    address,
    createNoopSigner,
    createTransactionMessage,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    appendTransactionMessageInstructions,
    compileTransaction,
    pipe,
    lamports,
  } = await import('@solana/kit');
  const { getTransferSolInstruction } = await import('@solana-program/system');

  const cherrySigner = createNoopSigner(address(cherryPubkeyStr));
  const localSigner = createNoopSigner(address(localPubkeyStr));
  const lifetime = {
    blockhash: DUMMY_BLOCKHASH as unknown as Blockhash,
    lastValidBlockHeight: 0n,
  };

  const message = pipe(
    createTransactionMessage({ version: version === 'v0' ? 0 : 'legacy' }),
    (m) => setTransactionMessageFeePayerSigner(cherrySigner, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          getTransferSolInstruction({
            source: cherrySigner,
            destination: address(cherryPubkeyStr),
            amount: lamports(0n),
          }),
          getTransferSolInstruction({
            source: localSigner,
            destination: address(cherryPubkeyStr),
            amount: lamports(0n),
          }),
        ],
        m,
      ),
  );

  const compiled = compileTransaction(message);
  return compiled.messageBytes as unknown as Uint8Array;
}

// ============================================================================
// Shared components
// ============================================================================

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={styles.row}>
      <span style={styles.label}>{label}</span>
      <span style={styles.value}>{value}</span>
    </div>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.resultBox}>
      <span style={styles.label}>{label}</span>
      <span style={{ ...styles.mono, whiteSpace: 'pre-line' }}>{value}</span>
    </div>
  );
}

function ActionButton({ label, loadingLabel, loading, disabled, onClick }: {
  label: string; loadingLabel: string; loading: boolean; disabled: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} disabled={loading || disabled} style={{ ...styles.button, opacity: loading || disabled ? 0.5 : 1 }}>
      {loading ? loadingLabel : label}
    </button>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre style={styles.codeBlock}><code>{children}</code></pre>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 480, margin: '0 auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 },
  card: { background: '#1a1a1a', borderRadius: 12, padding: 16, border: '1px solid #2a2a2a' },
  heading: { fontSize: 14, fontWeight: 600, color: '#a3a3a3', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 12 },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' },
  label: { fontSize: 14, color: '#a3a3a3' },
  value: { fontSize: 14, color: '#e5e5e5', fontWeight: 500 },
  mono: { fontSize: 13, fontFamily: 'monospace', color: '#e5e5e5', background: '#262626', padding: '2px 8px', borderRadius: 6 },
  badge: { fontSize: 12, fontWeight: 600, color: '#fff', background: '#7c3aed', padding: '2px 10px', borderRadius: 12 },
  libBadge: { fontSize: 11, fontWeight: 600, color: '#fff', background: '#4f46e5', padding: '2px 8px', borderRadius: 8, whiteSpace: 'nowrap' as const },
  avatar: { width: 28, height: 28, borderRadius: '50%' },
  button: { width: '100%', marginTop: 8, padding: '12px 0', fontSize: 15, fontWeight: 600, color: '#fff', background: '#7c3aed', border: 'none', borderRadius: 10, cursor: 'pointer' },
  buttonRow: { display: 'flex', gap: 8, marginTop: 8 },
  buttonHalf: { flex: 1, padding: '12px 0', fontSize: 14, fontWeight: 600, color: '#fff', background: '#4f46e5', border: 'none', borderRadius: 10, cursor: 'pointer' },
  resultBox: { marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', gap: 8 },
  errorText: { color: '#ef4444', fontSize: 13, marginTop: 8 },
  hint: { color: '#737373', fontSize: 13, marginTop: 0, marginBottom: 4 },
  tokenBox: { background: '#0a0a0a', borderRadius: 8, padding: 12, overflow: 'hidden' },
  tokenText: { fontSize: 11, color: '#737373', wordBreak: 'break-all' as const, lineHeight: 1.4 },
  spinner: { width: 32, height: 32, border: '3px solid #2a2a2a', borderTopColor: '#7c3aed', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' },
  tabBar: { display: 'flex', gap: 4, background: '#111', borderRadius: 10, padding: 4 },
  tab: { flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 600, color: '#737373', background: 'transparent', border: 'none', borderRadius: 8, cursor: 'pointer' },
  tabActive: { flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 600, color: '#fff', background: '#2a2a2a', border: 'none', borderRadius: 8, cursor: 'pointer' },
  codeBlock: { background: '#0a0a0a', borderRadius: 8, padding: 12, fontSize: 11, fontFamily: 'monospace', color: '#a78bfa', lineHeight: 1.5, overflow: 'auto', margin: '0 0 4px 0', whiteSpace: 'pre' as const },
};
