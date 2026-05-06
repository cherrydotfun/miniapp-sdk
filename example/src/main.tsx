import { createRoot } from 'react-dom/client';
import { isInsideCherry } from '@cherrydotfun/miniapp-sdk';
import { CherryMiniAppProvider } from '@cherrydotfun/miniapp-sdk/react';
import { App } from './App';
import { StandaloneView } from './StandaloneView';

// Strict mode: only trust Cherry-injected signals (window.__cherry / cherry_embed=1).
// Fallbacks like ReactNativeWebView are disabled to prevent false positives in
// wallet in-app browsers (Phantom, Backpack, etc.) that also run inside an RN WebView.
const embedded = isInsideCherry({ strict: true });

createRoot(document.getElementById('root')!).render(
  embedded ? (
    <CherryMiniAppProvider>
      <App />
    </CherryMiniAppProvider>
  ) : (
    <StandaloneView />
  ),
);
