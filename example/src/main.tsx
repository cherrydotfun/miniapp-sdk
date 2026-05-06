import { Component, ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { isInsideCherry, detectPlatform } from '@cherrydotfun/miniapp-sdk';
import { CherryMiniAppProvider } from '@cherrydotfun/miniapp-sdk/react';
import { App } from './App';
import { StandaloneView } from './StandaloneView';

// ============================================================================
// Visible error reporter — for environments where DevTools are unavailable
// (e.g. Backpack in-app browser). Any uncaught error or render crash is
// rendered as plain text inside the page so the user always sees something
// instead of a black screen.
// ============================================================================

function renderFatalToBody(title: string, body: string) {
  if (typeof document === 'undefined') return;
  const root = document.getElementById('root');
  const target = root ?? document.body;
  // Don't overwrite if a previous fatal panel exists.
  if (target.querySelector('[data-cherry-fatal]')) return;
  const div = document.createElement('div');
  div.setAttribute('data-cherry-fatal', '1');
  div.setAttribute(
    'style',
    'position:fixed;inset:0;z-index:2147483647;background:#1a0a0a;color:#fca5a5;' +
      'font-family:ui-monospace,Menlo,monospace;font-size:12px;padding:16px;overflow:auto;',
  );
  const h = document.createElement('div');
  h.setAttribute('style', 'font-weight:700;color:#fee2e2;font-size:14px;margin-bottom:8px;');
  h.textContent = title;
  const pre = document.createElement('pre');
  pre.setAttribute('style', 'white-space:pre-wrap;word-break:break-word;margin:0;');
  pre.textContent = body;
  div.appendChild(h);
  div.appendChild(pre);
  target.appendChild(div);
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    renderFatalToBody(
      'Uncaught error',
      `${event.message}\n\n${event.error?.stack ?? ''}\n\nUA: ${navigator.userAgent}`,
    );
  });
  window.addEventListener('unhandledrejection', (event) => {
    const r = event.reason;
    const msg = r instanceof Error ? `${r.message}\n${r.stack ?? ''}` : String(r);
    renderFatalToBody('Unhandled promise rejection', `${msg}\n\nUA: ${navigator.userAgent}`);
  });
}

class TopErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    renderFatalToBody(
      'React render error',
      `${error.message}\n\n${error.stack ?? ''}\n\nReact stack:${info.componentStack ?? ''}`,
    );
  }
  render() {
    if (this.state.error) {
      // Fatal panel already injected; don't render the broken tree.
      return null;
    }
    return this.props.children;
  }
}

// ============================================================================
// SDK environment snapshot — rendered as the absolute fallback so even if
// nothing else mounts, the page is not black.
// ============================================================================

function renderEnvSnapshotIfStillBlank() {
  if (typeof document === 'undefined') return;
  const root = document.getElementById('root');
  // If the React tree mounted anything visible, stop.
  if (root && root.children.length > 0) return;
  const ua = navigator.userAgent;
  const url = window.location.href;
  const inIframe = window.parent !== window;
  const cherryFlag = !!(window as unknown as { __cherry?: boolean }).__cherry;
  const rnFlag = !!(window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView;
  const cherryEmbed = new URLSearchParams(window.location.search).get('cherry_embed');
  let platform = '?';
  let strictPlatform = '?';
  try {
    platform = String(detectPlatform());
    strictPlatform = String(detectPlatform({ strict: true }));
  } catch (e) {
    platform = `error: ${String(e)}`;
  }
  renderFatalToBody(
    'Cherry mini-app: still blank after mount',
    [
      `URL: ${url}`,
      `UA:  ${ua}`,
      `cherry_embed=${cherryEmbed}`,
      `window.__cherry=${cherryFlag}`,
      `window.ReactNativeWebView=${rnFlag}`,
      `window.parent !== window=${inIframe}`,
      `detectPlatform(default)=${platform}`,
      `detectPlatform(strict)=${strictPlatform}`,
    ].join('\n'),
  );
}

// ============================================================================
// Mount
// ============================================================================

const STRICT = true;
let embedded = false;
try {
  embedded = isInsideCherry({ strict: STRICT });
} catch (e) {
  renderFatalToBody('isInsideCherry threw', String((e as Error)?.stack ?? e));
}

try {
  createRoot(document.getElementById('root')!).render(
    <TopErrorBoundary>
      {embedded ? (
        <CherryMiniAppProvider>
          <App />
        </CherryMiniAppProvider>
      ) : (
        <StandaloneView />
      )}
    </TopErrorBoundary>,
  );
} catch (e) {
  renderFatalToBody('createRoot/render threw', String((e as Error)?.stack ?? e));
}

// As an absolute backstop: if 1.5s after mount the root is still empty
// (e.g. silent React hydration failure), dump the env snapshot.
setTimeout(renderEnvSnapshotIfStillBlank, 1500);
