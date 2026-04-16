import { createRoot } from 'react-dom/client';
import { isInsideCherry } from '@cherrydotfun/miniapp-sdk';
import { CherryMiniAppProvider } from '@cherrydotfun/miniapp-sdk/react';
import { App } from './App';
import { StandaloneView } from './StandaloneView';

const embedded = isInsideCherry();

createRoot(document.getElementById('root')!).render(
  embedded ? (
    <CherryMiniAppProvider>
      <App />
    </CherryMiniAppProvider>
  ) : (
    <StandaloneView />
  ),
);
