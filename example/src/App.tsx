import { useState } from 'react';
import {
  useCherryMiniApp,
  useCherryWallet,
  useCherryNavigate,
  useCherryEnvironment,
} from '@cherrydotfun/miniapp-sdk/react';

function toBase64(arr: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]!);
  }
  return btoa(binary);
}

export function App() {
  const { user, room, launchToken, isReady, error } = useCherryMiniApp();
  const { publicKey, connected, signMessage, signTransaction, signAndSendTransaction } = useCherryWallet();
  const navigate = useCherryNavigate();
  const { isEmbedded, platform } = useCherryEnvironment();

  // Sign message state
  const [signMsgResult, setSignMsgResult] = useState<string | null>(null);
  const [signMsgLoading, setSignMsgLoading] = useState(false);
  const [signMsgError, setSignMsgError] = useState<string | null>(null);

  // Sign transaction state
  const [signTxResult, setSignTxResult] = useState<string | null>(null);
  const [signTxLoading, setSignTxLoading] = useState(false);
  const [signTxError, setSignTxError] = useState<string | null>(null);

  // Navigate state
  const [navResult, setNavResult] = useState<string | null>(null);
  const [navError, setNavError] = useState<string | null>(null);

  // Verify token state
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h2 style={styles.heading}>Connection Error</h2>
          <p style={styles.errorText}>{error.message}</p>
          <p style={styles.hint}>
            Make sure this app is running inside Cherry messenger.
          </p>
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

  // ---- Handlers ----

  const handleSignMessage = async () => {
    setSignMsgLoading(true);
    setSignMsgError(null);
    setSignMsgResult(null);
    try {
      const message = new TextEncoder().encode(
        `Hello from Cherry Mini-App! Timestamp: ${Date.now()}`
      );
      const signature = await signMessage(message);
      setSignMsgResult(toBase64(signature).slice(0, 44) + '...');
    } catch (err) {
      setSignMsgError(err instanceof Error ? err.message : String(err));
    } finally {
      setSignMsgLoading(false);
    }
  };

  const handleSignTransaction = async () => {
    setSignTxLoading(true);
    setSignTxError(null);
    setSignTxResult(null);
    try {
      // Create a dummy SOL transfer to self (0 lamports) — just for testing signing
      const { Transaction, SystemProgram, PublicKey } = await import('@solana/web3.js');
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(publicKey!),
          toPubkey: new PublicKey(publicKey!),
          lamports: 0,
        })
      );
      // Need a recent blockhash — use a dummy one for signing test
      tx.recentBlockhash = 'GfVcyD4kkTNSKKyLBbhPgqNBJTiJKBRCRVjzCUjrjXvP';
      tx.feePayer = new PublicKey(publicKey!);

      const signed = await signTransaction(tx);
      setSignTxResult('Transaction signed successfully');
      console.log('[Example] Signed tx:', signed);
    } catch (err) {
      setSignTxError(err instanceof Error ? err.message : String(err));
    } finally {
      setSignTxLoading(false);
    }
  };

  const handleNavigateProfile = async () => {
    setNavResult(null);
    setNavError(null);
    try {
      await navigate.userProfile('cherrydev.sol');
      setNavResult('Opened cherrydev.sol profile');
    } catch (err) {
      setNavError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleNavigateRoom = async () => {
    setNavResult(null);
    setNavError(null);
    try {
      await navigate.openRoom('@solminer');
      setNavResult('Opened @solminer room');
    } catch (err) {
      setNavError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleVerifyToken = async () => {
    setVerifyLoading(true);
    setVerifyError(null);
    setVerifyResult(null);
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: launchToken }),
      });
      const data = await res.json();
      if (data.verified) {
        setVerifyResult(`Verified: ${data.payload.sub} in ${data.payload.room_id}`);
      } else {
        setVerifyError(`Rejected: ${data.error}`);
      }
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifyLoading(false);
    }
  };

  const truncate = (s: string, len = 8) =>
    s.length > len * 2 ? `${s.slice(0, len)}...${s.slice(-len)}` : s;

  return (
    <div style={styles.container}>
      {/* Environment */}
      <div style={styles.card}>
        <h2 style={styles.heading}>Environment</h2>
        <Row label="Platform" value={<span style={styles.badge}>{platform}</span>} />
        <Row label="Embedded" value={isEmbedded ? 'Yes' : 'No'} />
      </div>

      {/* User */}
      <div style={styles.card}>
        <h2 style={styles.heading}>User</h2>
        <Row label="Wallet" value={<span style={styles.mono}>{truncate(publicKey ?? '')}</span>} />
        <Row label="Name" value={user?.displayName || '—'} />
        {user?.avatarUrl && (
          <Row label="Avatar" value={<img src={user.avatarUrl} alt="" style={styles.avatar} />} />
        )}
      </div>

      {/* Room */}
      <div style={styles.card}>
        <h2 style={styles.heading}>Room</h2>
        <Row label="Title" value={room?.title || '—'} />
        <Row label="Members" value={String(room?.memberCount ?? '—')} />
        <Row label="Room ID" value={<span style={styles.mono}>{truncate(room?.id ?? '', 6)}</span>} />
      </div>

      {/* Wallet: Sign Message */}
      <div style={styles.card}>
        <h2 style={styles.heading}>Sign Message</h2>
        <p style={styles.hint}>Signs a text message with the connected wallet.</p>
        <ActionButton
          label="Sign Test Message"
          loadingLabel="Signing..."
          loading={signMsgLoading}
          disabled={!connected}
          onClick={handleSignMessage}
        />
        {signMsgResult && <ResultRow label="Signature" value={signMsgResult} />}
        {signMsgError && <p style={styles.errorText}>{signMsgError}</p>}
      </div>

      {/* Wallet: Sign Transaction */}
      <div style={styles.card}>
        <h2 style={styles.heading}>Sign Transaction</h2>
        <p style={styles.hint}>Creates a dummy 0-lamport transfer to self and signs it.</p>
        <ActionButton
          label="Sign Transaction"
          loadingLabel="Signing..."
          loading={signTxLoading}
          disabled={!connected}
          onClick={handleSignTransaction}
        />
        {signTxResult && <ResultRow label="Result" value={signTxResult} />}
        {signTxError && <p style={styles.errorText}>{signTxError}</p>}
      </div>

      {/* Navigation */}
      <div style={styles.card}>
        <h2 style={styles.heading}>Navigation</h2>
        <p style={styles.hint}>Opens screens in the Cherry host app.</p>
        <div style={styles.buttonRow}>
          <button style={styles.buttonHalf} onClick={handleNavigateProfile}>
            cherrydev.sol
          </button>
          <button style={styles.buttonHalf} onClick={handleNavigateRoom}>
            @solminer
          </button>
        </div>
        {navResult && <ResultRow label="Result" value={navResult} />}
        {navError && <p style={styles.errorText}>{navError}</p>}
      </div>

      {/* Launch Token + Verification */}
      <div style={styles.card}>
        <h2 style={styles.heading}>Launch Token Verification</h2>
        <div style={styles.tokenBox}>
          <code style={styles.tokenText}>
            {launchToken ? launchToken.slice(0, 80) + '...' : '—'}
          </code>
        </div>
        <p style={styles.hint}>
          Sends the JWT to the example server (localhost:3456) which verifies
          the signature against Cherry's JWKS endpoint.
        </p>
        <ActionButton
          label="Verify on Server"
          loadingLabel="Verifying..."
          loading={verifyLoading}
          disabled={!launchToken}
          onClick={handleVerifyToken}
        />
        {verifyResult && <ResultRow label="Result" value={verifyResult} />}
        {verifyError && <p style={styles.errorText}>{verifyError}</p>}
      </div>
    </div>
  );
}

