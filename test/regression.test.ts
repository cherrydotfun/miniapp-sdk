/**
 * A11: an old host must see exactly the 0.1.21 behaviour.
 *
 * The fixture was recorded by running these scenarios against the unmodified
 * 0.1.21 sources. It is never rewritten implicitly: a missing fixture fails,
 * and re-recording needs `CHERRY_RECORD_FIXTURES=1` — do that only for an
 * intentional, reviewed behaviour change.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { scenarios } from './regression.scenarios';
import { uninstallHost } from './harness';

const FIXTURE = join(import.meta.dir, 'fixtures', 'regression-0.1.21.json');
const RECORD = process.env['CHERRY_RECORD_FIXTURES'] === '1';

const recorded: Record<string, unknown> = {};
const fixture: Record<string, unknown> | null = existsSync(FIXTURE)
  ? (JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>)
  : null;

afterEach(() => uninstallHost());

describe('regression (A11): old host behaves exactly as with 0.1.21', () => {
  for (const [name, run] of Object.entries(scenarios)) {
    test(name, async () => {
      const transcript = JSON.parse(JSON.stringify(await run())) as unknown;
      if (RECORD) {
        recorded[name] = transcript;
        return;
      }
      expect(fixture, `missing ${FIXTURE}; record it from the 0.1.21 sources`).not.toBeNull();
      expect(fixture).toHaveProperty([name]);
      expect(transcript).toStrictEqual(fixture![name]);
    });
  }

  if (RECORD) {
    test('write fixture', () => {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(recorded, null, 2)}\n`);
    });
  }
});
