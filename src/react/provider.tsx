import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CherryMiniApp, type CherryMiniAppOptions } from '../client';
import type { CherryUser, CherryRoom } from '../types';

// ---- context shape ----

interface CherryMiniAppContextValue {
  app: CherryMiniApp | null;
  isReady: boolean;
  user: CherryUser | null;
  room: CherryRoom | null;
  launchToken: string | null;
  error: Error | null;
  /** Payment wallet (`app.wallet.publicKey`), kept current across 'wallet.changed'. */
  walletPublicKey: string | null;
  custodial: boolean;
  /** Re-read wallet state from the app (after `wallet.requestSwitch()` resolves). */
  syncWallet: () => void;
}

const CherryMiniAppContext = createContext<CherryMiniAppContextValue | null>(null);

// ---- provider ----

export interface CherryMiniAppProviderProps extends CherryMiniAppOptions {
  children: ReactNode;
}

export function CherryMiniAppProvider({
  children,
  initTimeout,
  strict,
}: CherryMiniAppProviderProps): React.JSX.Element {
  const appRef = useRef<CherryMiniApp | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [user, setUser] = useState<CherryUser | null>(null);
  const [room, setRoom] = useState<CherryRoom | null>(null);
  const [launchToken, setLaunchToken] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [walletPublicKey, setWalletPublicKey] = useState<string | null>(null);
  const [custodial, setCustodial] = useState(false);

  const syncWallet = useCallback(() => {
    const app = appRef.current;
    if (!app?.isReady) return;
    setWalletPublicKey(app.wallet.publicKey);
    setCustodial(app.wallet.custodial);
    // 'wallet.changed' may carry a re-minted token for the new payer.
    setLaunchToken(app.launchToken);
  }, []);

  useEffect(() => {
    const opts: import('../client').CherryMiniAppOptions = {};
    if (initTimeout !== undefined) opts.initTimeout = initTimeout;
    if (strict !== undefined) opts.strict = strict;
    const app = new CherryMiniApp(opts);
    appRef.current = app;
    app.on('wallet.changed', syncWallet);

    app
      .init()
      .then(() => {
        if (appRef.current !== app) return;
        setUser(app.user);
        setRoom(app.room);
        setLaunchToken(app.launchToken);
        setWalletPublicKey(app.wallet.publicKey);
        setCustodial(app.wallet.custodial);
        setIsReady(true);
      })
      .catch((err: unknown) => {
        if (appRef.current !== app) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      });

    return () => {
      app.destroy();
      if (appRef.current === app) appRef.current = null;
    };
  // initTimeout is intentionally not in deps — only used at construction time
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: CherryMiniAppContextValue = {
    app: appRef.current,
    isReady,
    user,
    room,
    launchToken,
    error,
    walletPublicKey,
    custodial,
    syncWallet,
  };

  return (
    <CherryMiniAppContext.Provider value={value}>
      {children}
    </CherryMiniAppContext.Provider>
  );
}

// ---- internal hook (used by public hooks) ----

export function useCherryMiniAppContext(): CherryMiniAppContextValue {
  const ctx = useContext(CherryMiniAppContext);
  if (ctx === null) {
    throw new Error(
      'useCherryMiniApp* hooks must be used inside <CherryMiniAppProvider>',
    );
  }
  return ctx;
}
