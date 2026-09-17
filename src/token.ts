import * as jose from 'jose';
import type { LaunchTokenPayload } from './types';
import { CHERRY_ISSUER } from './privy';

const DEFAULT_JWKS_URL = 'https://chat.cherry.fun/.well-known/jwks.json';

export async function verifyLaunchToken(
  token: string,
  options: {
    jwksUrl?: string;
    expectedAppId: string;
    expectedOrigin?: string;
    /**
     * Required `iss` claim. Defaults to `https://chat.cherry.fun`; override
     * only together with `jwksUrl` for a non-production Cherry deployment.
     */
    issuer?: string;
    /**
     * Required `scope` claim (`'inline'` for blink cards, `'fullscreen'` for
     * the runner). Not checked when omitted — embed `cherry:init` tokens carry
     * no scope.
     */
    expectedScope?: string;
  },
): Promise<LaunchTokenPayload> {
  const jwks = jose.createRemoteJWKSet(new URL(options.jwksUrl ?? DEFAULT_JWKS_URL));
  const { payload } = await jose.jwtVerify(token, jwks, {
    algorithms: ['RS256'],
    // Every Cherry launch token is minted with `iss: CHERRY_ISSUER`; pinning
    // it rejects anything else signed with a key the JWKS happens to serve.
    issuer: options.issuer ?? CHERRY_ISSUER,
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
  if (options.expectedScope !== undefined && payload['scope'] !== options.expectedScope) {
    throw new Error(
      `Token scope mismatch: expected ${options.expectedScope}, got ${String(payload['scope'])}`,
    );
  }

  return payload as unknown as LaunchTokenPayload;
}
