import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as jose from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LaunchTokenError, verifyLaunchToken, type LaunchTokenErrorCode } from '../src/token';

const ISSUER = 'https://chat.cherry.fun';
const APP_ID = 'app_123';
const KID = 'test-key-1';

let privateKey: jose.KeyLike;
let otherPrivateKey: jose.KeyLike;
let jwks: jose.JSONWebKeySet;
let server: Server;
let jwksUrl: string;
let jwksHits = 0;

beforeAll(async () => {
  const pair = await jose.generateKeyPair('RS256');
  privateKey = pair.privateKey;
  otherPrivateKey = (await jose.generateKeyPair('RS256')).privateKey;
  const publicJwk = { ...(await jose.exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
  jwks = { keys: [publicJwk] };

  // A stand-in for https://chat.cherry.fun/.well-known/jwks.json
  server = createServer((req, res) => {
    if (req.url === '/.well-known/jwks.json') {
      jwksHits += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(jwks));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  jwksUrl = `http://127.0.0.1:${port}/.well-known/jwks.json`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const now = () => Math.floor(Date.now() / 1000);

function roomLaunchClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISSUER,
    aud: APP_ID,
    sub: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    app_id: APP_ID,
    room_id: 'room_1',
    origin: 'https://game.example',
    cherry_id: 'cid_42',
    payment_wallet: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
    payment_wallet_kind: 'app_held',
    permissions: ['wallet:sign', 'navigate:profile'],
    reach: 'external',
    tier: 'unverified',
    user: { display_name: 'Alice', avatar_url: 'https://cdn.example/a.png' },
    room: { title: 'Lobby', member_count: 3 },
    iat: now(),
    exp: now() + 300,
    jti: 'jti-1',
    ...overrides,
  };
}

async function sign(
  claims: Record<string, unknown>,
  key: jose.KeyLike = privateKey,
  header: jose.JWTHeaderParameters = { alg: 'RS256', kid: KID },
): Promise<string> {
  return new jose.SignJWT(claims as jose.JWTPayload).setProtectedHeader(header).sign(key);
}

async function rejection(promise: Promise<unknown>): Promise<LaunchTokenError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LaunchTokenError);
    return error as LaunchTokenError;
  }
  throw new Error('expected the token to be rejected');
}

async function expectCode(promise: Promise<unknown>, code: LaunchTokenErrorCode): Promise<void> {
  expect((await rejection(promise)).code).toBe(code);
}

describe('verifyLaunchToken', () => {
  it('accepts a good token against a remote JWKS and returns the typed claims', async () => {
    const token = await sign(roomLaunchClaims());
    const claims = await verifyLaunchToken(token, { appId: APP_ID, jwksUrl });
    expect(claims.sub).toBe('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
    expect(claims.aud).toBe(APP_ID);
    expect(claims.tier).toBe('unverified');
    expect(claims.cherry_id).toBe('cid_42');
    expect(claims.payment_wallet_kind).toBe('app_held');
    expect(claims.permissions).toEqual(['wallet:sign', 'navigate:profile']);
    expect(claims.reach).toBe('external');
  });

  it('fetches the JWKS once and reuses it across verifications', async () => {
    await verifyLaunchToken(await sign(roomLaunchClaims()), { appId: APP_ID, jwksUrl });
    const warmed = jwksHits;
    expect(warmed).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) {
      await verifyLaunchToken(await sign(roomLaunchClaims({ jti: `j${i}` })), { appId: APP_ID, jwksUrl });
    }
    expect(jwksHits).toBe(warmed);
  });

  it('accepts a local key set via `jwks`', async () => {
    const token = await sign(roomLaunchClaims());
    await expect(verifyLaunchToken(token, { appId: APP_ID, jwks })).resolves.toMatchObject({ app_id: APP_ID });
  });

  it('still accepts the 0.1.21 option names', async () => {
    const token = await sign(roomLaunchClaims());
    await expect(
      verifyLaunchToken(token, { expectedAppId: APP_ID, expectedOrigin: 'https://game.example', jwks }),
    ).resolves.toMatchObject({ app_id: APP_ID });
  });

  it('rejects a wrong issuer', async () => {
    const token = await sign(roomLaunchClaims({ iss: 'https://evil.example' }));
    await expectCode(verifyLaunchToken(token, { appId: APP_ID, jwks }), 'ISSUER_MISMATCH');
  });

  it('rejects a token without an issuer', async () => {
    const claims = roomLaunchClaims();
    delete claims['iss'];
    await expectCode(verifyLaunchToken(await sign(claims), { appId: APP_ID, jwks }), 'ISSUER_MISMATCH');
  });

  it('accepts an extra issuer when configured (staging)', async () => {
    const token = await sign(roomLaunchClaims({ iss: 'https://stage.cherry.fun' }));
    await expect(
      verifyLaunchToken(token, { appId: APP_ID, jwks, issuer: [ISSUER, 'https://stage.cherry.fun'] }),
    ).resolves.toBeDefined();
  });

  it('rejects a wrong audience', async () => {
    const token = await sign(roomLaunchClaims({ aud: 'someone_else' }));
    await expectCode(verifyLaunchToken(token, { appId: APP_ID, jwks }), 'AUDIENCE_MISMATCH');
  });

  it('accepts an audience array that names the app', async () => {
    const token = await sign(roomLaunchClaims({ aud: ['other', APP_ID] }));
    await expect(verifyLaunchToken(token, { appId: APP_ID, jwks })).resolves.toBeDefined();
  });

  it('accepts a token without aud during the migration, unless requireAudience', async () => {
    const claims = roomLaunchClaims();
    delete claims['aud'];
    const token = await sign(claims);
    await expect(verifyLaunchToken(token, { appId: APP_ID, jwks })).resolves.toBeDefined();
    await expectCode(verifyLaunchToken(token, { appId: APP_ID, jwks, requireAudience: true }), 'AUDIENCE_MISSING');
  });

  it('rejects an expired token', async () => {
    const token = await sign(roomLaunchClaims({ iat: now() - 600, exp: now() - 120 }));
    await expectCode(verifyLaunchToken(token, { appId: APP_ID, jwks }), 'TOKEN_EXPIRED');
  });

  it('tolerates small clock skew on exp', async () => {
    const token = await sign(roomLaunchClaims({ iat: now() - 310, exp: now() - 10 }));
    await expect(verifyLaunchToken(token, { appId: APP_ID, jwks })).resolves.toBeDefined();
    await expectCode(verifyLaunchToken(token, { appId: APP_ID, jwks, clockTolerance: 0 }), 'TOKEN_EXPIRED');
  });

  it('rejects a token that is not valid yet', async () => {
    const token = await sign(roomLaunchClaims({ nbf: now() + 600 }));
    await expectCode(verifyLaunchToken(token, { appId: APP_ID, jwks }), 'TOKEN_NOT_YET_VALID');
  });

  it('rejects a token without exp', async () => {
    const claims = roomLaunchClaims();
    delete claims['exp'];
    await expectCode(verifyLaunchToken(await sign(claims), { appId: APP_ID, jwks }), 'TOKEN_INVALID');
  });

  it('rejects a wrong app_id', async () => {
    const claims = roomLaunchClaims({ app_id: 'other_app' });
    delete claims['aud'];
    const error = await rejection(verifyLaunchToken(await sign(claims), { appId: APP_ID, jwks }));
    expect(error.code).toBe('APP_ID_MISMATCH');
    expect(error.message).toContain('Token app_id mismatch: expected app_123, got other_app');
  });

  it('accepts an inline blink token that names the app in mini_app_id', async () => {
    const token = await sign({
      iss: ISSUER,
      aud: APP_ID,
      scope: 'inline',
      mode: 'inline',
      app_id: 'bot_app_9',
      mini_app_id: APP_ID,
      room_id: 'room_1',
      message_id: 'msg_1',
      params: { score: 1 },
      iat: now(),
      exp: now() + 900,
      jti: 'j-inline',
    });
    const claims = await verifyLaunchToken(token, { appId: APP_ID, jwks, scope: 'inline' });
    expect(claims.message_id).toBe('msg_1');
    await expectCode(verifyLaunchToken(token, { appId: APP_ID, jwks, scope: 'launch' }), 'SCOPE_MISMATCH');
  });

  it("treats a token without a scope claim as a 'launch' token", async () => {
    const token = await sign(roomLaunchClaims());
    await expect(verifyLaunchToken(token, { appId: APP_ID, jwks, scope: 'launch' })).resolves.toBeDefined();
    await expectCode(verifyLaunchToken(token, { appId: APP_ID, jwks, scope: ['inline'] }), 'SCOPE_MISMATCH');
  });

  it('rejects an origin mismatch', async () => {
    const token = await sign(roomLaunchClaims());
    await expectCode(
      verifyLaunchToken(token, { appId: APP_ID, jwks, origin: 'https://other.example' }),
      'ORIGIN_MISMATCH',
    );
  });

  it('rejects a token signed by another key', async () => {
    const token = await sign(roomLaunchClaims(), otherPrivateKey);
    await expectCode(verifyLaunchToken(token, { appId: APP_ID, jwks }), 'SIGNATURE_INVALID');
  });

  it('rejects a token with an unknown kid', async () => {
    const token = await sign(roomLaunchClaims(), privateKey, { alg: 'RS256', kid: 'nope' });
    await expectCode(verifyLaunchToken(token, { appId: APP_ID, jwks }), 'SIGNATURE_INVALID');
  });

  it('rejects other algorithms (HS256)', async () => {
    const secret = new TextEncoder().encode('x'.repeat(32));
    const token = await new jose.SignJWT(roomLaunchClaims() as jose.JWTPayload)
      .setProtectedHeader({ alg: 'HS256', kid: KID })
      .sign(secret);
    await expectCode(verifyLaunchToken(token, { appId: APP_ID, jwks }), 'TOKEN_INVALID');
  });

  it('rejects garbage', async () => {
    await expectCode(verifyLaunchToken('not-a-jwt', { appId: APP_ID, jwks }), 'TOKEN_INVALID');
    await expectCode(verifyLaunchToken('a.b.c', { appId: APP_ID, jwks }), 'TOKEN_INVALID');
  });

  it('reports an unreachable JWKS as JWKS_UNAVAILABLE', async () => {
    const token = await sign(roomLaunchClaims());
    await expectCode(
      verifyLaunchToken(token, { appId: APP_ID, jwksUrl: 'http://127.0.0.1:1/.well-known/jwks.json' }),
      'JWKS_UNAVAILABLE',
    );
  });

  it('requires an app id', async () => {
    const token = await sign(roomLaunchClaims());
    await expectCode(
      verifyLaunchToken(token, { appId: '', jwks }),
      'INVALID_OPTIONS',
    );
    await expectCode(
      verifyLaunchToken(token, { appId: APP_ID, expectedAppId: 'other', jwks }),
      'INVALID_OPTIONS',
    );
  });
});
