import { useMemo, useCallback } from 'react';
import { useCherryMiniAppContext } from './provider';
import { getCherryEnvironment, type DetectPlatformOptions } from '../env';
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

// ---- useCherryApp (access CherryMiniApp instance for kit signer etc.) ----

export function useCherryApp() {
  const { app } = useCherryMiniAppContext();
  return app;
}

// ---- useCherryWallet ----

export interface UseCherryWalletResult {
  publicKey: string | null;
  connected: boolean;
  signTransaction(transaction: unknown): Promise<unknown>;
  signAllTransactions(transactions: unknown[]): Promise<Uint8Array[]>;
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

      signAllTransactions(transactions: unknown[]): Promise<Uint8Array[]> {
        if (!app) {
          return Promise.reject(new Error('CherryMiniApp not initialised'));
        }
        return app.wallet.signAllTransactions(transactions);
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
 *
 * Pass `{ strict: true }` to disable fallback detection and only accept
 * Cherry-injected signals (`window.__cherry` / `cherry_embed=1`).
 */
export function useCherryEnvironment(options: DetectPlatformOptions = {}): CherryEnvironment {
  const { strict } = options;
  // Stable reference: environment detection never changes after page load.
  // strict is captured once at mount — changing it at runtime is not supported.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => getCherryEnvironment(strict !== undefined ? { strict } : {}), []);
}
