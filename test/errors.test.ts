// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Bridge, BridgeError, getBridgeError, isPolicyDenied } from '../src/bridge';
import { deliver, installFakeParent, restoreParent, type FakeParent } from './helpers/host';

const HOST = 'https://chat.cherry.fun';
let host: FakeParent;
let bridge: Bridge;

beforeEach(() => {
  host = installFakeParent();
  bridge = new Bridge();
  deliver({ type: 'cherry:init', version: 2, token: 't', capabilities: [] }, { origin: HOST, source: host.window });
});

afterEach(() => {
  bridge.destroy();
  restoreParent();
});

async function answer(response: Record<string, unknown>): Promise<BridgeError> {
  const pending = bridge.request('wallet.signAndSendTransaction', { transaction: 'AA==' });
  const { id } = host.lastRequest();
  deliver({ type: 'cherry:response', id, ...response }, { origin: HOST, source: host.window });
  const error = await pending.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(BridgeError);
  return error as BridgeError;
}

describe('coded host errors', () => {
  it('reads policyCode / reason from error.data', async () => {
    const error = await answer({
      error: {
        code: 'POLICY_DENIED',
        message: 'Denied by policy',
        data: { policyCode: 'TX_LIMIT', reason: 'Max $50 per transaction for unverified apps' },
      },
    });
    expect(error.code).toBe('POLICY_DENIED');
    expect(error.policyCode).toBe('TX_LIMIT');
    expect(error.reason).toBe('Max $50 per transaction for unverified apps');
    expect(isPolicyDenied(error)).toBe(true);
  });

  it('reads policyCode / reason placed on the error object itself', async () => {
    const error = await answer({
      error: { code: 'POLICY_DENIED', message: 'Denied', policyCode: 'DAILY_LIMIT', reason: 'Daily limit' },
    });
    expect(error.policyCode).toBe('DAILY_LIMIT');
    expect(error.data).toMatchObject({ policyCode: 'DAILY_LIMIT' });
  });

  it('reads policyCode / reason sent beside the error (mobile sibling fields)', async () => {
    const error = await answer({
      error: { code: 'POLICY_DENIED', message: 'Denied' },
      policyCode: 'FORBIDDEN_INSTRUCTION',
      reason: 'SetAuthority is not allowed',
    });
    expect(error.policyCode).toBe('FORBIDDEN_INSTRUCTION');
    expect(error.reason).toBe('SetAuthority is not allowed');
  });

  it('keeps legacy shapes working', async () => {
    const plain = await answer({ error: 'Cancelled' });
    expect(plain).toMatchObject({ code: 'UNKNOWN', message: 'Cancelled' });
    expect(plain.policyCode).toBeUndefined();
    const generic = await answer({ error: { code: 'BRIDGE_ERROR', message: 'Unknown method: x' } });
    expect(generic.code).toBe('BRIDGE_ERROR');
    expect(isPolicyDenied(generic)).toBe(false);
    const precheck = await answer({ error: { code: 'PRECHECK_UNAVAILABLE', message: 'Try again' } });
    expect(precheck.code).toBe('PRECHECK_UNAVAILABLE');
  });
});

describe('getBridgeError', () => {
  it('unwraps wallet-adapter errors and causes', () => {
    const inner = new BridgeError('Denied', 'POLICY_DENIED', { policyCode: 'APP_PAUSED' });
    const adapterError = Object.assign(new Error('Denied'), { name: 'WalletSendTransactionError', error: inner });
    expect(getBridgeError(adapterError)).toBe(inner);
    expect(isPolicyDenied(adapterError)).toBe(true);
    const caused = Object.assign(new Error('outer'), { cause: inner });
    expect(getBridgeError(caused)).toBe(inner);
    expect(getBridgeError(new Error('plain'))).toBeNull();
    expect(getBridgeError(undefined)).toBeNull();
  });
});
