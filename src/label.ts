/**
 * Transaction labels: one short line, in the app's own words, that Cherry
 * shows in its wallet sheet under the app's name — "Buy 3 lives",
 * "Enter the weekly tournament". The amount, the fee and the recipient are
 * still decoded by Cherry from the transaction itself; a label explains, it
 * never states a number Cherry would show instead of the real one.
 *
 * Two ways to attach one, and they are the same thing on the wire (`label`
 * beside `transaction` in the `wallet.*` request):
 *
 * - explicitly, on the SDK's own wallet facade:
 *   `cherry.wallet.signAndSendTransaction(tx, { label: 'Buy 3 lives' })`;
 * - around any code that signs through a standard interface (wallet-adapter's
 *   `sendTransaction`, a @solana/kit signer), where no extra argument fits:
 *   `await withTransactionLabel('Buy 3 lives', () => sendTransaction(tx, connection))`.
 *
 * An explicit label wins over a surrounding one. A host that predates labels
 * ignores the field, so sending one is always safe.
 */

/** The longest label a host shows; longer ones are cut with an ellipsis. */
export const TRANSACTION_LABEL_MAX = 80;

/** The bridge methods a label may ride on. */
export const LABELLED_METHODS: ReadonlySet<string> = new Set([
  'wallet.signTransaction',
  'wallet.signTransactions',
  'wallet.signAndSendTransaction',
]);

/** Per-call options of the SDK's wallet facade. */
export interface CherryTransactionOptions {
  /**
   * What this transaction does, in a few words: "Buy 3 lives", "Swap 1 SOL
   * to USDC". Shown in Cherry's wallet sheet under the app's name. Plain
   * text, one line, at most {@link TRANSACTION_LABEL_MAX} characters.
   */
  label?: string;
}

// Control and format characters (line breaks, bidi marks and overrides,
// zero-width joiners, tag characters) could draw a fake second line or
// reorder or hide what the label says; Hangul fillers render as blank; a pile
// of combining marks overflows the line.
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u115F\u1160\u3164\uFFA0]/gu;
const MARK_PILE = /(\p{M}{2})\p{M}+/gu;

/**
 * The label as a host will show it: one line, trimmed, at most
 * {@link TRANSACTION_LABEL_MAX} characters. `undefined` for anything that is
 * not a string or is empty once cleaned.
 */
export function normalizeTransactionLabel(label: unknown): string | undefined {
  if (typeof label !== 'string') return undefined;
  const clean = label.replace(UNPRINTABLE, ' ').replace(MARK_PILE, '$1').replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  const chars = Array.from(clean);
  if (chars.length <= TRANSACTION_LABEL_MAX) return clean;
  return `${chars.slice(0, TRANSACTION_LABEL_MAX - 1).join('').trimEnd()}…`;
}

/**
 * The labels in force, shared through `globalThis`: each package entry (root,
 * /react, /solana, /kit) is bundled with its own copy of this module, and a
 * label set through one entry must reach a signer imported from another.
 */
interface LabelScope {
  active: { id: number; label: string }[];
  lastId: number;
}
const SCOPE_KEY = Symbol.for('cherry.miniapp-sdk.txLabel');
function scope(): LabelScope {
  const g = globalThis as unknown as Record<symbol, LabelScope | undefined>;
  return (g[SCOPE_KEY] ??= { active: [], lastId: 0 });
}

/**
 * Runs `fn` with `label` attached to every signature request it makes, and
 * detaches it however `fn` ends. Nested calls use the innermost label.
 *
 * The label is process-wide while `fn` runs: two unrelated payments started
 * at the same moment would share the inner one's label. Start one payment at
 * a time, or pass the label explicitly to the SDK's wallet facade.
 */
export async function withTransactionLabel<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
  const clean = normalizeTransactionLabel(label);
  if (!clean) return fn();
  const labels = scope();
  const id = ++labels.lastId;
  labels.active.push({ id, label: clean });
  try {
    return await fn();
  } finally {
    const index = labels.active.findIndex((entry) => entry.id === id);
    if (index >= 0) labels.active.splice(index, 1);
  }
}

/** The label a request to `method` should carry right now, if any. */
export function currentTransactionLabel(method: string): string | undefined {
  if (!LABELLED_METHODS.has(method)) return undefined;
  const { active } = scope();
  return active[active.length - 1]?.label;
}

/**
 * `params` with the label it should carry: an explicit (valid) one is kept,
 * an invalid one is dropped, and none falls back to the surrounding
 * {@link withTransactionLabel}. Every other method's params are untouched.
 */
export function attachTransactionLabel(
  method: string,
  params: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!LABELLED_METHODS.has(method)) return params;
  const explicit = params && 'label' in params ? normalizeTransactionLabel(params['label']) : undefined;
  const label = explicit ?? currentTransactionLabel(method);
  if (!params) return label ? { label } : params;
  const { label: _dropped, ...rest } = params;
  return label ? { ...rest, label } : rest;
}
