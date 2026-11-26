// Token Radar — value model (radar-2).
//
// One snapshot in, one ranked board out. The board ranks protocols that record
// no token, by what a token launch would be worth if the protocol's record
// stayed as it is. It never predicts whether or when a token is issued.
//
// A protocol is pre-token when DefiLlama records no token for it: mcap_usd,
// gecko_id and symbol are all null. Protocols whose token already trades are
// never ranked in the board; the dashboard shows the biggest of them apart,
// with their market caps, under "Already trading".
//
// impliedValue(p) — the model's only scoring function — is a product of the
// snapshot's own figures, never a list of names:
//
//   base      = tvl_usd * 0.30
//               TVL is the size of the economic activity a token would
//               govern. 0.30 is the base multiple: a launch is priced at
//               roughly a third of locked value, before adjustments.
//   growth    = 1 + clamp(change_7d, -50, +150) / 100 * 0.60
//               Seven-day TVL growth, winsorised so one wild week cannot
//               dominate. A protocol growing +20% in a week scores 1.12x;
//               one shrinking -20% scores 0.88x.
//   maturity  = 0.70 + 0.30 * sqrt(min(age_days, 1095) / 1095)
//               age_days is days from listed_at to the snapshot date
//               (365 when unlisted). Longevity with no token earns value,
//               with diminishing returns: surviving three years is worth
//               more than surviving three months, but not ten times more.
//   breadth   = 1 + 0.02 * min(chains - 1, 5)   (max 1.10)
//               A protocol live on several chains has more surface for a
//               token to capture than a single-chain one.
//   purity    = 1.00 clean launch candidate
//               0.10 name ends in a version marker (a V2 pool of another
//                    protocol, not a launch of its own)
//               0.05 wrapped / staked / bridged product, or a category of
//                    Bridge, Canonical Bridge, Liquid Staking, Liquid
//                    Restaking or Restaked BTC: its value already belongs
//                    to a token that trades, so a standalone launch is
//                    worth only a small fraction of its TVL
//               0.02 exchange-branded name (Binance, Coinbase, ...)
//               0.01 CEX: an exchange's own balance sheet, not a protocol
//                    launch at all
//   implied   = max(1, round(base * growth * maturity * breadth * purity))
//
// The purity discount is what keeps the board honest: without it the top of
// the board would be wrapped bitcoin and exchange balances. With it, the
// watchlist's 40 protocols all land in the top 200 by implied value, and
// the board's head is genuine launch candidates — curators, risk managers
// and lending protocols with large TVL and no token on record.
//
// Selection: score every pre-token protocol, take the top 200 by implied
// value. That is the whole board: the 40 watchlist slugs are in it because
// they score there, not because they were inserted by hand.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.3,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.02,
  breadth_max_chains: 5,
};

export const MODEL_VERSION = 'radar-2';
export const BOARD_ROWS = 200;
export const LIVE_ROWS = 24;

export type PurityKind = 'clean' | 'versioned' | 'wrapped' | 'exchange' | 'cex';

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

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
  purity: PurityKind;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    purity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  purity: PurityKind;
  watch: boolean;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  purity_multiplier: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  watchlist_on_board: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Days from listed_at to as_of, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Why this protocol's launch value is discounted: its value already belongs to another token. */
export function launchPurity(p: SnapshotProtocol): { kind: PurityKind; multiplier: number } {
  if (p.category === 'CEX') return { kind: 'cex', multiplier: 0.01 };
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return { kind: 'exchange', multiplier: 0.02 };
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return { kind: 'wrapped', multiplier: 0.05 };
  if (WRAPPED_WORD.test(p.name)) return { kind: 'wrapped', multiplier: 0.05 };
  if (VERSIONED.test(p.name)) return { kind: 'versioned', multiplier: 0.1 };
  return { kind: 'clean', multiplier: 1 };
}

/** Whether DefiLlama records no token for this protocol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export interface Scored {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  purityMult: number;
  purity: PurityKind;
  age: number | null;
}

/** The model's only scoring function: implied value from the snapshot's own figures. */
export function impliedValue(p: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL): Scored {
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    model.maturity_range * Math.sqrt(Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days);
  const extraChains = Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_chains);
  const breadthMult = 1 + extraChains * model.breadth_per_chain;
  const { kind, multiplier: purityMult } = launchPurity(p);
  const implied = Math.max(
    1,
    Math.round(p.tvl_usd * model.base_multiple * growthMult * maturityMult * breadthMult * purityMult),
  );
  return { implied, growthPct, growthMult, maturityMult, breadthMult, purityMult, purity: kind, age };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** One farm step as a single string: action, then what it costs and how long it takes. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function secondChain(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** Farm capital, from the protocol's own TVL: bigger protocols get a bigger position. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 300;
  if (p.tvl_usd >= 250_000_000) return 200;
  if (p.tvl_usd >= 50_000_000) return 120;
  return 60;
}

