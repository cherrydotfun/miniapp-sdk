import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CherryMiniApp, type CherryMiniAppOptions } from '../client';
import type { CherryUser, CherryRoom, CherryContext } from '../types';

// ---- context shape ----

interface CherryMiniAppContextValue {
  app: CherryMiniApp | null;
  isReady: boolean;
  user: CherryUser | null;
  room: CherryRoom | null;
  launchToken: string | null;
  context: CherryContext | null;
  error: Error | null;
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
  trustedOrigins,
}: CherryMiniAppProviderProps): React.JSX.Element {
  const appRef = useRef<CherryMiniApp | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [user, setUser] = useState<CherryUser | null>(null);
  const [room, setRoom] = useState<CherryRoom | null>(null);
  const [launchToken, setLaunchToken] = useState<string | null>(null);
  const [context, setContext] = useState<CherryContext | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const opts: import('../client').CherryMiniAppOptions = {};
    if (initTimeout !== undefined) opts.initTimeout = initTimeout;
    if (strict !== undefined) opts.strict = strict;
    if (trustedOrigins !== undefined) opts.trustedOrigins = trustedOrigins;
    const app = new CherryMiniApp(opts);
    appRef.current = app;

    // The context follows the host (language, theme, safe area, profile):
    // every change re-renders the consumers of the context hooks.
    const offContext = app.onContextChange((next) => setContext(next));

    app
      .init()
      .then(() => {
        setUser(app.user);
        setRoom(app.room);
        setLaunchToken(app.launchToken);
        setContext(app.context);
        setIsReady(true);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err : new Error(String(err)));
      });

    return () => {
      offContext();
      app.destroy();
      appRef.current = null;
    };
  // Options are intentionally not in deps — only used at construction time
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: CherryMiniAppContextValue = {
    app: appRef.current,
    isReady,
    user,
    room,
    launchToken,
    context,
    error,
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
