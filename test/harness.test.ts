import { describe, expect, it } from 'vitest';
import { BRIDGE_VERSION } from '../src/types';

describe('test harness', () => {
  it('loads the SDK sources', () => {
    expect(BRIDGE_VERSION).toBe(2);
  });
});