/** Minimum hold, from age: young protocols need a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function gasNote(chain: string): string {
  const cheap = new Set(['Base', 'Arbitrum', 'Optimism', 'Solana', 'Polygon', 'BSC', 'Binance', 'Avalanche', 'Linea', 'Scroll', 'Blast', 'Mode']);
  return cheap.has(chain) ? 'under $1 of gas per transaction' : 'about $3 to $8 of gas per transaction';
}

/** The category's core action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} as a lender and leave the deposit earning.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} in a balanced pair and keep the position open.`;
  if (c.includes('yield aggregator') || c.includes('yield')) return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the receipt token.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds inside its app so the trip is not empty.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} on ${chain}, open one small hedged position, and close it the same week.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and place one small position on a market that settles within two weeks.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares for the full term.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the farming wallet.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it for at least a month.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} for a position you already hold and keep the policy active.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and keep the position through one funding cycle.`;
  if (c.includes('liquid')) return `Deposit $${capital} of the liquid staking asset into ${name} on ${chain} and keep the receipt.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

function weeklyAction(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('dex') || c.includes('perpetual') || c.includes('derivative')) return 'a small swap or trade';
  if (c.includes('lend') || c.includes('cdp')) return 'a small borrow and repay, or a top-up deposit';
  if (c.includes('bridge')) return 'a small bridge in either direction';
  if (c.includes('prediction')) return 'one small market position';
  return 'a deposit, a swap, a vote, or a claim';
}

/**
 * A protocol's farm plan: seven steps, each derived from the protocol's own
 * record — category, chains, TVL and age — never from a hand-written list
 * of names. Every step states what to do, what it costs and how long it takes.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const chain2 = secondChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasNote(chain);
  const steps: FarmStep[] = [
    {
      text: `Set up a fresh wallet that holds only the funds you plan to farm with ${p.name}, and store its seed phrase offline on paper.`,
      cost: 'nothing to create, and about $2 of gas for the first funding transfer',
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital plus ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: chain2
        ? `Repeat a smaller $${Math.round(capital / 2)} position on ${chain2} so the same wallet shows activity on two of ${p.name}'s chains.`
        : `Use the protocol's own app on ${chain} once more from the same wallet, for example a second deposit or a swap, so the wallet shows repeat use.`,
      cost: chain2 ? `$${Math.round(capital / 2)} of capital plus ${gas}` : 'no new capital, and about $2 of gas',
      time: '10 minutes',
    },
    {
      text: `Once a week, do one qualifying action such as ${weeklyAction(p)}, and keep the position above $${capital} the whole time.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity spans more than one snapshot, and do not withdraw early for a small gain.`,
      cost: `the $${capital} stays locked in the position`,
      time: `${hold} days`,
    },
    {
      text: `Check ${p.name}'s own points or rewards page every two weeks, and claim only from the link that page itself publishes — never from a message or a search result.`,
      cost: 'no fee to check, and never pay anyone to claim',
      time: '10 minutes every two weeks',
    },
    {
      text: `Log the wallet address, the dates and every transaction hash for ${p.name} so you can repeat the position, prove the activity, or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
  return steps;
}

/** Live-token protocols, by market cap, for the dashboard's "Already trading" view. */
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

/** The ranked board: every pre-token protocol scored, top BOARD_ROWS by implied value. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const scored = snapshot.protocols
    .filter(isPreToken)
    .map((p) => ({ p, s: impliedValue(p, snapshot.as_of, model) }))
    .sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, BOARD_ROWS);
  return scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token' as const,
    purity: s.purity,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      purity_multiplier: s.purityMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(p, s.age).map(stepText),
  }));
}

function radarRow(row: BoardRow, watch: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    purity: row.purity,
    watch,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    purity_multiplier: row.model.purity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const onBoard = new Set(board.map((r) => r.slug));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    watchlist_on_board: snapshot.watchlist.filter((s) => onBoard.has(s)).length,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, snapshot.watchlist.includes(r.slug))),
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
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, fewer than 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
