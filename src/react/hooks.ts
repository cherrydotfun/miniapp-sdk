import { useMemo, useCallback } from 'react';
import { useCherryMiniAppContext } from './provider';
import { getCherryEnvironment, type DetectPlatformOptions } from '../env';
import { readCherryDisplayContext } from '../context';
import type { CherryTransactionOptions } from '../label';
import type {
  CherryUser,
  CherryRoom,
  CherryEnvironment,
  CherryNavigate,
  CherryBlinkContext,
  CherryContext,
  CherryDisplayContext,
  MiniAppPublicProfile,
  ShareBlinkOptions,
  ShareBlinkResult,
} from '../types';

// ---- useCherryMiniApp ----

export interface UseCherryMiniAppResult {
  user: CherryUser | null;
  room: CherryRoom | null;
  launchToken: string | null;
  /** Launch context (app id, Cherry ID, payment wallet, permissions, tier…); `null` until ready. */
  context: CherryContext | null;
  isReady: boolean;
  error: Error | null;
}

export function useCherryMiniApp(): UseCherryMiniAppResult {
  const { user, room, launchToken, context, isReady, error } = useCherryMiniAppContext();
  return { user, room, launchToken, context, isReady, error };
}

// ---- useCherryContext ----

/**
 * The launch context — `appId`, `cherryId`, `paymentWallet` (+ kind),
 * `permissions`, `reach`, `tier`, `mode`, the display fields (`locale`,
 * `colorScheme`, `platform`, `safeArea`, …) and `user` — or `null` until the
 * handshake completes. Re-renders when the host reports a change.
 * Display-only: verify the launch token on your backend before trusting any
 * of it.
 */
export function useCherryContext(): CherryContext | null {
  return useCherryMiniAppContext().context;
}

// ---- useCherryDisplayContext ----

/**
 * How the host wants the app to look — `locale`, `colorScheme`, `brand`,
 * `platform`, `appVersion`, `safeArea` — and never `null`: before the
 * handshake it is what the launch URL says (`cherry_lang` / `cherry_theme`,
 * so the first paint is already right), then the live context.
 */
export function useCherryDisplayContext(): CherryDisplayContext {
  const context = useCherryMiniAppContext().context;
  return useMemo(() => context ?? readCherryDisplayContext(), [context]);
}

// ---- useCherryUser ----

/**
 * The person's public Cherry profile (`context.user`), or `null` until the
 * handshake completes and on hosts that don't send it (then use
 * `useCherryApp()?.users.me()`). Re-renders when the host sends a new one.
 * For UI only — never authorize with it.
 */
export function useCherryUser(): MiniAppPublicProfile | null {
  return useCherryMiniAppContext().context?.user ?? null;
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
  /** `options.label` says what the transaction does; Cherry shows it in the wallet sheet. */
  signTransaction(transaction: unknown, options?: CherryTransactionOptions): Promise<unknown>;
  signAllTransactions(transactions: unknown[], options?: CherryTransactionOptions): Promise<Uint8Array[]>;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  signAndSendTransaction(transaction: unknown, options?: CherryTransactionOptions): Promise<string>;
}

export function useCherryWallet(): UseCherryWalletResult {
  const { app, user, isReady } = useCherryMiniAppContext();

  return useMemo<UseCherryWalletResult>(
    () => ({
      publicKey: user?.publicKey ?? null,
      connected: isReady && user !== null,

      signTransaction(transaction: unknown, options?: CherryTransactionOptions): Promise<unknown> {
        if (!app) {
          return Promise.reject(new Error('CherryMiniApp not initialised'));
        }
        return app.wallet.signTransaction(transaction, options);
      },

      signAllTransactions(transactions: unknown[], options?: CherryTransactionOptions): Promise<Uint8Array[]> {
        if (!app) {
          return Promise.reject(new Error('CherryMiniApp not initialised'));
        }
        return app.wallet.signAllTransactions(transactions, options);
      },

      signMessage(message: Uint8Array): Promise<Uint8Array> {
        if (!app) {
          return Promise.reject(new Error('CherryMiniApp not initialised'));
        }
        return app.wallet.signMessage(message);
      },

      signAndSendTransaction(transaction: unknown, options?: CherryTransactionOptions): Promise<string> {
        if (!app) {
          return Promise.reject(new Error('CherryMiniApp not initialised'));
        }
        return app.wallet.signAndSendTransaction(transaction, options);
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

// ---- useCherryBlink ----

/**
 * Returns the inline blink context (messageId, sender, viewer, params, …) when
 * the mini-app is rendered as an inline blink, or `null` otherwise. Use it to
 * render per-message ("unique blink") state.
 */
export function useCherryBlink(): CherryBlinkContext | null {
  const { app, isReady } = useCherryMiniAppContext();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => app?.blink ?? null, [app, isReady]);
}

// ---- useCherryShare ----

/**
 * Returns a `share` function that hands a "result" snapshot to the Cherry host
 * so the user can reshare it into a DM or group as a read-only blink. Resolves
 * once the user picks a recipient (or cancels).
 */
export function useCherryShare(): (
  options?: ShareBlinkOptions,
) => Promise<ShareBlinkResult> {
  const { app } = useCherryMiniAppContext();
  return useCallback(
    (options: ShareBlinkOptions = {}) => {
      if (!app) return Promise.reject(new Error('CherryMiniApp not initialised'));
      return app.share(options);
    },
    [app],
  );
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
