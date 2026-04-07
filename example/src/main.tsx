import { createRoot } from 'react-dom/client';
import { CherryMiniAppProvider } from '@cherrydotfun/miniapp-sdk/react';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <CherryMiniAppProvider>
    <App />
  </CherryMiniAppProvider>
);
