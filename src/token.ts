import * as jose from 'jose';
import type { LaunchTokenPayload } from './types';

const DEFAULT_JWKS_URL = 'https://chat.cherry.fun/.well-known/jwks.json';

export async function verifyLaunchToken(
  token: string,
  options: {
    jwksUrl?: string;
    expectedAppId: string;
    expectedOrigin?: string;
  },
): Promise<LaunchTokenPayload> {
  const jwks = jose.createRemoteJWKSet(new URL(options.jwksUrl ?? DEFAULT_JWKS_URL));
  const { payload } = await jose.jwtVerify(token, jwks, {
    algorithms: ['RS256'],
  });

  if (payload['app_id'] !== options.expectedAppId) {
    throw new Error(
      `Token app_id mismatch: expected ${options.expectedAppId}, got ${String(payload['app_id'])}`,
    );
  }
  if (options.expectedOrigin && payload['origin'] !== options.expectedOrigin) {
    throw new Error(
      `Token origin mismatch: expected ${options.expectedOrigin}, got ${String(payload['origin'])}`,
    );
  }

  return payload as unknown as LaunchTokenPayload;
}
