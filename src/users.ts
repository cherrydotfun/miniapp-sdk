import { decodeJwt } from 'jose';
import { isTrustedHostOrigin } from './bridge';
import { CHERRY_ISSUER } from './constants';
import { normaliseProfile, normaliseRelationship, normaliseUserPage } from './context';
import type { MiniAppPublicProfile, MiniAppRelationship, MiniAppUserPage } from './types';

/**
 * Why a `cherry.users` call failed:
 *  - `NOT_READY`         — no launch token yet (call after `init()`).
 *  - `UNTRUSTED_ISSUER`  — the token's `iss` is not a trusted Cherry origin; nothing was sent.
 *  - `UNAUTHORIZED`      — 401: the launch token was refused (typically expired:
 *                          room launches live 5 min, blinks ~15 min).
 *  - `FORBIDDEN`         — 403.
 *  - `NOT_FOUND`         — 404: no such Cherry ID (or not public).
 *  - `RATE_LIMITED`      — 429.
 *  - `HTTP_ERROR`        — any other non-2xx answer.
 *  - `NETWORK_ERROR`     — the request did not complete.
 *  - `INVALID_RESPONSE`  — the answer was not the documented JSON.
 */
export type CherryApiErrorCode =
  | 'NOT_READY'
  | 'UNTRUSTED_ISSUER'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'HTTP_ERROR'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE';

/** A failed `cherry.users` call. */
export class CherryApiError extends Error {
  constructor(
    message: string,
    public readonly code: CherryApiErrorCode,
    /** The HTTP status, when the server answered. */
    public readonly status: number | null = null,
    /** The server's own error code from the body (`{ code }`), when it sent one. */
    public readonly serverCode: string | null = null,
  ) {
    super(message);
    this.name = 'CherryApiError';
  }
}

/** Options of `users.followers()` / `users.following()`. */
export interface CherryUserPageOptions {
  /** `nextCursor` of the previous page. */
  cursor?: string;
  /** Page size, 1–100 (clamped). The server's default when omitted. */
  limit?: number;
}

/** Read the public Cherry profile API with the current launch token. */
export interface CherryUsersApi {
  /** The launching person's public profile — `GET /api/miniapp/me`. */
  me(): Promise<MiniAppPublicProfile>;
  /** Anyone's public profile by Cherry ID — `GET /api/miniapp/users/:cherryId`. */
  get(cherryId: string): Promise<MiniAppPublicProfile>;
  /** Who follows `cherryId`, one page at a time. */
  followers(cherryId: string, options?: CherryUserPageOptions): Promise<MiniAppUserPage>;
  /** Whom `cherryId` follows, one page at a time. */
  following(cherryId: string, options?: CherryUserPageOptions): Promise<MiniAppUserPage>;
  /** Whether the launching person follows `cherryId`, and the other way round. */
  relationship(cherryId: string): Promise<MiniAppRelationship>;
}

/**
 * The Cherry API origin for a launch token: its `iss` (production
 * `https://chat.cherry.fun`), and only when that is a trusted Cherry host
 * origin — the defaults or `trustedOrigins`. A token without `iss` means
 * production. Anything else throws `UNTRUSTED_ISSUER`: the token is never
 * sent to another host.
 */
export function cherryApiOrigin(token: string, trustedOrigins: readonly string[] = []): string {
  let iss: unknown;
  try {
    iss = (decodeJwt(token) as { iss?: unknown }).iss;
  } catch {
    iss = undefined;
  }
  if (iss === undefined) return CHERRY_ISSUER;
  let origin: string | null = null;
  if (typeof iss === 'string') {
    try {
      origin = new URL(iss).origin;
    } catch {
      origin = null;
    }
  }
  if (!origin || !isTrustedHostOrigin(origin, trustedOrigins)) {
    throw new CherryApiError(
      `The launch token's issuer ${String(iss)} is not a trusted Cherry origin — add it to \`trustedOrigins\` if it is one`,
      'UNTRUSTED_ISSUER',
    );
  }
  return origin;
}

const STATUS_CODES: Readonly<Record<number, CherryApiErrorCode>> = Object.freeze({
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  429: 'RATE_LIMITED',
});

/**
 * The `users` API bound to a token source. `getToken` answers the CURRENT
 * launch token (or `null` before init); `trustedOrigins` are the extra hosts
 * the app trusts (see `cherryApiOrigin`).
 */
export function createCherryUsersApi(input: {
  getToken(): string | null;
  trustedOrigins?: () => readonly string[];
  fetch?: typeof fetch;
}): CherryUsersApi {
  async function call<T>(path: string, read: (body: unknown) => T | null): Promise<T> {
    const token = input.getToken();
    if (!token) throw new CherryApiError('No launch token yet — call cherry.init() first', 'NOT_READY');
    const origin = cherryApiOrigin(token, input.trustedOrigins?.() ?? []);
    const doFetch = input.fetch ?? (typeof fetch === 'function' ? fetch : undefined);
    if (!doFetch) throw new CherryApiError('fetch is not available', 'NETWORK_ERROR');

    let res: Response;
    try {
      res = await doFetch(`${origin}${path}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        credentials: 'omit',
      });
    } catch (err) {
      throw new CherryApiError(err instanceof Error ? err.message : 'Network error', 'NETWORK_ERROR');
    }

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
      const serverCode = typeof record['code'] === 'string' ? record['code'] : null;
      const message = typeof record['message'] === 'string' ? record['message'] : `HTTP ${res.status}`;
      throw new CherryApiError(message, STATUS_CODES[res.status] ?? 'HTTP_ERROR', res.status, serverCode);
    }
    const value = read(body) ?? read(unwrapData(body));
    if (value === null) throw new CherryApiError(`Unexpected answer from ${path}`, 'INVALID_RESPONSE', res.status);
    return value;
  }

  const id = (cherryId: string): string => {
    if (typeof cherryId !== 'string' || cherryId.length === 0) throw new TypeError('cherryId must be a non-empty string');
    return encodeURIComponent(cherryId);
  };

  const page = (options: CherryUserPageOptions = {}): string => {
    const query = new URLSearchParams();
    if (options.cursor) query.set('cursor', options.cursor);
    if (options.limit !== undefined && Number.isFinite(options.limit)) {
      query.set('limit', String(Math.min(100, Math.max(1, Math.floor(options.limit)))));
    }
    const qs = query.toString();
    return qs ? `?${qs}` : '';
  };

  return {
    me: async () => call('/api/miniapp/me', normaliseProfile),
    get: async (cherryId) => call(`/api/miniapp/users/${id(cherryId)}`, normaliseProfile),
    followers: async (cherryId, options) =>
      call(`/api/miniapp/users/${id(cherryId)}/followers${page(options)}`, normaliseUserPage),
    following: async (cherryId, options) =>
      call(`/api/miniapp/users/${id(cherryId)}/following${page(options)}`, normaliseUserPage),
    relationship: async (cherryId) => call(`/api/miniapp/users/${id(cherryId)}/relationship`, normaliseRelationship),
  };
}

/** `{ data: … }`-wrapped answers (some Cherry endpoints wrap) read the same. */
function unwrapData(body: unknown): unknown {
  return typeof body === 'object' && body !== null && 'data' in body ? (body as { data: unknown }).data : undefined;
}
