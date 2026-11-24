# Token Launch Radar

[![Token radar](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/a2263382141-cyber/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/a2263382141-cyber/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

A ranked board of pre-token DeFi protocols, priced by a model fitted on the
market's own multiples — an entry for the
[Token launch radar bounty](https://make.fun/bounty/token-radar-01) on make.fun
($1,325 total, $1,000 first place, closes 2026-12-14 18:00 CST).

## What it does

The sealed DefiLlama snapshot (2026-11-14, 758 protocols, watchlist of 40)
records, for each protocol, its TVL, its 7-day change, its age, and — when one
exists — its token's market cap. The model, **radar-3**, fits
ln(market cap / TVL) on the protocols whose token already trades, then prices
the pre-token protocols with the same fit:

- **Ridge regression** (λ = 1.0 on the slopes) on five features: log TVL size,
  7-day growth, age, a fee-bearing category flag, and a category peer premium
  (the median ln(mcap/TVL) of live-token protocols in the same category).
- **Validation on data the fit never saw**: 5-fold hold-out cross-validation
  plus a walk-forward split by listing date. The numbers are printed by the
  program and shown on the dashboard's Model tab.
- **Ranking by composite predicted implied value**, descending, over the whole
  watchlist (all 40) plus the 138 strongest pre-token protocols below the
  $50M floor — 178 rows in all. (Only 138 rankable pre-token protocols sit
  below the floor; 60 more sit above it and outside the watchlist.)
- **Launch odds** per category, from the snapshot's own record: the share of
  protocols in that category that already have a token.
- **Farm verdicts** (farm / thin / skip), netted to the dollar: implied value ×
  odds × 2% (the stated farmer share) minus capital plus $25 of gas. Farm
  means the net clears $100,000, thin means it clears $25,000, otherwise skip.
  Every row carries a six-step farm plan with costs and times.

Wrapped, staked and bridged products of tokens that already trade are excluded,
as are exchanges and version-marked pools. A protocol counts as "pre-token"
only when the snapshot records no market cap, no CoinGecko id and no symbol
for it.

## Honest limits

The snapshot carries no revenue or fee figures, so fee-capture ability is
proxied by a category flag (Dexs, Lending, Perpetuals, Yield and similar), and
it carries no historical watchlist or attention series, so the "attention
premium" is the category peer multiple. Both proxies are stated on the
dashboard's Model tab. Implied values are fitted estimates, not prices, and no
token named here is guaranteed to launch.

## Run it

```sh
# Node 22.18+ is required (type stripping, no build step).
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to the sealed snapshot>
```

The program writes `out/board.json` (178 rows), `out/data.js` (the dashboard's
dataset), copies `dashboard/` and `screenshots/` into `out/`, and writes
`out/dossier.json` with the vendored make.fun library. It refuses to write a
board the gate would refuse (watchlist coverage, ranks 1..178, implied values
non-increasing, 3–12 farm steps per row, each 20–600 characters).

## Files

- `main.ts` — the pipeline: parse the snapshot, fit, validate, build the board,
  gate-check, write the outputs.
- `lib/model.ts` — the model: ridge fit, features, validation, board builder,
  farm-step generator, gate check. No dependencies beyond the Node standard
  library.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied from the kit
  (the scorer runs this same file, byte for byte).
- `dashboard/` — a static page (no framework, no network): the board with
  sorting and filters, a live-token view, a model tab with validation numbers
  and a coefficient sandbox, and a detail drawer per protocol.
- `screenshots/` — the three 1280×800 views the dossier covers: the board, a
  detail view, a filtered view.
- `.github/workflows/ci.yml` — CI: syntax-checks the program, fetches the kit,
  runs it against the sealed snapshot, and verifies the board has at least 100 rows.

## License

MIT.
