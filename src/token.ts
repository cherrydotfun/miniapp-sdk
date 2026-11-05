import * as jose from 'jose';
import { CHERRY_ISSUER, CHERRY_JWKS_URL } from './constants';
import type { LaunchTokenPayload } from './types';

/**
 * What a launch token is for, as `verifyLaunchToken({ scope })` matches it:
 *  - `'launch'`     — a room launch (the `cherry:init` handshake token). These
 *                     tokens carry no `scope` claim; `'launch'` names that.
 *  - `'inline'`     — an inline blink card (`scope: 'inline'`).
 *  - `'fullscreen'` — a bot/blink fullscreen launch (`scope: 'fullscreen'`).
 */
export type LaunchTokenScope = 'launch' | 'inline' | 'fullscreen';

/** Machine-readable reason a launch token was rejected. */
export type LaunchTokenErrorCode =
  /** Not a JWT, wrong algorithm, or a required claim (`exp`, `iss`) is missing. */
  | 'TOKEN_INVALID'
  /** The signature does not verify against Cherry's keys (or no key matches `kid`). */
  | 'SIGNATURE_INVALID'
  /** `exp` is in the past (beyond the clock tolerance). */
  | 'TOKEN_EXPIRED'
  /** `nbf` is in the future (beyond the clock tolerance). */
  | 'TOKEN_NOT_YET_VALID'
  /** `iss` is not one of the accepted issuers. */
  | 'ISSUER_MISMATCH'
  /** `aud` is present and does not name your app id. */
  | 'AUDIENCE_MISMATCH'
  /** `requireAudience: true` and the token has no `aud`. */
  | 'AUDIENCE_MISSING'
  /** Neither `app_id` nor `mini_app_id` is your app id. */
  | 'APP_ID_MISMATCH'
  /** `origin` option given and the token's `origin` differs. */
  | 'ORIGIN_MISMATCH'
  /** `scope` option given and the token is for another surface. */
  | 'SCOPE_MISMATCH'
  /** The JWKS could not be fetched — retry later; do NOT accept the token. */
  | 'JWKS_UNAVAILABLE'
  /** The options are unusable (e.g. no app id). A programming error. */
  | 'INVALID_OPTIONS';

/** Thrown by {@link verifyLaunchToken} for every rejection. */
export class LaunchTokenError extends Error {
  readonly code: LaunchTokenErrorCode;
  readonly cause?: unknown;

  constructor(code: LaunchTokenErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message);
    this.name = 'LaunchTokenError';
    this.code = code;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

interface VerifyLaunchTokenCommonOptions {
  /**
   * Accepted issuer(s). Default `'https://chat.cherry.fun'`. Pass an array to
   * also accept a staging issuer.
   */
  issuer?: string | readonly string[];
  /** JWKS endpoint. Default `https://chat.cherry.fun/.well-known/jwks.json`. */
  jwksUrl?: string;
  /**
   * A local key set to verify against instead of fetching `jwksUrl` — for
   * tests, or to pin keys in an offline environment.
   */
  jwks?: jose.JSONWebKeySet;
  /** Require the token's `origin` claim to equal this (room launches only). */
  origin?: string;
  /** @deprecated Use `origin`. */
  expectedOrigin?: string;
  /**
   * Require an `aud` claim. Default `false` while Cherry rolls `aud` out to
   * every token; a token whose `aud` is present is ALWAYS checked against
   * `appId` regardless. Turn this on once all your traffic carries `aud`.
   */
  requireAudience?: boolean;
  /** Only accept tokens minted for this surface (or one of these). */
  scope?: LaunchTokenScope | readonly LaunchTokenScope[];
  /** Leeway for `exp` / `nbf`, in seconds. Default `30`. */
  clockTolerance?: number;
}

/**
 * Options for {@link verifyLaunchToken}. `appId` is your mini-app id (from the
 * developer portal). `expectedAppId` is the pre-0.1.22 name and still works.
 */
export type VerifyLaunchTokenOptions = VerifyLaunchTokenCommonOptions &
  (
    | { appId: string; /** @deprecated Use `appId`. */ expectedAppId?: string }
    | { appId?: string; /** @deprecated Use `appId`. */ expectedAppId: string }
  );

const DEFAULT_CLOCK_TOLERANCE_SEC = 30;

/**
 * One remote key set per JWKS url, for the life of the process: `jose`
 * caches the keys inside it and re-fetches only on an unknown `kid` (key
 * rotation) or after its cooldown — so verification does not hit the network
 * on every request.
 */
const remoteKeySets = new Map<string, ReturnType<typeof jose.createRemoteJWKSet>>();

function remoteKeySet(url: string): ReturnType<typeof jose.createRemoteJWKSet> {
  let set = remoteKeySets.get(url);
  if (!set) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (cause) {
      throw new LaunchTokenError('INVALID_OPTIONS', `Invalid jwksUrl: ${url}`, { cause });
    }
    set = jose.createRemoteJWKSet(parsed);
    remoteKeySets.set(url, set);
  }
  return set;
}

