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
  it('reads POLICY_DENIED exactly as the hosts send it (policy code in data.code)', async () => {
    const data = {
      code: 'DAILY_LIMIT',
      reason: 'Daily limit of $50 reached for unverified apps',
      tier: 'unverified',
      outflowUsd: 20,
      perTxLimitUsd: 50,
      dailyUsedUsd: 45,
      dailyLimitUsd: 50,
    };
    const error = await answer({
      error: { code: 'POLICY_DENIED', message: 'Daily limit of $50 reached for unverified apps', data },
    });
    expect(error.code).toBe('POLICY_DENIED');
    expect(error.policyCode).toBe('DAILY_LIMIT');
    expect(error.reason).toBe('Daily limit of $50 reached for unverified apps');
    expect(error.data).toEqual(data);
    expect(error.policy).toEqual({
      policyCode: 'DAILY_LIMIT',
      reason: 'Daily limit of $50 reached for unverified apps',
      tier: 'unverified',
      outflowUsd: 20,
      perTxLimitUsd: 50,
      dailyUsedUsd: 45,
      dailyLimitUsd: 50,
    });
    expect(isPolicyDenied(error)).toBe(true);
  });

  it('reads PRECHECK_UNAVAILABLE with its status', async () => {
    const error = await answer({ error: { code: 'PRECHECK_UNAVAILABLE', message: 'Try again', data: { status: 503 } } });
    expect(error.code).toBe('PRECHECK_UNAVAILABLE');
    expect(error.data).toEqual({ status: 503 });
    expect(error.policyCode).toBeUndefined();
    expect(error.policy).toBeNull();
  });

  it('does not read data.code as a policy code on other errors', async () => {
    const error = await answer({ error: { code: 'WALLET_CHANGED', message: 'Rebuild', data: { code: 'X' } } });
    expect(error.policyCode).toBeUndefined();
  });

  it('accepts an explicit data.policyCode too', async () => {
    const error = await answer({
      error: { code: 'POLICY_DENIED', message: 'Denied', data: { policyCode: 'TX_LIMIT', reason: 'Max $50' } },
    });
    expect(error.policyCode).toBe('TX_LIMIT');
    expect(error.policy).toMatchObject({ policyCode: 'TX_LIMIT', reason: 'Max $50', outflowUsd: null });
  });

  it('reads policyCode / reason placed on the error object itself', async () => {
    const error = await answer({
      error: { code: 'POLICY_DENIED', message: 'Denied', policyCode: 'DAILY_LIMIT', reason: 'Daily limit' },
    });
    expect(error.policyCode).toBe('DAILY_LIMIT');
    expect(error.reason).toBe('Daily limit');
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
