// @vitest-environment jsdom
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
} from '@solana/kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { destroySharedBridge } from '../src/bridge';
import { CherryMiniApp } from '../src/client';
import { buildCherryFeeSplit, createCherrySigner } from '../src/kit';
import { autoRespond, deliver, fakeToken, installFakeParent, restoreParent, setUrl, type FakeParent } from './helpers/host';

const HOST = 'https://chat.cherry.fun';
const WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const DEVELOPER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const TREASURY = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH';
const BLOCKHASH = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';

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

describe('kit flow from the README', () => {
  it('compiles a fee split, has Cherry sign it, and encodes the wire transaction', async () => {
    const cherry = new CherryMiniApp();
    const ready = cherry.init();
    deliver(
      { type: 'cherry:init', version: 2, token: fakeToken({ sub: WALLET, app_id: 'app_1', aud: 'app_1', room_id: 'r', user: { display_name: '', avatar_url: '' }, room: { title: '', member_count: 0 } }), capabilities: [] },
      { origin: HOST, source: host.window },
    );
    await ready;

    const fakeSignature = new Uint8Array(64).fill(7);
    autoRespond(host, (method, params) => {
      if (method !== 'wallet.signTransactions') return null;
      // The host signs: write Cherry's signature into slot 0 (the fee payer).
      const signed = (params!['transactions'] as string[]).map((b64) => {
        const wire = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        wire.set(fakeSignature, 1);
        return btoa(String.fromCharCode(...wire));
      });
      return { result: { transactions: signed } };
    });

    const signer = createCherrySigner(cherry);
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(address(signer.address), m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH as Blockhash, lastValidBlockHeight: 1n }, m),
      (m) =>
        appendTransactionMessageInstructions(
          buildCherryFeeSplit({ payer: signer.address, developer: DEVELOPER, treasury: TREASURY, amount: 10_000_000n, appId: cherry.appId! }),
          m,
        ),
    );
    const compiled = compileTransaction(message);
    const [signed] = await signer.signTransactions([compiled]);
    expect(Array.from(signed!.signatures[WALLET]!)).toEqual(Array.from(fakeSignature));

    const wire = getBase64EncodedWireTransaction(signed as unknown as typeof compiled);
    const decoded = getTransactionDecoder().decode(Uint8Array.from(atob(wire), (c) => c.charCodeAt(0)));
    expect(Array.from(decoded.signatures[address(WALLET)]!)).toEqual(Array.from(fakeSignature));
    cherry.destroy();
  });
});
