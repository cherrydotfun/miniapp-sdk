// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { destroySharedBridge, getSharedBridge } from '../src/bridge';
import { CherryMiniApp } from '../src/client';
import {
  TRANSACTION_LABEL_MAX,
  attachTransactionLabel,
  normalizeTransactionLabel,
  withTransactionLabel,
} from '../src/label';
import { autoRespond, deliver, fakeToken, installFakeParent, restoreParent, setUrl, type FakeParent } from './helpers/host';

const HOST = 'https://chat.cherry.fun';
const WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const TX = btoa('not-a-real-transaction');

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
  const cherry = new CherryMiniApp();
  const ready = cherry.init();
  deliver(
    {
      type: 'cherry:init',
      version: 2,
      token: fakeToken({ sub: WALLET, app_id: 'app_1', aud: 'app_1', room_id: 'r', user: { display_name: '', avatar_url: '' }, room: { title: '', member_count: 0 } }),
      capabilities: [],
    },
    { origin: HOST, source: host.window },
  );
  await ready;
  return cherry;
}

/** Answers every sign request and records the params it carried. */
function recordSigns(): Record<string, unknown>[] {
  const seen: Record<string, unknown>[] = [];
  autoRespond(host, (method, params) => {
    if (!method.startsWith('wallet.sign')) return null;
    seen.push({ method, ...(params ?? {}) });
    if (method === 'wallet.signTransactions') return { result: { transactions: [TX] } };
    if (method === 'wallet.signAndSendTransaction') return { result: { signature: 'sig' } };
    return { result: { transaction: TX } };
  });
  return seen;
}

describe('normalizeTransactionLabel', () => {
  it('keeps a plain line as it is', () => {
    expect(normalizeTransactionLabel('Buy 3 lives')).toBe('Buy 3 lives');
  });

  it('folds line breaks, control and bidi characters into one line', () => {
    expect(normalizeTransactionLabel('  Buy\n3\tlives‮  ')).toBe('Buy 3 lives');
  });

  it('cuts a long label with an ellipsis at the limit', () => {
    const cut = normalizeTransactionLabel('x'.repeat(200))!;
    expect(Array.from(cut)).toHaveLength(TRANSACTION_LABEL_MAX);
    expect(cut.endsWith('…')).toBe(true);
  });

  it('drops zero-width, tag and filler characters and flattens piles of combining marks', () => {
    expect(normalizeTransactionLabel('Buy\u200b\u200d 3\u061c lives\u{E0041}')).toBe('Buy 3 lives');
    expect(normalizeTransactionLabel('\u3164\u3164')).toBeUndefined();
    expect(normalizeTransactionLabel(`a${'\u0301'.repeat(200)}b`)).toBe(`a${'\u0301'.repeat(2)}b`);
  });

  it('drops what is not a non-empty string', () => {
    expect(normalizeTransactionLabel('   ')).toBeUndefined();
    expect(normalizeTransactionLabel(42)).toBeUndefined();
    expect(normalizeTransactionLabel(undefined)).toBeUndefined();
  });
});

describe('attachTransactionLabel', () => {
  it('never touches a method that is not a signature', async () => {
    const params = { message: 'aGk=', label: 'x' };
    await withTransactionLabel('Buy', async () => {
      expect(attachTransactionLabel('wallet.signMessage', params)).toBe(params);
      expect(attachTransactionLabel('navigate.openRoom', undefined)).toBeUndefined();
    });
  });

  it('drops an invalid explicit label instead of sending it', () => {
    expect(attachTransactionLabel('wallet.signTransaction', { transaction: TX, label: '  ' })).toEqual({ transaction: TX });
  });
});

describe('labels on the wire', () => {
  it('sends an explicit label with the request', async () => {
    const cherry = await readyApp();
    const seen = recordSigns();
    await cherry.wallet.signAndSendTransaction(TX, { label: 'Enter the weekly tournament' });
    expect(seen).toEqual([{ method: 'wallet.signAndSendTransaction', transaction: TX, label: 'Enter the weekly tournament' }]);
  });

  it('sends no label field when none was given', async () => {
    const cherry = await readyApp();
    const seen = recordSigns();
    await cherry.wallet.signTransaction(TX);
    expect(seen[0]).not.toHaveProperty('label');
  });

  it('labels requests made through the shared bridge inside withTransactionLabel, and only those', async () => {
    await readyApp();
    const seen = recordSigns();
    const bridge = getSharedBridge();
    await withTransactionLabel('Buy 3 lives', async () => {
      await bridge.request('wallet.signTransactions', { transactions: [TX] });
    });
    await bridge.request('wallet.signTransaction', { transaction: TX });
    expect(seen[0]).toMatchObject({ method: 'wallet.signTransactions', label: 'Buy 3 lives' });
    expect(seen[1]).not.toHaveProperty('label');
  });

  it('prefers an explicit label and the innermost surrounding one', async () => {
    const cherry = await readyApp();
    const seen = recordSigns();
    await withTransactionLabel('Outer', async () => {
      await withTransactionLabel('Inner', () => cherry.wallet.signTransaction(TX));
      await cherry.wallet.signTransaction(TX, { label: 'Explicit' });
      await cherry.wallet.signTransaction(TX);
    });
    expect(seen.map((s) => s['label'])).toEqual(['Inner', 'Explicit', 'Outer']);
  });

  it('keeps the scope on globalThis, so every bundled entry of the package shares it', async () => {
    const shared = (globalThis as unknown as Record<symbol, { active: { label: string }[] }>)[
      Symbol.for('cherry.miniapp-sdk.txLabel')
    ];
    await withTransactionLabel('Seen everywhere', async () => {
      const scope = (globalThis as unknown as Record<symbol, { active: { label: string }[] }>)[
        Symbol.for('cherry.miniapp-sdk.txLabel')
      ];
      expect(scope?.active[scope.active.length - 1]?.label).toBe('Seen everywhere');
      if (shared) expect(scope).toBe(shared);
    });
  });

  it('detaches the label when the wrapped call throws', async () => {
    await readyApp();
    const seen = recordSigns();
    await expect(
      withTransactionLabel('Doomed', () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await getSharedBridge().request('wallet.signTransaction', { transaction: TX });
    expect(seen[0]).not.toHaveProperty('label');
  });
});
