import { useMemo, useCallback } from 'react';
import { useCherryMiniAppContext } from './provider';
import { getCherryEnvironment } from '../env';
import type { CherryUser, CherryRoom, CherryEnvironment, CherryNavigate } from '../types';

// ---- useCherryMiniApp ----

export interface UseCherryMiniAppResult {
  user: CherryUser | null;
  room: CherryRoom | null;
  launchToken: string | null;
  isReady: boolean;
  error: Error | null;
}

export function useCherryMiniApp(): UseCherryMiniAppResult {
  const { user, room, launchToken, isReady, error } = useCherryMiniAppContext();
  return { user, room, launchToken, isReady, error };
}

// ---- useCherryWallet ----

export interface UseCherryWalletResult {
  publicKey: string | null;
  connected: boolean;
  signTransaction(transaction: unknown): Promise<unknown>;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  signAndSendTransaction(transaction: unknown): Promise<string>;
}

export function useCherryWallet(): UseCherryWalletResult {
  const { app, user, isReady } = useCherryMiniAppContext();

  return useMemo<UseCherryWalletResult>(
    () => ({
      publicKey: user?.publicKey ?? null,
      connected: isReady && user !== null,

      signTransaction(transaction: unknown): Promise<unknown> {
        if (!app) {
          return Promise.reject(new Error('CherryMiniApp not initialised'));
        }
        return app.wallet.signTransaction(transaction);
      },

      signMessage(message: Uint8Array): Promise<Uint8Array> {
        if (!app) {
          return Promise.reject(new Error('CherryMiniApp not initialised'));
        }
        return app.wallet.signMessage(message);
      },

      signAndSendTransaction(transaction: unknown): Promise<string> {
        if (!app) {
          return Promise.reject(new Error('CherryMiniApp not initialised'));
        }
        return app.wallet.signAndSendTransaction(transaction);
      },
    }),
    // Rebuild only when app / user readiness changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app, isReady, user?.publicKey],
  );
}

// ---- useCherryNavigate ----

export function useCherryNavigate(): CherryNavigate {
  const { app } = useCherryMiniAppContext();

  const userProfile = useCallback(
    (publicKey: string) => {
      if (!app) return Promise.reject(new Error('CherryMiniApp not initialised'));
      return app.navigate.userProfile(publicKey);
    },
    [app],
  );

  const openRoom = useCallback(
    (roomId: string) => {
      if (!app) return Promise.reject(new Error('CherryMiniApp not initialised'));
      return app.navigate.openRoom(roomId);
    },
    [app],
  );

  return useMemo(() => ({ userProfile, openRoom }), [userProfile, openRoom]);
}

// ---- useCherryEnvironment ----

/**
 * Synchronous — does NOT require CherryMiniAppProvider.
 * Safe to call at the top of any component before the provider tree is mounted.
 */
export function useCherryEnvironment(): CherryEnvironment {
  // Stable reference: environment detection never changes after page load
  return useMemo(() => getCherryEnvironment(), []);
}