// ---- Reusable components ----

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

function ActionButton({
  label, loadingLabel, loading, disabled, onClick,
}: {
  label: string; loadingLabel: string; loading: boolean; disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      style={{ ...styles.button, opacity: loading || disabled ? 0.5 : 1 }}
    >
      {loading ? loadingLabel : label}
    </button>
  );
}

// ---- Styles ----

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 420,
    margin: '0 auto',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  card: {
    background: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    border: '1px solid #2a2a2a',
  },
  heading: {
    fontSize: 14,
    fontWeight: 600,
    color: '#a3a3a3',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: 12,
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 0',
  },
  label: {
    fontSize: 14,
    color: '#a3a3a3',
  },
  value: {
    fontSize: 14,
    color: '#e5e5e5',
    fontWeight: 500,
  },
  mono: {
    fontSize: 13,
    fontFamily: 'monospace',
    color: '#e5e5e5',
    background: '#262626',
    padding: '2px 8px',
    borderRadius: 6,
  },
  badge: {
    fontSize: 12,
    fontWeight: 600,
    color: '#fff',
    background: '#7c3aed',
    padding: '2px 10px',
    borderRadius: 12,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: '50%',
  },
  button: {
    width: '100%',
    marginTop: 12,
    padding: '12px 0',
    fontSize: 15,
    fontWeight: 600,
    color: '#fff',
    background: '#7c3aed',
    border: 'none',
    borderRadius: 10,
    cursor: 'pointer',
  },
  buttonRow: {
    display: 'flex',
    gap: 8,
    marginTop: 12,
  },
  buttonHalf: {
    flex: 1,
    padding: '12px 0',
    fontSize: 14,
    fontWeight: 600,
    color: '#fff',
    background: '#4f46e5',
    border: 'none',
    borderRadius: 10,
    cursor: 'pointer',
  },
  resultBox: {
    marginTop: 10,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
    gap: 8,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 13,
    marginTop: 8,
  },
  hint: {
    color: '#737373',
    fontSize: 13,
    marginTop: 0,
    marginBottom: 4,
  },
  tokenBox: {
    background: '#0a0a0a',
    borderRadius: 8,
    padding: 12,
    overflow: 'hidden',
  },
  tokenText: {
    fontSize: 11,
    color: '#737373',
    wordBreak: 'break-all' as const,
    lineHeight: 1.4,
  },
  spinner: {
    width: 32,
    height: 32,
    border: '3px solid #2a2a2a',
    borderTopColor: '#7c3aed',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    margin: '0 auto 12px',
  },
};
