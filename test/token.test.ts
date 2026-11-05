import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as jose from 'jose';
import { verifyLaunchToken } from '../src/token';
import { CHERRY_ISSUER } from '../src/privy';

// A local JWKS endpoint so verification runs end to end (fetch, key
// selection, signature, claims) exactly as against chat.cherry.fun.
let server: ReturnType<typeof Bun.serve>;
let jwksUrl: string;
let privateKey: jose.KeyLike;

beforeAll(async () => {
  const pair = await jose.generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const jwk = { ...(await jose.exportJWK(pair.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  server = Bun.serve({ port: 0, fetch: () => Response.json({ keys: [jwk] }) });
  jwksUrl = `http://localhost:${server.port}/.well-known/jwks.json`;
});

afterAll(() => server.stop(true));

async function mint(claims: Record<string, unknown>, iss: string | null = CHERRY_ISSUER): Promise<string> {
  let jwt = new jose.SignJWT({ app_id: 'app_1', room_id: 'room_1', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject('wallet_sub')
    .setIssuedAt()
    .setExpirationTime('5m')
    .setJti('jti-1');
  if (iss !== null) jwt = jwt.setIssuer(iss);
  return jwt.sign(privateKey);
}

describe('verifyLaunchToken', () => {
  test('accepts a Cherry-issued token and returns its claims', async () => {
    const payload = await verifyLaunchToken(await mint({ payment_wallet: 'payer', cherry_id: 'cid_1' }), {
      jwksUrl,
      expectedAppId: 'app_1',
    });
    expect(payload.sub).toBe('wallet_sub');
    expect(payload.iss).toBe(CHERRY_ISSUER);
    expect(payload.payment_wallet).toBe('payer');
    expect(payload.cherry_id).toBe('cid_1');
  });

  test('allows legacy issuers unless issuer is specified', async () => {
    const token = await mint({}, 'https://evil.example');
    await expect(verifyLaunchToken(token, { jwksUrl, expectedAppId: 'app_1' })).resolves.toMatchObject({ iss: 'https://evil.example' });
  });

  test('accepts a legacy token without iss', async () => {
    const token = await mint({}, null);
    await expect(verifyLaunchToken(token, { jwksUrl, expectedAppId: 'app_1' })).resolves.toMatchObject({ app_id: 'app_1' });
  });

  test('issuer is overridable', async () => {
    const staging = 'https://staging.cherry.example';
    const opts = { jwksUrl, expectedAppId: 'app_1', issuer: staging };
    await expect(verifyLaunchToken(await mint({}, staging), opts)).resolves.toMatchObject({ iss: staging });
    await expect(verifyLaunchToken(await mint({}), opts)).rejects.toThrow(/iss/);
  });

  test('expectedScope is enforced when given', async () => {
    const inline = await mint({ scope: 'inline', mode: 'inline' });
    await expect(
      verifyLaunchToken(inline, { jwksUrl, expectedAppId: 'app_1', expectedScope: 'inline' }),
    ).resolves.toMatchObject({ scope: 'inline' });
    await expect(
      verifyLaunchToken(inline, { jwksUrl, expectedAppId: 'app_1', expectedScope: 'fullscreen' }),
    ).rejects.toThrow('Token scope mismatch: expected fullscreen, got inline');
    // Embed `cherry:init` tokens carry no scope at all.
    await expect(
      verifyLaunchToken(await mint({}), { jwksUrl, expectedAppId: 'app_1', expectedScope: 'inline' }),
    ).rejects.toThrow('Token scope mismatch: expected inline, got undefined');
  });

  test('scope is not checked without expectedScope', async () => {
    const token = await mint({ scope: 'fullscreen' });
    await expect(verifyLaunchToken(token, { jwksUrl, expectedAppId: 'app_1' })).resolves.toMatchObject({
      scope: 'fullscreen',
    });
  });

  test('app_id and origin checks are unchanged', async () => {
    const token = await mint({ origin: 'https://game.example' });
    await expect(verifyLaunchToken(token, { jwksUrl, expectedAppId: 'other' })).rejects.toThrow(
      'Token app_id mismatch: expected other, got app_1',
    );
    await expect(
      verifyLaunchToken(token, { jwksUrl, expectedAppId: 'app_1', expectedOrigin: 'https://x.example' }),
    ).rejects.toThrow('Token origin mismatch: expected https://x.example, got https://game.example');
    await expect(
      verifyLaunchToken(token, { jwksUrl, expectedAppId: 'app_1', expectedOrigin: 'https://game.example' }),
    ).resolves.toMatchObject({ origin: 'https://game.example' });
  });

  test('a token signed by another key is rejected', async () => {
    const { privateKey: stranger } = await jose.generateKeyPair('RS256');
    const token = await new jose.SignJWT({ app_id: 'app_1' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(CHERRY_ISSUER)
      .setExpirationTime('5m')
      .sign(stranger);
    await expect(verifyLaunchToken(token, { jwksUrl, expectedAppId: 'app_1' })).rejects.toThrow();
  });
});
