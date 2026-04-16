import type { CherryMiniApp } from './client';

const CHERRY_JWKS_URL = 'https://chat.cherry.fun/.well-known/jwks.json';
const CHERRY_ISSUER = 'https://chat.cherry.fun';

export interface CherryCustomAuthConfig {
  /** The raw JWT launch token to pass to Privy's `loginWithCustomAccessToken()`. */
  token: string;
  /** JWKS URL for Privy Dashboard configuration. */
  jwksUrl: string;
  /** Issuer value for Privy Dashboard configuration. */
  issuer: string;
}

/**
 * Extracts the launch token and auth configuration needed to use Cherry
 * as a custom auth provider in Privy (or any OIDC/JWKS-compatible system).
 *
 * Usage with Privy:
 * ```ts
 * const cherry = useCherryApp();
 * const { loginWithCustomAccessToken } = usePrivy();
 *
 * if (cherry?.isReady) {
 *   const { token } = getCherryCustomAuthConfig(cherry);
 *   await loginWithCustomAccessToken(token);
 * }
 * ```
 *
 * Privy Dashboard setup:
 * 1. Settings → Custom Auth → Add Provider
 * 2. JWKS URL: `https://chat.cherry.fun/.well-known/jwks.json`
 * 3. Issuer: `https://chat.cherry.fun`
 * 4. User ID field: `sub`
 */
export function getCherryCustomAuthConfig(cherry: CherryMiniApp): CherryCustomAuthConfig {
  return {
    token: cherry.launchToken,
    jwksUrl: CHERRY_JWKS_URL,
    issuer: CHERRY_ISSUER,
  };
}

export { CHERRY_JWKS_URL, CHERRY_ISSUER };
