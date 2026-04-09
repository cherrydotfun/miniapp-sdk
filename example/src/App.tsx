import { useState } from 'react';
import {
  useCherryMiniApp,
  useCherryApp,
  useCherryWallet,
  useCherryNavigate,
  useCherryEnvironment,
} from '@cherrydotfun/miniapp-sdk/react';
import { createCherrySigner, type CherryTransactionSigner } from '@cherrydotfun/miniapp-sdk/kit';

function toBase64(arr: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]!);
  }
  return btoa(binary);
}

export function App() {
  const { user, room, launchToken, isReady, error } = useCherryMiniApp();
  const cherryWallet = useCherryWallet();
  const navigate = useCherryNavigate();
  const { isEmbedded, platform } = useCherryEnvironment();

  // Tab state
  const [activeTab, setActiveTab] = useState<'web3js' | 'kit'>('web3js');

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

      {/* Solana-specific sections */}
      {activeTab === 'web3js' ? (
        <Web3JsSection wallet={cherryWallet} publicKey={cherryWallet.publicKey} />
      ) : (
        <KitSection publicKey={cherryWallet.publicKey} />
      )}

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
// @solana/web3.js section
// ============================================================================

function Web3JsSection({ wallet, publicKey }: {
  wallet: { signMessage: (m: Uint8Array) => Promise<Uint8Array>; signTransaction: (tx: unknown) => Promise<Uint8Array>; connected: boolean };
  publicKey: string | null;
}) {
  const [signMsgResult, setSignMsgResult] = useState<string | null>(null);
  const [signMsgLoading, setSignMsgLoading] = useState(false);
  const [signMsgError, setSignMsgError] = useState<string | null>(null);
  const [signTxResult, setSignTxResult] = useState<string | null>(null);
  const [signTxLoading, setSignTxLoading] = useState(false);
  const [signTxError, setSignTxError] = useState<string | null>(null);

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
      const { Transaction, SystemProgram, PublicKey } = await import('@solana/web3.js');
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: new PublicKey(publicKey!), toPubkey: new PublicKey(publicKey!), lamports: 0 })
      );
      tx.recentBlockhash = 'GfVcyD4kkTNSKKyLBbhPgqNBJTiJKBRCRVjzCUjrjXvP';
      tx.feePayer = new PublicKey(publicKey!);
      const signed = await wallet.signTransaction(tx);
      setSignTxResult(`Signed ${signed.length} bytes`);
    } catch (err) { setSignTxError(err instanceof Error ? err.message : String(err)); }
    finally { setSignTxLoading(false); }
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
    </>
  );
}

// ============================================================================
// @solana/kit section
// ============================================================================

function KitSection({ publicKey }: { publicKey: string | null }) {
  const app = useCherryApp();
  const [signerInfo, setSignerInfo] = useState<string | null>(null);
  const [signMsgResult, setSignMsgResult] = useState<string | null>(null);
  const [signMsgLoading, setSignMsgLoading] = useState(false);
  const [signMsgError, setSignMsgError] = useState<string | null>(null);
  const [signTxResult, setSignTxResult] = useState<string | null>(null);
  const [signTxLoading, setSignTxLoading] = useState(false);
  const [signTxError, setSignTxError] = useState<string | null>(null);

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

      // Build a real Transaction via web3.js, then extract its message bytes
      // to demonstrate Kit signer working with actual transaction data.
      // In production Kit apps, you'd use @solana/kit transaction builders.
      const { Transaction, SystemProgram, PublicKey } = await import('@solana/web3.js');
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(publicKey),
          toPubkey: new PublicKey(publicKey),
          lamports: 0,
        })
      );
      tx.recentBlockhash = 'GfVcyD4kkTNSKKyLBbhPgqNBJTiJKBRCRVjzCUjrjXvP';
      tx.feePayer = new PublicKey(publicKey);
      const messageBytes = tx.serializeMessage();

      const [signed] = await signer.signTransactions([{
        messageBytes,
        signatures: {},
      }]);
      const hasSig = signed!.signatures[signer.address];
      setSignTxResult(`Signed! sig: ${hasSig ? toBase64(hasSig).slice(0, 32) + '...' : 'none'}`);
    } catch (err) { setSignTxError(err instanceof Error ? err.message : String(err)); }
    finally { setSignTxLoading(false); }
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
      <span style={styles.mono}>{value}</span>
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
