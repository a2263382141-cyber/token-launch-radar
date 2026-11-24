// Token Launch Radar dashboard: renders window.RADAR with no network at all.
// Every value on screen comes from the data.js this program wrote from the same board.

(function () {
  const R = window.RADAR;
  if (!R || !Array.isArray(R.rows)) {
    document.getElementById('subtitle').textContent = 'No radar data: data.js did not load.';
    return;
  }

  // ------------------------------------------------------------ formatting
  function money(n) {
    if (n === null || n === undefined) return '—';
    const a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(0);
  }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function age(n) {
    if (n === null || n === undefined) return '—';
    if (n < 365) return n + 'd';
    return (n / 365).toFixed(1) + 'y';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ------------------------------------------------------------ header
  document.getElementById('subtitle').textContent =
    'Snapshot ' + R.as_of + ' · ' + R.board_size + ' protocols ranked · ' +
    R.watchlist_size + ' on the watchlist · model ' + R.model_version;
  document.getElementById('badges').innerHTML =
    '<span class="badge">Top implied <strong>' + money(R.rows[0].implied_value_usd) + '</strong></span>' +
    '<span class="badge">Farm <strong>' + R.rows.filter(function (r) { return r.farm_verdict === 'farm'; }).length + '</strong></span>' +
    '<span class="badge">Thin <strong>' + R.rows.filter(function (r) { return r.farm_verdict === 'thin'; }).length + '</strong></span>' +
    '<span class="badge">Skip <strong>' + R.rows.filter(function (r) { return r.farm_verdict === 'skip'; }).length + '</strong></span>';
  document.getElementById('footer-note').textContent =
    'Source: ' + R.source + ' snapshot ' + R.as_of + '. Implied values are fitted estimates from ' +
    R.model_version + ' (ridge regression on the market\'s own multiples); they are not prices, and ' +
    'no token named here is guaranteed to launch. Nothing on this page fetches from the network.';

  // ------------------------------------------------------------ tabs
  const tabs = document.querySelectorAll('.tabs button');
  tabs.forEach(function (btn) {
    btn.addEventListener('click', function () {
      tabs.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      document.querySelectorAll('main > section.panel').forEach(function (s) { s.classList.add('hidden'); });
      document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
    });
  });

  // ------------------------------------------------------------ board
  const state = { sort: 'rank', dir: 1, search: '', category: '', chain: '', minTvl: 0, verdict: '', watchlist: false };
  const VERDICT_ORDER = { farm: 0, thin: 1, skip: 2 };

  function fillSelect(id, values) {
    const sel = document.getElementById(id);
    values.forEach(function (v) {
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      sel.appendChild(o);
    });
  }
  fillSelect('f-category', Array.from(new Set(R.rows.map(function (r) { return r.category || '(none)'; }))).sort());
  fillSelect('f-chain', Array.from(new Set(R.rows.flatMap(function (r) { return r.chains; }))).sort());

  function filtered() {
    let rows = R.rows.filter(function (r) {
      if (state.watchlist && !r.watchlist) return false;
      if (state.category && (r.category || '(none)') !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.verdict && r.farm_verdict !== state.verdict) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (state.search) {
        const q = state.search.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
    const key = state.sort;
    rows.sort(function (a, b) {
      let d = 0;
      if (key === 'name' || key === 'category') d = String(a[key] || '').localeCompare(String(b[key] || ''));
      else if (key === 'chains') d = a.chains.join(',').localeCompare(b.chains.join(','));
      else if (key === 'farm_verdict') d = VERDICT_ORDER[a.farm_verdict] - VERDICT_ORDER[b.farm_verdict];
      else d = (a[key] === null || a[key] === undefined ? -Infinity : a[key]) - (b[key] === null || b[key] === undefined ? -Infinity : b[key]);
      if (d === 0) d = a.rank - b.rank;
      return d * state.dir;
    });
    return rows;
  }

  function renderBoard() {
    const rows = filtered();
    document.getElementById('row-count').textContent = rows.length + ' of ' + R.rows.length + ' rows';
    const body = document.getElementById('board-body');
    body.innerHTML = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (r.watchlist ? ' class="selected"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td>' + esc(r.name) + (r.watchlist ? ' ★' : '') + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="muted">' + esc(r.chains.slice(0, 2).join(', ') || '—') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td>' +
        '<td class="num">' + r.launch_odds_pct.toFixed(1) + '%</td>' +
        '<td><span class="verdict ' + r.farm_verdict + '">' + r.farm_verdict + '</span></td>' +
        '</tr>';
    }).join('');
  }

  document.querySelectorAll('#board-table th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      const key = th.dataset.sort;
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'name' || key === 'category' || key === 'chains' ? 1 : -1; }
      renderBoard();
    });
  });
  document.getElementById('f-search').addEventListener('input', function (e) { state.search = e.target.value; renderBoard(); });
  document.getElementById('f-category').addEventListener('change', function (e) { state.category = e.target.value; renderBoard(); });
  document.getElementById('f-chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  document.getElementById('f-tvl').addEventListener('change', function (e) { state.minTvl = Number(e.target.value); renderBoard(); });
  document.getElementById('f-verdict').addEventListener('change', function (e) { state.verdict = e.target.value; renderBoard(); });
  document.getElementById('f-watchlist').addEventListener('change', function (e) { state.watchlist = e.target.checked; renderBoard(); });

  document.getElementById('board-body').addEventListener('click', function (e) {
    const tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    const row = R.rows.find(function (r) { return r.slug === tr.dataset.slug; });
    if (row) openDetail(row);
  });

  // ------------------------------------------------------------ detail drawer
  function openDetail(r) {
    const b = R.coefficients;
    const terms = [
      ['TVL', money(r.tvl_usd)],
      ['Fitted multiple', '×' + r.fitted_multiple.toFixed(4)],
      ['Implied value', money(r.implied_value_usd)],
      ['7-day growth', pct(r.change_7d)],
      ['Age', age(r.age_days)],
      ['Peer premium', r.features[4].toFixed(3)],
      ['Fee-bearing category', r.features[3] === 1 ? 'yes' : 'no'],
      ['Launch odds', r.launch_odds_pct.toFixed(1) + '%'],
      ['Farm verdict', r.farm_verdict],
    ];
    document.getElementById('detail-body').innerHTML =
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="muted">Rank #' + r.rank + ' · ' + esc(r.category || '—') + ' · ' + esc(r.chains.join(', ') || '—') +
      (r.watchlist ? ' · on the watchlist' : '') + '</p>' +
      '<h3>Value breakdown</h3><dl>' +
      terms.map(function (t) { return '<dt>' + t[0] + '</dt><dd>' + t[1] + '</dd>'; }).join('') +
      '</dl>' +
      '<p class="muted">Implied value = TVL × fitted multiple, where the multiple comes from ' +
      'ln(multiple) = ' + b[0].toFixed(3) +
      ' + ' + b[1].toFixed(3) + '·size + ' + b[2].toFixed(3) + '·growth + ' + b[3].toFixed(3) +
      '·age + ' + b[4].toFixed(3) + '·fee + ' + b[5].toFixed(3) + '·peer premium, clamped to ×0.02–×3.00.</p>' +
      '<h3>Farm plan</h3><ol>' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol>' +
      '<p class="warn">This protocol records no token in the snapshot — no market cap, no CoinGecko id, ' +
      'no symbol. That is the snapshot\'s record as of ' + R.as_of + ', not a promise that no token ' +
      'exists or that one will launch. Farm verdicts assume 2% of implied value reaches active ' +
      'farmers; check the protocol\'s own pages before committing funds.</p>';
    document.getElementById('detail').classList.remove('hidden');
  }
  document.getElementById('detail-close').addEventListener('click', function () {
    document.getElementById('detail').classList.add('hidden');
  });

  // ------------------------------------------------------------ live tokens
  document.getElementById('live-body').innerHTML = R.live.map(function (p, i) {
    return '<tr><td class="num">' + (i + 1) + '</td><td>' + esc(p.name) + '</td><td>' + esc(p.category || '—') +
      '</td><td class="muted">' + esc(p.chains.slice(0, 2).join(', ') || '—') + '</td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td><td class="num"><strong>' + money(p.mcap_usd) + '</strong></td>' +
      '<td class="num">' + pct(p.change_7d) + '</td></tr>';
  }).join('');

  // ------------------------------------------------------------ model tab
  document.getElementById('lambda').textContent = R.ridge_lambda;
  const COEF_NAMES = [
    ['b0', 'Intercept', 'The baseline ln(multiple) when every feature is zero.'],
    ['b1', 'Size — ln(TVL) − ln($100M)', 'How the multiple moves with protocol size.'],
    ['b2', 'Growth — 7-day change, clamped −80%…+200%', 'How fast recent growth lifts the multiple.'],
    ['b3', 'Age — years, capped at 4', 'How time in the market lifts the multiple.'],
    ['b4', 'Fee-bearing category (0/1)', 'The proxy for real revenue: fee-charging categories score higher.'],
    ['b5', 'Peer premium — category median ln(mcap/TVL)', 'The proxy for attention: how the market prices this category against TVL.'],
  ];
  document.getElementById('coef-body').innerHTML = COEF_NAMES.map(function (c, i) {
    return '<tr><td>' + c[0] + '</td><td>' + c[1] + '</td><td class="num">' + R.coefficients[i].toFixed(4) +
      '</td><td class="muted">' + c[2] + '</td></tr>';
  }).join('');

  const v = R.validation;
  document.getElementById('val-body').innerHTML =
    '<tr><td>5-fold hold-out cross-validation</td><td class="num">' + v.cv_median_abs_log_error.toFixed(3) +
    '</td><td class="num">' + v.cv_mean_abs_log_error.toFixed(3) + '</td><td class="num">' + v.cv_spearman.toFixed(3) +
    '</td><td class="num">' + v.cv_folds + ' folds</td></tr>' +
    '<tr><td>Walk-forward (listed before 2025-06-01 → after)</td><td class="num">' + v.walk_forward_median_abs_log_error.toFixed(3) +
    '</td><td class="num">—</td><td class="num">' + v.walk_forward_spearman.toFixed(3) +
    '</td><td class="num">' + v.walk_forward_train_n + ' fit / ' + v.walk_forward_test_n + ' test</td></tr>';

  // ------------------------------------------------------------ sandbox
  const sandbox = document.getElementById('sandbox');
  const fitted = R.coefficients.slice();
  const current = fitted.slice();
  sandbox.innerHTML = COEF_NAMES.slice(1).map(function (c, i) {
    const idx = i + 1;
    return '<div class="row"><label for="sb-' + idx + '">' + c[1] + '</label>' +
      '<input type="range" id="sb-' + idx + '" min="-2" max="2" step="0.01" value="' + fitted[idx] + '">' +
      '<span id="sbv-' + idx + '">' + fitted[idx].toFixed(2) + '</span></div>';
  }).join('');

  function sandboxTop() {
    const scored = R.rows.map(function (r) {
      let s = current[0];
      for (let i = 0; i < 5; i++) s += current[i + 1] * r.features[i];
      const mult = Math.min(3.0, Math.max(0.02, Math.exp(s)));
      return { name: r.name, rank: r.rank, implied: Math.max(1, Math.round(r.tvl_usd * mult)) };
    }).sort(function (a, b) { return b.implied - a.implied; });
    document.getElementById('sandbox-top').innerHTML = scored.slice(0, 10).map(function (s) {
      return '<li><strong>' + esc(s.name) + '</strong> — ' + money(s.implied) +
        ' <span class="muted">(board rank #' + s.rank + ')</span></li>';
    }).join('');
  }
  COEF_NAMES.slice(1).forEach(function (c, i) {
    const idx = i + 1;
    document.getElementById('sb-' + idx).addEventListener('input', function (e) {
      current[idx] = Number(e.target.value);
      document.getElementById('sbv-' + idx).textContent = current[idx].toFixed(2);
      sandboxTop();
    });
  });
  document.getElementById('sandbox-reset').addEventListener('click', function () {
    COEF_NAMES.slice(1).forEach(function (c, i) {
      const idx = i + 1;
      current[idx] = fitted[idx];
      document.getElementById('sb-' + idx).value = fitted[idx];
      document.getElementById('sbv-' + idx).textContent = fitted[idx].toFixed(2);
    });
    sandboxTop();
  });

  renderBoard();
  sandboxTop();
})();
