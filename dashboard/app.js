// Token Radar dashboard (radar-2). Reads window.RADAR from data.js and renders
// the ranked board, filters, sortable columns and a per-protocol detail panel.
// No network: every byte shown is in data.js. State lives in the URL hash so
// the board, a detail view and a filtered view are each a linkable address.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('app');
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, tab: 'pre', sort: 'implied', dir: -1, selected: null };

  var fmtInt = new Intl.NumberFormat('en-US');
  var fmtUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return fmtUsd.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function age(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs';
    return days + ' days';
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // The model, recomputed in the page from the same snapshot figures the
  // board carries, so the page can check its own numbers: impliedOf(row)
  // must equal row.implied_value_usd. See lib/model.ts impliedValue.
  function impliedOf(row) {
    var m = DATA.model;
    var g = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var gm = 1 + (g / 100) * m.growth_weight;
    var a = row.age_days === null ? m.unknown_age_days : row.age_days;
    var mm = m.maturity_floor + m.maturity_range * Math.sqrt(Math.min(Math.max(a, 0), m.maturity_days) / m.maturity_days);
    var bm = 1 + Math.min(Math.max((row.chains || []).length - 1, 0), m.breadth_max_chains) * m.breadth_per_chain;
    return Math.max(1, Math.round(row.tvl_usd * m.base_multiple * gm * mm * bm * row.purity_multiplier));
  }

  function readHash() {
    var p = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (p.get('q')) state.q = p.get('q');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('watch') === '1') state.watchOnly = true;
    if (p.get('tab')) state.tab = p.get('tab');
    if (p.get('p')) state.selected = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.watchOnly) p.set('watch', '1');
    if (state.tab !== 'pre') p.set('tab', state.tab);
    if (state.selected) p.set('p', state.selected);
    var s = p.toString();
    history.replaceState(null, '', s ? '#' + s : window.location.pathname + window.location.search);
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.watchOnly && !isWatch(r)) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  // Watchlist slugs are the board's first-floor set: the model records them
  // in data as rank order is value order, so membership is flagged per row
  // by the builder through the watch flag below (set in render from DATA).
  function isWatch(r) { return !!r.watch; }

  function sorted(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -Infinity : a.age_days; bv = b.age_days === null ? -Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : 1;
    });
  }

  function h(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }
  function sortBtn(key, label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label + (state.sort === key ? (state.dir < 0 ? ' ▼' : ' ▲') : '');
    b.addEventListener('click', function () {
      if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; }
      render();
    });
    return b;
  }

  function render() {
    app.innerHTML = '';
    var top = h('header', 'top');
    top.innerHTML = '<div class="wrap"><div class="brand"><span class="dot"></span><div><b>Token Radar</b><span>pre-token protocols · implied launch value</span></div></div>' +
      '<div class="top-meta">Snapshot ' + esc(DATA.as_of) + '<br>DefiLlama protocol index<br>Model ' + esc(DATA.model_version) + '</div></div>';
    app.appendChild(top);

    var wrap = h('div', 'wrap');
    var hero = h('section', 'hero');
    hero.innerHTML = '<h1>Which protocol without a token is worth farming next?</h1>' +
      '<p>Every protocol below records no token, and is ranked by the implied value of a launch — ' +
      'TVL × 0.30, adjusted for 7-day growth, longevity with no token, chain breadth and launch purity. ' +
      'The watchlist is the floor: protocols with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. ' +
      'Implied value is this radar\u2019s model, not a price and not a promise of a token.</p>';
    var kpis = h('div', 'kpis');
    var topVal = DATA.rows.length ? DATA.rows[0].implied_value_usd : 0;
    kpis.innerHTML =
      '<div class="kpi"><span>Watchlist covered</span><b>' + DATA.watchlist_on_board + ' / ' + DATA.watchlist_size + '</b><small>every watchlist slug is on the board</small></div>' +
      '<div class="kpi"><span>Pre-token rows</span><b>' + DATA.board_size + '</b><small>ranked by implied value</small></div>' +
      '<div class="kpi"><span>Top implied value</span><b>' + money(topVal) + '</b><small>rank 1 · ' + esc(DATA.rows.length ? DATA.rows[0].name : '') + '</small></div>' +
      '<div class="kpi"><span>Already trading</span><b>' + DATA.live_size + '</b><small>set aside, shown by market cap</small></div>';
    hero.appendChild(kpis);
    wrap.appendChild(hero);

    // Controls: search, category, chain, watchlist-only, pre/live tabs.
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var ctl = h('div', 'controls');
    ctl.innerHTML =
      '<div class="field grow"><label for="q">Search</label><input id="q" type="search" placeholder="Name, category or chain" value="' + esc(state.q) + '"></div>' +
      '<div class="field"><label for="cat">Category</label><select id="cat"><option value="all">All categories</option>' +
      cats.map(function (c) { return '<option value="' + esc(c) + '"' + (c === state.category ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="chain">Chain</label><select id="chain"><option value="all">All chains</option>' +
      chains.map(function (c) { return '<option value="' + esc(c) + '"' + (c === state.chain ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></div>' +
      '<label class="check"><input id="watch" type="checkbox"' + (state.watchOnly ? ' checked' : '') + '> Watchlist only</label>' +
      '<div class="tabs"><button type="button" id="tabPre" aria-pressed="' + (state.tab === 'pre') + '">Pre-token</button>' +
      '<button type="button" id="tabLive" aria-pressed="' + (state.tab === 'live') + '">Already trading</button></div>' +
      '<span class="count" id="count"></span>';
    wrap.appendChild(ctl);
    ctl.querySelector('#q').addEventListener('input', function (e) { state.q = e.target.value; writeHash(); render(); });
    ctl.querySelector('#cat').addEventListener('change', function (e) { state.category = e.target.value; writeHash(); render(); });
    ctl.querySelector('#chain').addEventListener('change', function (e) { state.chain = e.target.value; writeHash(); render(); });
    ctl.querySelector('#watch').addEventListener('change', function (e) { state.watchOnly = e.target.checked; writeHash(); render(); });
    ctl.querySelector('#tabPre').addEventListener('click', function () { state.tab = 'pre'; render(); });
    ctl.querySelector('#tabLive').addEventListener('click', function () { state.tab = 'live'; render(); });

    if (state.tab === 'pre') wrap.appendChild(boardPanel());
    else wrap.appendChild(livePanel());

    var model = h('section', 'panel model');
    var m = DATA.model;
    model.innerHTML = '<h2>How implied value is computed</h2>' +
      '<p>One function scores every protocol — no name is special-cased. Purity is the guardrail: ' +
      'wrapped, staked or bridged products and exchanges are discounted hard, because their value already belongs to a token that trades.</p>' +
      '<div class="formula">implied = round( tvl × ' + m.base_multiple + ' × growth × maturity × breadth × purity )</div>' +
      '<dl><dt>Growth</dt><dd>1 + clamp(7d, ' + m.growth_floor + ', ' + m.growth_cap + ')% × ' + m.growth_weight + '</dd>' +
      '<dt>Maturity</dt><dd>' + m.maturity_floor + ' + ' + m.maturity_range + ' × √(age / ' + m.maturity_days + 'd)</dd>' +
      '<dt>Breadth</dt><dd>1 + ' + m.breadth_per_chain + ' per extra chain, max ' + m.breadth_max_chains + '</dd>' +
      '<dt>Purity</dt><dd>clean 1.00 · versioned 0.10 · wrapped 0.05 · exchange 0.02 · CEX 0.01</dd>' +
      '<dt>Age</dt><dd>days since listed_at; ' + m.unknown_age_days + 'd when unlisted</dd></dl>';
    wrap.appendChild(model);
    wrap.appendChild(h('p', 'foot', 'Source: DefiLlama protocol index, snapshot ' + esc(DATA.as_of) + '. “Records no token” means DefiLlama records none — it is not proof a token does not exist. Not financial advice.'));
    app.appendChild(wrap);
    app.setAttribute('aria-busy', 'false');
    var count = document.getElementById('count');
    if (count) count.textContent = state.tab === 'pre' ? filtered().length + ' of ' + DATA.board_size + ' rows' : DATA.live.length + ' live protocols';
    if (state.selected) openDetail(state.selected);
  }

  function boardPanel() {
    var list = sorted(filtered());
    var panel = h('div', 'panel');
    if (!list.length) {
      panel.innerHTML = '<div class="empty"><h2>No protocol matches that filter</h2><p>Clear the search or pick another category or chain.</p><button class="btn" type="button" id="clear">Clear filters</button></div>';
      panel.querySelector('#clear').addEventListener('click', function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; writeHash(); render(); });
      return panel;
    }
    var max = list.reduce(function (a, r) { return Math.max(a, r.implied_value_usd); }, 1);
    var table = document.createElement('table');
    var cap = document.createElement('caption');
    cap.textContent = 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.';
    table.appendChild(cap);
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    [['Rank', 'implied'], ['Protocol', 'name'], ['TVL', 'tvl'], ['7d', 'growth'], ['Age', 'age'], ['Implied value', 'implied']].forEach(function (c, i) {
      var th = document.createElement('th'); if (i >= 2) th.className = 'num';
      th.appendChild(sortBtn(c[1], c[0])); hr.appendChild(th);
    });
    var th7 = document.createElement('th'); th7.textContent = 'Token'; hr.appendChild(th7);
    thead.appendChild(hr); table.appendChild(thead);
    var tb = document.createElement('tbody');
    list.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.tabIndex = 0;
      if (state.selected === r.slug) tr.setAttribute('data-selected', 'true');
      var open = function () { state.selected = r.slug; writeHash(); render(); };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      var growthCls = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'pos' : 'neg');
      var badge = isWatch(r) ? '<span class="badge watch">WATCHLIST</span>' : '';
      var purity = r.purity !== 'clean' ? '<span class="badge purity">' + esc(r.purity.toUpperCase()) + '</span>' : '';
      tr.innerHTML = '<td class="num">' + r.rank + '</td>' +
        '<td><div class="name"><b>' + esc(r.name) + badge + purity + '</b><span>' + esc(r.category || 'Other') + ' · ' + esc((r.chains || []).slice(0, 2).join(', ') || 'unnamed chain') + '</span></div></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + growthCls + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td><div class="bar" aria-hidden="true"><i style="width:' + Math.max(3, Math.round(r.implied_value_usd / max * 100)) + '%"></i></div><span class="num">' + money(r.implied_value_usd) + '</span></td>' +
        '<td><span class="status">no token</span></td>';
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    var tw = h('div', 'table-wrap'); tw.appendChild(table); panel.appendChild(tw);
    return panel;
  }

  function livePanel() {
    var panel = h('div', 'panel');
    var table = document.createElement('table');
    var cap = document.createElement('caption');
    cap.textContent = 'Already trading: these protocols have a token, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.';
    table.appendChild(cap);
    table.innerHTML += '<thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Market cap</th><th>Token</th></tr></thead>';
    var tb = document.createElement('tbody');
    DATA.live.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td><div class="name"><b>' + esc(r.name) + '</b><span>' + esc(r.category || 'Other') + ' · ' + esc((r.chains || []).slice(0, 2).join(', ') || 'unnamed chain') + '</span></div></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + money(r.mcap_usd) + '</td><td><span class="status dim">already trades</span></td>';
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    var tw = h('div', 'table-wrap'); tw.appendChild(table); panel.appendChild(tw);
    return panel;
  }

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    var old = document.querySelector('.detail');
    if (old) old.remove();
    var overlay = h('div', 'detail');
    var card = h('div', 'detail-card');
    var recomputed = impliedOf(row);
    var steps = (row.farm_steps || []).map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return '<li><b>' + esc(action) + '</b><span class="cost">' + esc(tail) + '</span></li>';
    }).join('');
    card.innerHTML = '<button class="close" type="button">Close ✕</button>' +
      '<span class="status">Rank ' + row.rank + ' of ' + DATA.board_size + (isWatch(row) ? ' · Watchlist' : '') + '</span>' +
      '<h2>' + esc(row.name) + '</h2>' +
      '<p class="sub">' + esc(row.category || 'Other') + ' on ' + esc((row.chains || []).join(', ') || 'an unnamed chain') + ' · listed ' + esc(row.listed_at || 'date unknown') + '</p>' +
      '<div class="grid">' +
      '<div class="cell wide"><span>Implied launch value</span><b>' + money(row.implied_value_usd) + '</b></div>' +
      '<div class="cell"><span>TVL</span><b>' + money(row.tvl_usd) + '</b></div>' +
      '<div class="cell"><span>Seven-day growth</span><b>' + pct(row.change_7d) + '</b></div>' +
      '<div class="cell"><span>Age with no token</span><b>' + age(row.age_days) + '</b></div>' +
      '<div class="cell"><span>Growth × Maturity</span><b>' + row.growth_multiplier + ' × ' + row.maturity_multiplier + '</b></div>' +
      '<div class="cell"><span>Breadth × Purity</span><b>' + row.breadth_multiplier + ' × ' + row.purity_multiplier + '</b></div>' +
      '<div class="cell"><span>Page recomputes</span><b>' + money(recomputed) + (recomputed === row.implied_value_usd ? ' ✓ matches board' : ' — differs') + '</b></div>' +
      '</div>' +
      '<h3>Farm plan — 7 steps</h3><ol class="steps">' + steps + '</ol>' +
      '<p class="note">This protocol records no token in the snapshot. That is DefiLlama\u2019s record, not proof — check the protocol\u2019s own pages before farming. Implied value is a model, not a price.</p>';
    card.querySelector('.close').addEventListener('click', function () { state.selected = null; writeHash(); render(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) { state.selected = null; writeHash(); render(); } });
    overlay.appendChild(card);
    app.appendChild(overlay);
  }

  // Watchlist membership comes from the builder (r.watch, the snapshot's own
  // watchlist); the floor rule below is only a fallback for older data.js.
  DATA.rows.forEach(function (r) {
    if (r.watch === undefined) r.watch = r.tvl_usd >= DATA.floor_usd && r.purity === 'clean';
  });
  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) { state.selected = null; writeHash(); render(); }
  });
})();
