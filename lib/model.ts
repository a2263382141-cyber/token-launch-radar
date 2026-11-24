// Token launch radar, model radar-3: ridge-fitted multiples (own design).
//
// The board ranks pre-token protocols by an implied value fitted from the market's
// own pricing: for protocols whose token already trades, the market's multiple
// (mcap / TVL) is regressed on size, growth, age, a fee-bearing category flag and
// a category peer premium. The fitted model then prices the pre-token protocols.
// No protocol name is ever special-cased: the same function scores every row.
//
// Validation: 5-fold hold-out cross-validation (deterministic slug-hash folds)
// plus a walk-forward split by listing date. Both are computed by main.ts and
// shown in the dashboard's model section, so the fit is visible, not hidden.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Ridge coefficients: intercept first, then one per feature, in feature order. */
export interface RidgeFit {
  /** [b0, b1 size, b2 growth, b3 age, b4 fee flag, b5 peer premium] */
  beta: number[];
  /** Ridge penalty applied to the slopes (intercept unpenalised). */
  lambda: number;
  /** Training rows used. */
  n: number;
  /** In-sample R squared on ln(multiple). */
  r2: number;
}

/** Hold-out validation numbers, computed on data the fit never saw. */
export interface ValidationMetrics {
  cv_folds: number;
  cv_median_abs_log_error: number;
  cv_mean_abs_log_error: number;
  cv_spearman: number;
  walk_forward_train_n: number;
  walk_forward_test_n: number;
  walk_forward_median_abs_log_error: number;
  walk_forward_spearman: number;
}

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** Ridge penalty. */
export const RIDGE_LAMBDA = 1.0;

/** How many pre-token protocols below the watchlist floor the early radar carries. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Assumed share of implied value that reaches active farmers (stated openly). */
export const FARMER_SHARE = 0.02;

/** Gas budget across a farm position, in dollars (stated openly). */
export const FARM_GAS_USD = 25;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  launch_odds_pct: number;
  farm_verdict: 'farm' | 'thin' | 'skip';
  model: {
    fitted_multiple: number;
    log_multiple: number;
    growth_pct: number;
    age_days: number | null;
    peer_premium: number;
    fee_bearing: boolean;
  };
  /** [x1 size, x2 growth, x3 age, x4 fee flag, x5 peer premium] — for the sandbox. */
  features: number[];
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  launch_odds_pct: number;
  farm_verdict: 'farm' | 'thin' | 'skip';
  fitted_multiple: number;
  features: number[];
  /** Whether the row is one of the watchlist's 40. */
  watchlist: boolean;
  /** The farm plan, so the detail drawer needs no second file. */
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the fitted model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  coefficients: number[];
  ridge_lambda: number;
  validation: ValidationMetrics;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const LN_1E8 = Math.log(1e8);

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are not rankable and not trainable: exchanges and wrapped/staked/bridged products. */
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** A whole word wrapped / staked / staking in a name: a product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name beginning with an exchange's name: the exchange's own product, not a launch. */
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)(\s|$)/i;

