import { detectPlatform, isInsideCherry } from '@cherrydotfun/miniapp-sdk';

// ---- raw signal helpers (run once at module load) ----

function getSignals() {
  if (typeof window === 'undefined') {
    return { cherryFlag: false, rnWebView: false, cherryEmbedParam: false, insideIframe: false };
  }
  return {
    cherryFlag: !!(window as unknown as { __cherry?: boolean }).__cherry,
    rnWebView: !!(window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView,
    cherryEmbedParam: new URLSearchParams(window.location.search).get('cherry_embed') === '1',
    insideIframe: window.parent !== window,
  };
}

const signals = getSignals();
const platformDefault = detectPlatform({ strict: false });
const platformStrict = detectPlatform({ strict: true });
const embeddedDefault = isInsideCherry({ strict: false });
const embeddedStrict = isInsideCherry({ strict: true });

// ---- exported: raw signals block usable anywhere ----

export function RawSignals() {
  return (
    <div style={styles.card}>
      <h3 style={styles.heading}>Raw Signals</h3>
      <p style={styles.sectionHint}>Browser globals and URL params inspected by the SDK.</p>
      <SignalRow label="window.__cherry" value={signals.cherryFlag} description="Injected by Cherry WebView before page load (mobile)" />
      <SignalRow label="ReactNativeWebView" value={signals.rnWebView} description="Present in any React Native WebView (fallback)" />
      <SignalRow label="cherry_embed=1" value={signals.cherryEmbedParam} description="Query param appended by Cherry web host (iframe)" />
      <SignalRow label="window.parent !== window" value={signals.insideIframe} description="True inside any iframe (fallback)" />
      <div style={{ ...styles.resultGrid, marginTop: 12 }}>
        <div style={styles.resultCell}>
          <span style={styles.resultLabel}>platform (default)</span>
          <span style={platformDefault === 'standalone' ? styles.platformStandalone : styles.platformEmbedded}>{platformDefault}</span>
        </div>
        <div style={styles.resultCell}>
          <span style={styles.resultLabel}>platform (strict)</span>
          <span style={platformStrict === 'standalone' ? styles.platformStandalone : styles.platformEmbedded}>{platformStrict}</span>
        </div>
        <div style={styles.resultCell}>
          <span style={styles.resultLabel}>isInsideCherry()</span>
          <BoolBadge value={embeddedDefault} />
        </div>
        <div style={styles.resultCell}>
          <span style={styles.resultLabel}>{'isInsideCherry({strict})'}</span>
          <BoolBadge value={embeddedStrict} />
        </div>
      </div>
    </div>
  );
}

// ---- component ----

export function StandaloneView() {
  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.card}>
        <div style={styles.titleRow}>
          <h2 style={styles.title}>Cherry Mini-App SDK</h2>
          <span style={styles.standaloneBadge}>standalone</span>
        </div>
        <p style={styles.hint}>
          Running outside Cherry messenger. Showing environment detection state
          — useful for debugging before embedding in Cherry.
        </p>
      </div>

      {/* Raw signals + detection results */}
      <RawSignals />

      {/* URL */}
      <div style={styles.card}>
        <h3 style={styles.heading}>Current URL</h3>
        <pre style={styles.urlBox}>{typeof window !== 'undefined' ? window.location.href : '—'}</pre>
        <p style={styles.sectionHint}>
          To simulate web embedding, append{' '}
          <code style={styles.inlineCode}>?cherry_embed=1</code>{' '}
          to this URL and reload.
        </p>
      </div>

      {/* How to test */}
      <div style={styles.card}>
        <h3 style={styles.heading}>How to Test Inside Cherry</h3>
        <ol style={styles.list}>
          <li style={styles.listItem}>
            <strong>Web (iframe):</strong> Open Cherry web at{' '}
            <a style={styles.link} href="https://chat.cherry.fun" target="_blank" rel="noreferrer">
              chat.cherry.fun
            </a>
            , add this app as a mini-app in a room.
          </li>
          <li style={styles.listItem}>
            <strong>Mobile (WebView):</strong> Open Cherry mobile, open a room, and launch the mini-app from there.
          </li>
          <li style={styles.listItem}>
            <strong>Quick iframe test:</strong> Embed this URL in an iframe on{' '}
            <code style={styles.inlineCode}>https://chat.cherry.fun</code>. Cherry will inject{' '}
            <code style={styles.inlineCode}>cherry_embed=1</code> automatically.
          </li>
        </ol>
      </div>
    </div>
  );
}

