// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BridgeError, destroySharedBridge } from '../src/bridge';
import { CherryMiniApp } from '../src/client';
import { autoRespond, deliver, fakeToken, installFakeParent, restoreParent, setUrl, type FakeParent } from './helpers/host';

const HOST = 'https://chat.cherry.fun';
let host: FakeParent;

beforeEach(() => {
  host = installFakeParent();
  setUrl('/?cherry_embed=1');
});

afterEach(() => {
  destroySharedBridge();
  restoreParent();
  setUrl('/');
});

async function readyApp(): Promise<CherryMiniApp> {
  const app = new CherryMiniApp();
  const ready = app.init();
  deliver(
    { type: 'cherry:init', version: 2, token: fakeToken({ sub: 'W', app_id: 'a', room_id: 'r', user: { display_name: '', avatar_url: '' }, room: { title: '', member_count: 0 } }), capabilities: [] },
    { origin: HOST, source: host.window },
  );
  await ready;
  return app;
}

const methodsSent = () => host.sent('cherry:request').map((m) => m['method']);

/** A host that only knows `known`, refusing anything else the way `refusal` says. */
function hostKnowing(known: string[], refusal: (method: string) => Record<string, unknown>) {
  return (method: string) => (known.includes(method) ? { result: {} } : { error: refusal(method) });
}

describe('navigation aliases', () => {
  it('sends the canonical name to a host that knows it', async () => {
    const app = await readyApp();
    autoRespond(host, hostKnowing(['navigate.userProfile', 'navigate.openRoom'], () => ({ code: 'BRIDGE_ERROR', message: 'x' })));
    await app.navigate.userProfile('alice.sol');
    await app.navigate.openRoom('@group');
    expect(methodsSent()).toEqual(['navigate.userProfile', 'navigate.openRoom']);
    expect(host.sent('cherry:request')[0]?.['params']).toEqual({ identifier: 'alice.sol' });
    app.destroy();
  });

  it('retries with the alias on an older inline host, then goes straight to it', async () => {
    const app = await readyApp();
    autoRespond(
      host,
      hostKnowing(['navigate.profile', 'navigate.room'], (m) => ({
        code: 'METHOD_NOT_ALLOWED_IN_INLINE',
        message: `Method "${m}" is not allowed inside an inline blink.`,
      })),
    );
    await app.navigate.userProfile('alice.sol');
    await app.navigate.userProfile('bob.sol');
    await app.navigate.openRoom('@group');
    expect(methodsSent()).toEqual([
      'navigate.userProfile',
      'navigate.profile',
      'navigate.profile',
      'navigate.openRoom',
      'navigate.room',
    ]);
    app.destroy();
  });

  it.each([
    ['web fullscreen', { code: 'BRIDGE_ERROR', message: 'Unknown method: navigate.userProfile' }],
    ['web inline', { code: 'UNKNOWN_METHOD', message: 'Unknown method: navigate.userProfile' }],
    ['mobile inline', { code: 'METHOD_NOT_FOUND', message: 'Unknown method: navigate.userProfile' }],
    ['reserved', { code: 'METHOD_NOT_SUPPORTED', message: 'nope' }],
  ])('treats a %s method refusal as "try the alias"', async (_label, refusal) => {
    const app = await readyApp();
    autoRespond(host, hostKnowing(['navigate.profile'], () => refusal));
    await expect(app.navigate.userProfile('alice.sol')).resolves.toBeUndefined();
    expect(methodsSent()).toEqual(['navigate.userProfile', 'navigate.profile']);
    app.destroy();
  });

  it('does not retry a real failure (e.g. a missing permission)', async () => {
    const app = await readyApp();
    autoRespond(host, () => ({
      error: { code: 'BRIDGE_ERROR', message: 'Permission denied: navigate:profile not granted for this mini-app' },
    }));
    await expect(app.navigate.userProfile('alice.sol')).rejects.toThrow(/Permission denied/);
    expect(methodsSent()).toEqual(['navigate.userProfile']);
    app.destroy();
  });

  it('reports the first refusal when the host knows neither name', async () => {
    const app = await readyApp();
    autoRespond(host, (m) => ({ error: { code: 'BRIDGE_ERROR', message: `Unknown method: ${m}` } }));
    const error = await app.navigate.openRoom('@group').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BridgeError);
    expect((error as BridgeError).message).toBe('Unknown method: navigate.openRoom');
    expect(methodsSent()).toEqual(['navigate.openRoom', 'navigate.room']);
    app.destroy();
  });

  it('surfaces a real failure of the alias', async () => {
    const app = await readyApp();
    autoRespond(host, (m) =>
      m === 'navigate.room'
        ? { error: { code: 'BRIDGE_ERROR', message: 'Room not found' } }
        : { error: { code: 'UNKNOWN_METHOD', message: `Unknown method: ${m}` } },
    );
    await expect(app.navigate.openRoom('@nope')).rejects.toThrow('Room not found');
    app.destroy();
  });
});