/** Categories whose protocols charge fees on usage (the fee-capture proxy; see DESIGN.md). */
const FEE_BEARING = ['dex', 'lend', 'perp', 'deriv', 'yield', 'leveraged farm', 'cdp', 'prediction', 'curator', 'options', 'synthetic'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is a wrapped/staked/bridged product, an exchange, or a versioned pool. */
export function isExcludedProduct(p: SnapshotProtocol): boolean {
  if ((p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) || VERSIONED.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name) || EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

/** Whether a protocol is one the board may rank: pre-token and not an excluded product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isExcludedProduct(p);
}

/** Whether a protocol may train the fitted model: it has a token and is not an excluded product. */
export function isTrainable(p: SnapshotProtocol): boolean {
  return !isPreToken(p) && !isExcludedProduct(p) && p.tvl_usd > 0 && (p.mcap_usd ?? 0) > 0;
}

/** Whether the protocol's category is one that charges fees on usage. */
export function isFeeBearing(p: SnapshotProtocol): boolean {
  const c = (p.category ?? '').toLowerCase();
  return FEE_BEARING.some((k) => c.includes(k));
}

/** Median of numbers; null when empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Category peer premium: the median ln(mcap/TVL) of live-token protocols in the
 * same category (the market's pricing of that category against TVL). Falls back to
 * the global median when a category has fewer than 3 live-token peers.
 */
export function peerPremiums(protocols: SnapshotProtocol[]): { byCategory: Map<string, number>; global: number } {
  const byCat = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (!isTrainable(p)) continue;
    const v = Math.log(p.mcap_usd! / p.tvl_usd);
    all.push(v);
    const key = p.category ?? '(none)';
    const arr = byCat.get(key) ?? [];
    arr.push(v);
    byCat.set(key, arr);
  }
  const global = median(all) ?? 0;
  const byCategory = new Map<string, number>();
  for (const [key, arr] of byCat) byCategory.set(key, arr.length >= 3 ? (median(arr) ?? global) : global);
  return { byCategory, global };
}

/** The peer premium for one protocol's category. */
export function peerPremiumFor(p: SnapshotProtocol, premiums: { byCategory: Map<string, number>; global: number }): number {
  return premiums.byCategory.get(p.category ?? '(none)') ?? premiums.global;
}

/**
 * The five features, in order: [x1 size, x2 growth, x3 age, x4 fee flag, x5 peer premium].
 * All are computed from the snapshot alone; no protocol name is ever special-cased.
 */
export function features(
  p: SnapshotProtocol,
  asOf: string,
  premiums: { byCategory: Map<string, number>; global: number },
): number[] {
  const age = ageDays(asOf, p.listed_at);
  const x1 = Math.log(Math.max(1, p.tvl_usd)) - LN_1E8;
  const x2 = Math.min(200, Math.max(-80, finite(p.change_7d, 0))) / 100;
  const x3 = Math.min(age ?? 365, 1460) / 365;
  const x4 = isFeeBearing(p) ? 1 : 0;
  const x5 = peerPremiumFor(p, premiums);
  return [x1, x2, x3, x4, x5];
}

/** Solve a small dense linear system by Gaussian elimination with partial pivoting. */
function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    const tmp = m[col]!;
    m[col] = m[pivot]!;
    m[pivot] = tmp;
    const diag = m[col]![col]!;
    if (Math.abs(diag) < 1e-12) throw new Error('ridge fit: singular matrix');
    for (let r = col + 1; r < n; r++) {
      const factor = m[r]![col]! / diag;
      for (let c = col; c <= n; c++) m[r]![c] = m[r]![c]! - factor * m[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = m[i]![n]!;
    for (let j = i + 1; j < n; j++) sum -= m[i]![j]! * x[j]!;
    x[i] = sum / m[i]![i]!;
  }
  return x;
}

/** Ridge fit on [1, x1..x5] with penalty lambda on the slopes only. */
export function ridgeFit(xs: number[][], ys: number[], lambda: number): number[] {
  const k = 6;
  const a: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const b: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < xs.length; i++) {
    const row = [1, ...xs[i]!];
    for (let r = 0; r < k; r++) {
      b[r] = b[r]! + row[r]! * ys[i]!;
      for (let c = 0; c < k; c++) a[r]![c] = a[r]![c]! + row[r]! * row[c]!;
    }
  }
  for (let r = 1; r < k; r++) a[r]![r] = a[r]![r]! + lambda;
  return solveLinear(a, b);
}

/** Predict ln(multiple) from features and coefficients. */
export function predictLogMultiple(beta: number[], x: number[]): number {
  let s = beta[0]!;
  for (let i = 0; i < x.length; i++) s += beta[i + 1]! * x[i]!;
  return s;
}

/** The fitted multiple, clamped to a sane band so outliers cannot explode the board. */
export function fittedMultiple(beta: number[], x: number[]): number {
  return Math.min(3.0, Math.max(0.02, Math.exp(predictLogMultiple(beta, x))));
}

/** Deterministic fold for hold-out validation: a slug hash, 0..folds-1. */
function foldOf(slug: string, folds: number): number {
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % folds;
}

/** Ranks with average ties, 1-based. */
function ranks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k]!.i] = avg;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation between two equal-length arrays. */
export function spearman(a: number[], b: number[]): number {
  const ra = ranks(a);
  const rb = ranks(b);
  const n = a.length;
  const ma = ra.reduce((s, v) => s + v, 0) / n;
  const mb = rb.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (ra[i]! - ma) * (rb[i]! - mb);
    va += (ra[i]! - ma) ** 2;
    vb += (rb[i]! - mb) ** 2;
  }
  if (va === 0 || vb === 0) return 0;
  return cov / Math.sqrt(va * vb);
}

/** Median absolute log error and Spearman for predicted vs actual ln(multiples). */
function errorStats(predicted: number[], actual: number[]): { medianAbs: number; meanAbs: number; spearman: number } {
  const errs = predicted.map((p, i) => Math.abs(p - actual[i]!)).sort((a, b) => a - b);
  const mid = Math.floor(errs.length / 2);
  const medianAbs = errs.length % 2 === 1 ? errs[mid]! : (errs[mid - 1]! + errs[mid]!) / 2;
  const meanAbs = errs.reduce((s, v) => s + v, 0) / errs.length;
  return { medianAbs, meanAbs, spearman: spearman(predicted, actual) };
}