/**
 * Verify a Cherry launch token on YOUR backend and return its claims.
 *
 * Checks, in order: RS256 signature against Cherry's JWKS, `exp`/`nbf` (with
 * `clockTolerance` leeway), `iss`, `aud` (when present, or always with
 * `requireAudience`), that the token names your app (`app_id` or
 * `mini_app_id` equals `appId`), and the optional `origin` / `scope`.
 * Throws {@link LaunchTokenError} on any failure — treat every throw as
 * "unauthenticated".
 *
 * ```ts
 * const claims = await verifyLaunchToken(token, { appId: process.env.CHERRY_APP_ID! });
 * const userKey = claims.cherry_id ?? claims.sub;
 * ```
 *
 * Never trust the context the client tells you (`cherry.user`, `cherry.claims`,
 * a wallet address in a request body): only what this function returns.
 */
export async function verifyLaunchToken(
  token: string,
  options: VerifyLaunchTokenOptions,
): Promise<LaunchTokenPayload> {
  const appId = resolveAppId(options);
  const expectedOrigin = options.origin ?? options.expectedOrigin;
  const issuers = normaliseList(options.issuer ?? CHERRY_ISSUER);
  if (issuers.length === 0) {
    throw new LaunchTokenError('INVALID_OPTIONS', 'verifyLaunchToken: `issuer` must not be empty');
  }

  if (typeof token !== 'string' || token.split('.').length !== 3) {
    throw new LaunchTokenError('TOKEN_INVALID', 'Launch token is not a JWT');
  }

  const keys = options.jwks
    ? jose.createLocalJWKSet(options.jwks)
    : remoteKeySet(options.jwksUrl ?? CHERRY_JWKS_URL);

  let payload: jose.JWTPayload;
  try {
    ({ payload } = await jose.jwtVerify(token, keys, {
      algorithms: ['RS256'],
      issuer: issuers,
      requiredClaims: ['exp'],
      clockTolerance: options.clockTolerance ?? DEFAULT_CLOCK_TOLERANCE_SEC,
    }));
  } catch (error) {
    throw toLaunchTokenError(error);
  }

  // `aud` — rolled out to every token over time. Present → it must name us.
  const aud = payload.aud;
  if (aud === undefined) {
    if (options.requireAudience) {
      throw new LaunchTokenError('AUDIENCE_MISSING', 'Launch token has no `aud` claim');
    }
  } else {
    const named = typeof aud === 'string' ? aud === appId : Array.isArray(aud) && aud.includes(appId);
    if (!named) {
      throw new LaunchTokenError(
        'AUDIENCE_MISMATCH',
        `Token aud mismatch: expected ${appId}, got ${JSON.stringify(aud)}`,
      );
    }
  }

  // The app the token is for. A room launch names it in `app_id`; inline /
  // bot launches name the rendered mini-app in `mini_app_id` (and the sending
  // app, if any, in `app_id`). Either naming us is a token for us.
  const tokenAppId = payload['app_id'];
  const tokenMiniAppId = payload['mini_app_id'];
  if (tokenAppId !== appId && tokenMiniAppId !== appId) {
    const extra = tokenMiniAppId !== undefined ? ` (mini_app_id ${String(tokenMiniAppId)})` : '';
    throw new LaunchTokenError(
      'APP_ID_MISMATCH',
      `Token app_id mismatch: expected ${appId}, got ${String(tokenAppId)}${extra}`,
    );
  }

  if (expectedOrigin !== undefined && payload['origin'] !== expectedOrigin) {
    throw new LaunchTokenError(
      'ORIGIN_MISMATCH',
      `Token origin mismatch: expected ${expectedOrigin}, got ${String(payload['origin'])}`,
    );
  }

  if (options.scope !== undefined) {
    const allowed = normaliseList(options.scope);
    const actual = typeof payload['scope'] === 'string' ? payload['scope'] : 'launch';
    if (!allowed.includes(actual as LaunchTokenScope)) {
      throw new LaunchTokenError(
        'SCOPE_MISMATCH',
        `Token scope mismatch: expected ${allowed.join(' | ')}, got ${actual}`,
      );
    }
  }

  return payload as unknown as LaunchTokenPayload;
}