// ---- sub-components ----

function SignalRow({
  label,
  value,
  description,
}: {
  label: string;
  value: boolean;
  description: string;
}) {
  return (
    <div style={styles.signalRow}>
      <div style={styles.signalLeft}>
        <code style={styles.signalLabel}>{label}</code>
        <span style={styles.signalDesc}>{description}</span>
      </div>
      <BoolBadge value={value} />
    </div>
  );
}

function BoolBadge({ value }: { value: boolean }) {
  return (
    <span style={value ? styles.badgeTrue : styles.badgeFalse}>
      {value ? 'true' : 'false'}
    </span>
  );
}

// ---- styles ----

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 480,
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
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    color: '#e5e5e5',
    margin: 0,
  },
  standaloneBadge: {
    fontSize: 11,
    fontWeight: 700,
    color: '#a3a3a3',
    background: '#2a2a2a',
    border: '1px solid #3a3a3a',
    padding: '2px 10px',
    borderRadius: 12,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  heading: {
    fontSize: 13,
    fontWeight: 600,
    color: '#a3a3a3',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    margin: '0 0 4px 0',
  },
  sectionHint: {
    fontSize: 12,
    color: '#525252',
    margin: '0 0 12px 0',
  },
  hint: {
    fontSize: 13,
    color: '#737373',
    margin: 0,
    lineHeight: 1.5,
  },
  signalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
    borderBottom: '1px solid #242424',
    gap: 12,
  },
  signalLeft: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
    flex: 1,
    minWidth: 0,
  },
  signalLabel: {
    fontSize: 13,
    fontFamily: 'monospace',
    color: '#c4b5fd',
  },
  signalDesc: {
    fontSize: 11,
    color: '#525252',
  },
  badgeTrue: {
    fontSize: 12,
    fontWeight: 700,
    color: '#fff',
    background: '#16a34a',
    padding: '2px 10px',
    borderRadius: 8,
    flexShrink: 0,
  },
  badgeFalse: {
    fontSize: 12,
    fontWeight: 700,
    color: '#737373',
    background: '#262626',
    border: '1px solid #333',
    padding: '2px 10px',
    borderRadius: 8,
    flexShrink: 0,
  },
  resultGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
    marginTop: 8,
  },
  resultCell: {
    background: '#111',
    borderRadius: 8,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  resultLabel: {
    fontSize: 11,
    color: '#525252',
    fontFamily: 'monospace',
  },
  platformStandalone: {
    fontSize: 14,
    fontWeight: 700,
    color: '#a3a3a3',
  },
  platformEmbedded: {
    fontSize: 14,
    fontWeight: 700,
    color: '#a78bfa',
  },
  urlBox: {
    background: '#0a0a0a',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#737373',
    wordBreak: 'break-all' as const,
    whiteSpace: 'pre-wrap' as const,
    margin: '8px 0 0 0',
  },
  inlineCode: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#c4b5fd',
    background: '#1e1e2e',
    padding: '1px 5px',
    borderRadius: 4,
  },
  list: {
    margin: '8px 0 0 0',
    paddingLeft: 20,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  listItem: {
    fontSize: 13,
    color: '#a3a3a3',
    lineHeight: 1.5,
  },
  link: {
    color: '#a78bfa',
    textDecoration: 'none',
  },
};