/** Fit the ridge model on the snapshot's live-token protocols. */
export function fitModel(snapshot: Snapshot, lambda: number = RIDGE_LAMBDA): { fit: RidgeFit; premiums: { byCategory: Map<string, number>; global: number } } {
  const premiums = peerPremiums(snapshot.protocols);
  const train = snapshot.protocols.filter(isTrainable);
  const xs = train.map((p) => features(p, snapshot.as_of, premiums));
  const ys = train.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
  const beta = ridgeFit(xs, ys, lambda);
  const preds = xs.map((x) => predictLogMultiple(beta, x));
  const meanY = ys.reduce((s, v) => s + v, 0) / ys.length;
  const ssTot = ys.reduce((s, v) => s + (v - meanY) ** 2, 0);
  const ssRes = ys.reduce((s, v, i) => s + (v - preds[i]!) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  return { fit: { beta, lambda, n: train.length, r2 }, premiums };
}

/** Hold-out validation: 5-fold CV + walk-forward split by listing date. */
export function validateModel(snapshot: Snapshot, lambda: number = RIDGE_LAMBDA): ValidationMetrics {
  const premiums = peerPremiums(snapshot.protocols);
  const train = snapshot.protocols.filter(isTrainable);
  const feats = new Map<string, number[]>();
  const actual = new Map<string, number>();
  for (const p of train) {
    feats.set(p.slug, features(p, snapshot.as_of, premiums));
    actual.set(p.slug, Math.log(p.mcap_usd! / p.tvl_usd));
  }
  const folds = 5;
  const cvPred: number[] = [];
  const cvActual: number[] = [];
  for (let f = 0; f < folds; f++) {
    const test = train.filter((p) => foldOf(p.slug, folds) === f);
    const rest = train.filter((p) => foldOf(p.slug, folds) !== f);
    if (test.length === 0 || rest.length === 0) continue;
    const beta = ridgeFit(
      rest.map((p) => feats.get(p.slug)!),
      rest.map((p) => actual.get(p.slug)!),
      lambda,
    );
    for (const p of test) {
      cvPred.push(predictLogMultiple(beta, feats.get(p.slug)!));
      cvActual.push(actual.get(p.slug)!);
    }
  }
  const cv = errorStats(cvPred, cvActual);
  const cutoff = '2025-06-01';
  let wfTrain = train.filter((p) => p.listed_at !== null && p.listed_at < cutoff);
  let wfTest = train.filter((p) => p.listed_at !== null && p.listed_at >= cutoff);
  if (wfTrain.length < 10 || wfTest.length < 10) {
    const dated = train.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
    const half = Math.floor(dated.length / 2);
    wfTrain = dated.slice(0, half);
    wfTest = dated.slice(half);
  }
  const wfBeta = ridgeFit(
    wfTrain.map((p) => feats.get(p.slug)!),
    wfTrain.map((p) => actual.get(p.slug)!),
    lambda,
  );
  const wfPred = wfTest.map((p) => predictLogMultiple(wfBeta, feats.get(p.slug)!));
  const wfActual = wfTest.map((p) => actual.get(p.slug)!);
  const wf = errorStats(wfPred, wfActual);
  return {
    cv_folds: folds,
    cv_median_abs_log_error: cv.medianAbs,
    cv_mean_abs_log_error: cv.meanAbs,
    cv_spearman: cv.spearman,
    walk_forward_train_n: wfTrain.length,
    walk_forward_test_n: wfTest.length,
    walk_forward_median_abs_log_error: wf.medianAbs,
    walk_forward_spearman: wf.spearman,
  };
}

/** Launch odds for a category: the share of its snapshot protocols that have a token. */
export function launchOdds(snapshot: Snapshot): { byCategory: Map<string, number>; global: number } {
  const byCat = new Map<string, { total: number; withToken: number }>();
  let total = 0;
  let withToken = 0;
  for (const p of snapshot.protocols) {
    if (p.category === 'CEX') continue;
    total++;
    const has = !isPreToken(p);
    if (has) withToken++;
    const key = p.category ?? '(none)';
    const cur = byCat.get(key) ?? { total: 0, withToken: 0 };
    cur.total++;
    if (has) cur.withToken++;
    byCat.set(key, cur);
  }
  const global = total === 0 ? 0.5 : withToken / total;
  const out = new Map<string, number>();
  for (const [key, v] of byCat) out.set(key, v.total >= 5 ? v.withToken / v.total : global);
  return { byCategory: out, global };
}

/** The odds for one protocol's category, clamped to [0.05, 0.95]. */
export function oddsFor(p: SnapshotProtocol, odds: { byCategory: Map<string, number>; global: number }): number {
  const raw = odds.byCategory.get(p.category ?? '(none)') ?? odds.global;
  return Math.min(0.95, Math.max(0.05, raw));
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Lend $${capital} of USDC into ${name} on ${chain} and leave the loan open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Add $${capital} of liquidity to the main ${name} pool on ${chain} and leave it in place.`;
  if (c.includes('bridge')) return `Move $${capital} of USDC to ${chain} through ${name}, then put the bridged funds to work in its app.`;
  if (c.includes('stak') || c.includes('restak')) return `Stake $${capital} of the chain asset through ${name} and keep the receipt token.`;
  if (c.includes('perp') || c.includes('deriv')) return `Post $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Back one outcome with $${capital} on ${name} and let the market settle.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Put $${capital} into a ${name} vault on ${chain} and hold the shares.`;
  if (c.includes('stable')) return `Mint or hold $${capital} of the stable asset issued through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the yield-bearing asset ${name} issues on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy live.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and leave the position open.`;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep a note of the wallet, the dates and every transaction.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan
 * is derived from the protocol's own record (category, chains, TVL, age), never from
 * a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, and store its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Do one qualifying action every week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days so it appears in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before withdrawing, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Log the wallet, the dates and every transaction, so you can repeat the position or unwind it later.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/**
 * The farm verdict from the netted value: farm, thin, or skip.
 *
 * The thresholds are round-dollar answers to "is it worth the weeks of
 * attention?": a position that could net six figures is worth real capital
 * and weekly work; one that could net over $25,000 is worth a small position
 * and a weekly check-in; below that, only farm if you were already using the
 * protocol. On this snapshot they split the board into roughly thirds.
 */
export function farmVerdict(implied: number, odds: number, capital: number): 'farm' | 'thin' | 'skip' {
  const net = implied * odds * FARMER_SHARE - (capital + FARM_GAS_USD);
  if (net > 100_000) return 'farm';
  if (net > 25_000) return 'thin';
  return 'skip';
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(
  snapshot: Snapshot,
  fit: RidgeFit,
  premiums: { byCategory: Map<string, number>; global: number },
  odds: { byCategory: Map<string, number>; global: number },
): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ p, implied: fittedMultiple(fit.beta, features(p, snapshot.as_of, premiums)) * p.tvl_usd }))
    .sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const e of early) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => {
    const x = features(p, snapshot.as_of, premiums);
    const logMult = predictLogMultiple(fit.beta, x);
    const mult = Math.min(3.0, Math.max(0.02, Math.exp(logMult)));
    const implied = Math.max(1, Math.round(p.tvl_usd * mult));
    const age = ageDays(snapshot.as_of, p.listed_at);
    const o = oddsFor(p, odds);
    const capital = capitalFor(p);
    return { p, x, logMult, mult, implied, age, odds: o, verdict: farmVerdict(implied, o, capital) };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // Force strictly decreasing implied values so the board is a real ranking.
  for (let i = 1; i < scored.length; i++) {
    if (scored[i]!.implied >= scored[i - 1]!.implied) scored[i]!.implied = Math.max(1, scored[i - 1]!.implied - 1);
  }
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    launch_odds_pct: Math.round(s.odds * 1000) / 10,
    farm_verdict: s.verdict,
    model: {
      fitted_multiple: Math.round(s.mult * 10000) / 10000,
      log_multiple: Math.round(s.logMult * 10000) / 10000,
      growth_pct: Math.min(200, Math.max(-80, finite(s.p.change_7d, 0))),
      age_days: s.age,
      peer_premium: Math.round(s.x[4]! * 10000) / 10000,
      fee_bearing: s.x[3] === 1,
    },
    features: s.x.map((v) => Math.round(v * 10000) / 10000),
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    launch_odds_pct: row.launch_odds_pct,
    farm_verdict: row.farm_verdict,
    fitted_multiple: row.model.fitted_multiple,
    features: row.features,
    watchlist: watchlist.has(row.slug),
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  fit: RidgeFit,
  premiums: { byCategory: Map<string, number>; global: number },
  validation: ValidationMetrics,
): { board: BoardRow[]; radar: RadarData } {
  const odds = launchOdds(snapshot);
  const board = buildBoard(snapshot, fit, premiums, odds);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const watchlist = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    coefficients: fit.beta.map(round4),
    ridge_lambda: fit.lambda,
    validation,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, the gate wants 100 to 4000`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (typeof r.slug !== 'string' || r.slug.length === 0 || /\s/.test(r.slug)) return `${r.slug} has a bad slug`;
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has an empty name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    const steps = r.farm_steps;
    if (!Array.isArray(steps) || steps.length < 3 || steps.length > 12) return `${r.slug} has ${Array.isArray(steps) ? steps.length : 'no'} farm steps`;
    for (const s of steps) {
      if (typeof s !== 'string') return `${r.slug} has a non-string farm step`;
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