// ---- helpers ----

function resolveAppId(options: VerifyLaunchTokenOptions): string {
  const { appId, expectedAppId } = options as { appId?: unknown; expectedAppId?: unknown };
  if (appId !== undefined && expectedAppId !== undefined && appId !== expectedAppId) {
    throw new LaunchTokenError(
      'INVALID_OPTIONS',
      'verifyLaunchToken: `appId` and `expectedAppId` disagree — pass only `appId`',
    );
  }
  const id = appId ?? expectedAppId;
  if (typeof id !== 'string' || id.length === 0) {
    throw new LaunchTokenError('INVALID_OPTIONS', 'verifyLaunchToken: `appId` is required');
  }
  return id;
}

function normaliseList<T extends string>(value: T | readonly T[]): T[] {
  return (typeof value === 'string' ? [value] : [...value]).filter(
    (v): v is T => typeof v === 'string' && v.length > 0,
  );
}

function toLaunchTokenError(error: unknown): LaunchTokenError {
  if (error instanceof LaunchTokenError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  const claim = (error as { claim?: unknown } | null)?.claim;
  const message = error instanceof Error ? error.message : String(error);
  switch (code) {
    case 'ERR_JWT_EXPIRED':
      return new LaunchTokenError('TOKEN_EXPIRED', 'Launch token has expired', { cause: error });
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED':
      if (claim === 'nbf') {
        return new LaunchTokenError('TOKEN_NOT_YET_VALID', 'Launch token is not valid yet', { cause: error });
      }
      if (claim === 'iss') {
        return new LaunchTokenError('ISSUER_MISMATCH', `Token issuer mismatch: ${message}`, { cause: error });
      }
      return new LaunchTokenError('TOKEN_INVALID', `Launch token claim invalid: ${message}`, { cause: error });
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
    case 'ERR_JWKS_NO_MATCHING_KEY':
    case 'ERR_JWKS_MULTIPLE_MATCHING_KEYS':
      return new LaunchTokenError('SIGNATURE_INVALID', 'Launch token signature is invalid', { cause: error });
    case 'ERR_JWKS_TIMEOUT':
    case 'ERR_JWKS_INVALID':
      return new LaunchTokenError('JWKS_UNAVAILABLE', `Cherry JWKS unavailable: ${message}`, { cause: error });
    case 'ERR_JOSE_ALG_NOT_ALLOWED':
    case 'ERR_JWS_INVALID':
    case 'ERR_JWT_INVALID':
    case 'ERR_JOSE_NOT_SUPPORTED':
      return new LaunchTokenError('TOKEN_INVALID', `Launch token is invalid: ${message}`, { cause: error });
    default:
      // Anything else came from fetching the key set (network, HTTP status).
      return new LaunchTokenError('JWKS_UNAVAILABLE', `Cherry JWKS unavailable: ${message}`, { cause: error });
  }
}
