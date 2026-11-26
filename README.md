[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/hecongnan/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/hecongnan/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Radar

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols, finds the ones that record no token yet, and ranks the top 200 by the implied value of a launch — with a concrete farm plan for each one. The dashboard is a static page with a sortable, filterable board, a detail view for every protocol, and a separate "Already trading" view for protocols whose token already has a market cap.

## The value model (radar-2)

One function, `impliedValue` in `lib/model.ts`, scores every protocol from the snapshot's own figures — no protocol name is ever special-cased:

```
implied = round( tvl_usd × 0.30 × growth × maturity × breadth × purity )
```

- **Base:** TVL × 0.30 — the size of the activity a token would govern.
- **Growth:** `1 + clamp(change_7d, -50%, +150%) / 100 × 0.60` — a protocol growing +20% in a week scores 1.12×; one shrinking −20% scores 0.88×.
- **Maturity:** `0.70 + 0.30 × √(age_days / 1095)` — how long the protocol has run with no token (days since `listed_at`, 365 when unlisted), with diminishing returns.
- **Breadth:** `1 + 0.02` per extra chain, up to 1.10 — multi-chain protocols have more surface for a token to capture.
- **Purity:** 1.00 for a clean launch candidate, 0.10 for a versioned (V2) pool, 0.05 for a wrapped / staked / bridged product, 0.02 for an exchange-branded name, 0.01 for a CEX. Without this discount the top of the board would be wrapped bitcoin and exchange balances; with it, all 40 watchlist protocols land in the top 200 and the head of the board is genuine launch candidates.

The board is the top 200 pre-token protocols by implied value. Protocols whose token already trades are never ranked — the dashboard shows the 24 largest of them apart, by market cap. Farm plans (7 steps each) are generated per protocol from its category, chains, TVL and age, and every step states what to do, what it costs and how long it takes. The dashboard also recomputes each row's implied value in the page (`impliedOf` in `dashboard/app.js`) and shows whether it matches the board, so the screenshots and the code agree.

## How to run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Requires Node.js 22.18 or later, standard library only, no network. Running it twice writes byte-identical outputs. The output directory holds `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` (built with the vendored `vendor/makefun-board.ts`).

## Owner

- Owner: hecongnan
- Repository: token-radar-01
- Referral: nvqd9sj9
