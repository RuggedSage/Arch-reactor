/* Arch Reactor — games + live price. Loaded after index.html's main script. */
(function () {
  'use strict';

  var A = window.Arch;
  var G = {};
  window.Games = G;

  /* ═══════════════════════════════════════════════════════════
     CONFIG
     ═══════════════════════════════════════════════════════════ */
  var CFG = {
    // Price. Set ONE of these.
    PRICE_MANUAL_USD: 0,        // e.g. 0.000389 — used when there is no pool yet
    PRICE_API: '',              // https URL returning {"price_usd": 0.0004}
    // e.g. STON.fi: https://api.ston.fi/v1/asset/EQ...   -> read "dex_price"
    PRICE_TTL_MS: 60000,

    // Live on-chain state (toncenter). Paste POOL_JETTON_WALLET from the deploy page.
    POOL_JETTON_WALLET: '',     // jetton wallet holding the 70%
    MINTER_ADDRESS: '',         // defaults to A.cfg.TOKEN_ADDRESS
    TONCENTER_KEY: '',          // optional, avoids rate limits
    CHAIN_TTL_MS: 60000,

    // Card Vault
    CARDS: 10,
    PICKS: 3,
    GUESSES: 6,                 // 6 => 18% win rate. 8 => 31%, 9 => 37%
    CARD_WIN_LIMIT: 2,          // wins per 24h
    CARD_WINDOW_MS: 24 * 3600 * 1000,
    CARD_BURN_SHARE: 0.5,       // share of a losing wager that is burned

    // wagers
    MIN_WAGER: 100,
    MAX_SHARE_OF_BALANCE: 0.5
  };

  /* ═══════════════════════════════════════════════════════════
     LIVE PRICE
     ═══════════════════════════════════════════════════════════ */
  var Price = {
    usd: 0,
    at: 0,
    source: 'none',

    get: function () {
      if (CFG.PRICE_MANUAL_USD > 0) { this.source = 'manual'; return CFG.PRICE_MANUAL_USD; }
      return this.usd;
    },

    refresh: function () {
      var self = this;
      if (CFG.PRICE_MANUAL_USD > 0) { this.paint(); return; }
      if (!CFG.PRICE_API) { this.paint(); return; }
      if (Date.now() - this.at < CFG.PRICE_TTL_MS) { this.paint(); return; }

      fetch(CFG.PRICE_API, { headers: { accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var p = Number(
            (j && (j.price_usd || j.price || j.dex_price || (j.asset && j.asset.dex_price))) || 0
          );
          if (p > 0) { self.usd = p; self.at = Date.now(); self.source = 'api'; }
          self.paint();
        })
        .catch(function () { self.paint(); });
    },

    paint: function () {
      var el = document.getElementById('usdLine');
      if (!el) return;
      var p = this.get();
      var S = A.state;
      if (!p) {
        el.hidden = false;
        el.style.color = '#5b6880';
        el.textContent = 'unpriced — no market yet';
        var t0 = document.getElementById('todayUsd');
        if (t0) t0.textContent = 'unpriced';
        return;
      }
      el.hidden = false;
      el.style.color = '';
      el.textContent = '≈ $' + (S.balance * p).toFixed(2) + '  ·  1 ARCHIE = $' + p.toFixed(6);

      var today = document.getElementById('todayUsd');
      if (today) today.textContent = '≈ $' + ((S.earnedToday || 0) * p).toFixed(3) + ' at this price';
    }
  };

  /* ═══════════════════════════════════════════════════════════
     LIVE ON-CHAIN STATE
     Reads the actual jetton wallet balance and total supply from the
     blockchain, so every user sees the same real numbers — not a local tally.
     ═══════════════════════════════════════════════════════════ */
  var Chain = {
    supply: null, pool: null, at: 0, ok: false, err: '',

    minter: function () {
      var s = A.state || {};
      return CFG.MINTER_ADDRESS || s.token || (A.cfg && A.cfg.TOKEN_ADDRESS) || '';
    },

    rpc: function (address, method) {
      var body = { address: address, method: method, stack: [] };
      var headers = { 'content-type': 'application/json' };
      if (CFG.TONCENTER_KEY) headers['X-API-Key'] = CFG.TONCENTER_KEY;
      return fetch('https://toncenter.com/api/v2/runGetMethod', {
        method: 'POST', headers: headers, body: JSON.stringify(body)
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j || j.ok !== true || !j.result || j.result.exit_code !== 0) throw new Error('rpc');
        var v = j.result.stack && j.result.stack[0];
        if (!v || v[0] !== 'num') throw new Error('num');
        return BigInt(v[1]);
      });
    },

    loadCache: function () {
      try {
        var c = JSON.parse(localStorage.getItem('ar.chain') || 'null');
        if (c && typeof c.supply === 'number' && typeof c.pool === 'number') {
          this.supply = BigInt(c.supply); this.pool = BigInt(c.pool); this.at = c.at; this.ok = true;
        }
      } catch (e) {}
    },

    saveCache: function () {
      try {
        localStorage.setItem('ar.chain', JSON.stringify({
          supply: Number(this.supply), pool: Number(this.pool), at: this.at
        }));
      } catch (e) {}
    },

    refresh: function () {
      var self = this;
      var minter = this.minter();
      var poolWallet = CFG.POOL_JETTON_WALLET;
      if (!minter || !poolWallet) { this.err = 'not configured'; this.paint(); return; }
      if (Date.now() - this.at < CFG.CHAIN_TTL_MS) { this.paint(); return; }

      Promise.all([
        this.rpc(minter, 'get_jetton_data'),
        this.rpc(poolWallet, 'get_wallet_data')
      ]).then(function (res) {
        self.supply = res[0];
        self.pool = res[1];
        self.at = Date.now();
        self.ok = true;
        self.err = '';
        self.saveCache();
        self.paint();
      }).catch(function (e) {
        self.err = 'offline';
        self.paint();
      });
    },

    age: function () {
      if (!this.at) return '';
      var s = Math.floor((Date.now() - this.at) / 1000);
      return s < 90 ? 'live' : Math.floor(s / 60) + 'm ago';
    },

    paint: function () {
      var poolEl = document.getElementById('poolLeft');
      var noteEl = document.getElementById('poolNote');
      if (poolEl) {
        if (this.ok && this.pool != null) {
          poolEl.textContent = (Number(this.pool) / 1e9).toLocaleString('en-US');
          if (noteEl) noteEl.textContent = 'on-chain · ' + this.age();
        } else {
          poolEl.textContent = '—';
          if (noteEl) noteEl.textContent = this.err === 'offline' ? 'chain unreachable' : 'not configured';
        }
      }

      var minted = document.getElementById('sMinted');
      var burned = document.getElementById('sBurned');
      var remaining = document.getElementById('sRemaining');
      var locked = document.getElementById('sLocked');
      var burnedOnChain = this.ok ? (2000000000n * 1000000000n - this.supply) : null;

      if (minted && this.ok) minted.textContent = (Number(this.supply) / 1e9).toLocaleString('en-US');
      if (remaining && this.ok) remaining.textContent = (Number(this.supply) / 1e9).toLocaleString('en-US');
      if (burned && burnedOnChain != null) {
        var pending = BigInt(Math.round((S().burned || 0) * 1e9));
        burned.textContent = (Number(burnedOnChain + pending) / 1e9).toLocaleString('en-US');
      }
      if (locked && !this.ok) locked.textContent = '200,000,000';
    }
  };

  /* ═══════════════════════════════════════════════════════════
     shared helpers
     ═══════════════════════════════════════════════════════════ */
  function S() { return A.state; }
  function fmt(n) { return A.fmt(n); }
  function toast(m) { A.toast(m); }
  function area() { return document.getElementById('gameArea'); }
  function esc(s) { return String(s).replace(/[<>&]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]; }); }

  function winsToday() {
    var s = S();
    var cut = Date.now() - CFG.CARD_WINDOW_MS;
    s.cardWins = (s.cardWins || []).filter(function (t) { return t > cut; });
    return s.cardWins.length;
  }

  function lockWagers(locked) {
    ['crdAmt', 'pvpAmt'].forEach(function (id) {
      var g2 = document.getElementById(id);
      if (g2) g2.classList.toggle('locked', !!locked);
    });
  }

  function pickWager(groupId) {
    var w = CFG.MIN_WAGER;
    var g = document.getElementById(groupId);
    var on = g ? g.querySelector('button.on') : null;
    if (on) {
      var raw = Number(on.getAttribute('data-w'));
      if (isFinite(raw) && raw > 0) w = Math.floor(raw);
    }
    return Math.max(CFG.MIN_WAGER, w);   // never 0, never negative, never NaN
  }

  function bindWager(groupId) {
    var g = document.getElementById(groupId);
    if (!g) return;
    g.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      Array.prototype.forEach.call(g.querySelectorAll('button'), function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      A.haptic('light');
    });
  }

  function canWager(w) {
    var s = S();
    if (s.balance < w) { toast('Not enough ARCHIE for that wager'); return false; }
    if (w > s.balance * CFG.MAX_SHARE_OF_BALANCE) { toast('Max wager is half your balance'); return false; }
    return true;
  }

  /* ═══════════════════════════════════════════════════════════
     CARD VAULT
     ═══════════════════════════════════════════════════════════ */
  var cardGame = null;

  function startCards() {
    if (cardGame && !cardGame.over) {
      toast('Finish the current round — or forfeit it — before starting another');
      return;
    }
    var w = pickWagerWV('crdAmt');
    if (!(w > 0)) w = CFG.MIN_WAGER;
    if (winsToday() >= CFG.CARD_WIN_LIMIT) {
      toast('Win limit reached — back in ' + hoursToReset() + 'h');
      return;
    }
    if (!canWager(w)) return;

    var s = S();
    s.balance -= w;
    A.save(); A.render(); A.haptic('light');

    var deck = [];
    for (var i = 0; i < CFG.CARDS; i++) deck.push(i);
    var hidden = shuffle(deck.slice()).slice(0, CFG.PICKS);

    cardGame = {
      wager: w,
      hidden: hidden,
      guess: 0,
      picks: [],
      locked: false,
      dead: [],
      over: false,
      hint: '',
      quitArmed: false
    };
    s.cardRound = { wager: w, hidden: hidden, guess: 0, startedAt: Date.now() };
    A.saveNow();
    lockWagers(true);
    renderCards();
  }

  function pickWagerWV(id) { return pickWager(id); }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function renderCards() {
    var g = cardGame;
    var host = area();
    if (!g) { host.innerHTML = ''; return; }

    var html = '<div class="gcard">';
    html += '<div class="vs"><span>Wager <b>' + fmt(g.wager) + '</b> ARCHIE</span>' +
            '<span>Guess <b>' + Math.min(g.guess + 1, CFG.GUESSES) + '</b> / ' + CFG.GUESSES + '</span></div>';
    html += '<div class="odds" style="color:var(--txt);margin-bottom:8px">' +
            'Find the ' + CFG.PICKS + ' hidden cards in ' + CFG.GUESSES + ' guesses.</div>';
    html += '<div class="deck" id="deck" role="group" aria-label="Card deck">';

    for (var i = 0; i < CFG.CARDS; i++) {
      var cls = 'crd';
      if (g.picks.indexOf(i) > -1) cls += ' pick';
      if (g.dead.indexOf(i) > -1) cls += ' locked';
      if (g.over) {
        if (g.hidden.indexOf(i) > -1) cls += ' good';
        else cls += ' locked';
      }
      var picked = g.picks.indexOf(i) > -1;
      var label = 'Card ' + (i + 1) + (picked ? ', selected' : '') + (g.dead.indexOf(i) > -1 ? ', ruled out' : '');
      html += '<button type="button" class="' + cls + '" data-c="' + i + '"' +
              ' aria-pressed="' + (picked ? 'true' : 'false') + '" aria-label="' + label + '"' +
              (g.dead.indexOf(i) > -1 || g.over ? ' disabled' : '') + '>' +
              (picked ? '◆' : '') + '</button>';
    }
    html += '</div>';
    html += '<div class="hint" id="cardHint">' +
            (g.over ? '' : (g.hint || ('Pick ' + CFG.PICKS + ' cards, then they are checked.'))) + '</div>';
    html += '<button class="btn primary" id="cardSubmit"' + (g.picks.length === 3 && !g.over ? '' : ' disabled') + '>Check</button>';
    html += '<button class="btn ghost' + (g.quitArmed ? ' danger' : '') + '" id="cardQuit" style="margin-top:8px">' +
            (g.over ? 'Close' : (g.quitArmed ? 'Tap again to forfeit half' : 'Forfeit')) + '</button>';
    html += '<div class="odds" style="color:var(--amber)">Burned so far: ' + fmt(S().burned || 0) +
            ' ARCHIE — permanent, and settled on-chain in a monthly batch so it can be verified.</div>';
    html += '<div class="odds">Wins left today: ' + (CFG.CARD_WIN_LIMIT - winsToday()) + ' of ' + CFG.CARD_WIN_LIMIT + '. ' +
            'A losing wager returns half; the other half is <b style="color:var(--amber)">burned forever</b> and ' +
            'permanently removed from the 2,000,000,000 supply.</div>';
    html += '</div>';
    host.innerHTML = html;

    document.getElementById('deck').addEventListener('click', function (e) {
      var c = e.target.closest('.crd');
      if (!c || g.over || g.locked) return;
      var idx = Number(c.getAttribute('data-c'));
      if (g.dead.indexOf(idx) > -1) return;
      var at = g.picks.indexOf(idx);
      if (at > -1) g.picks.splice(at, 1);
      else if (g.picks.length < CFG.PICKS) g.picks.push(idx);
      A.haptic('light');
      renderCards();
    });

    document.getElementById('cardSubmit').addEventListener('click', submitCards);
    document.getElementById('cardQuit').addEventListener('click', function () {
      if (g.over) {
        cardGame = null;
        area().innerHTML = '';
        lockWagers(false);
        return;
      }
      if (!g.quitArmed) {
        // first tap only arms it — a mis-tap must not burn half a wager
        g.quitArmed = true;
        renderCards();
        clearTimeout(g.quitTimer);
        g.quitTimer = setTimeout(function () {
          if (cardGame === g && !g.over) { g.quitArmed = false; renderCards(); }
        }, 3000);
        return;
      }
      clearTimeout(g.quitTimer);
      finishCards(false, 'Forfeited');
    });
  }

  function submitCards() {
    var g = cardGame;
    if (!g || g.picks.length !== CFG.PICKS || g.over) return;

    g.guess++;
    var hits = g.picks.filter(function (c) { return g.hidden.indexOf(c) > -1; }).length;

    if (hits === CFG.PICKS) { finishCards(true, 'All three matched'); return; }

    if (hits === 0) {
      // nothing in this guess is part of the set — never guess these again
      g.picks.forEach(function (c) { if (g.dead.indexOf(c) === -1) g.dead.push(c); });
    }

    g.hint = hits + ' of ' + CFG.PICKS + ' correct — ' +
             (CFG.GUESSES - g.guess) + ' attempt' + (CFG.GUESSES - g.guess === 1 ? '' : 's') + ' left';

    g.picks = [];

    if (g.guess >= CFG.GUESSES) { finishCards(false, 'Out of attempts'); return; }

    g.locked = true;
    renderCards();
    setTimeout(function () { g.locked = false; }, 250);
  }

  function finishCards(won, why) {
    var g = cardGame;
    var s = S();
    g.over = true;
    s.cardRound = null;

    if (won) {
      s.balance += g.wager * 2;
      s.earnedToday = (s.earnedToday || 0) + g.wager;
      s.cardWins = (s.cardWins || []).concat([Date.now()]);
      s.cardWinsTotal = (s.cardWinsTotal || 0) + 1;
      toast('+' + fmt(g.wager) + ' ARCHIE — ' + why);
      A.haptic('ok');
    } else {
      var back = Math.floor(g.wager * (1 - CFG.CARD_BURN_SHARE));
      var burned = g.wager - back;
      s.balance += back;
      s.burned = (s.burned || 0) + burned;
      toast('-' + fmt(burned) + ' ARCHIE burned · ' + fmt(back) + ' returned');
      A.haptic('err');
    }
    A.save(); A.render();
    lockWagers(false);
    renderCards();
    Price.paint();
  }

  function hoursToReset() {
    var s = S();
    if (!s.cardWins || !s.cardWins.length) return 24;
    var oldest = Math.min.apply(null, s.cardWins);
    return Math.max(1, Math.ceil((oldest + CFG.CARD_WINDOW_MS - Date.now()) / 3600000));
  }

  /* ═══════════════════════════════════════════════════════════
     public
     ═══════════════════════════════════════════════════════════ */
  // H2: a round left open by a crash or reload settles as a loss (half returned)
  G.recoverRound = function () {
    var s = S();
    var r = s.cardRound;
    if (!r) return;
    var back = Math.floor(r.wager * (1 - CFG.CARD_BURN_SHARE));
    s.balance += back;
    s.burned = (s.burned || 0) + (r.wager - back);
    s.cardRound = null;
    A.saveNow();
    toast('Unfinished round refunded: ' + fmt(back) + ' ARCHIE returned');
  };

  G.paintChain = function () { Chain.paint(); };
  G.chainPool = function () { return Chain.ok && Chain.pool != null ? Number(Chain.pool) / 1e9 : null; };
  G.chainStatus = function () { return { ok: Chain.ok, err: Chain.err, pool: G.chainPool(), at: Chain.at }; };
  G.constants = function () {
    return { CARDS: CFG.CARDS, PICKS: CFG.PICKS, GUESSES: CFG.GUESSES,
             WIN_LIMIT: CFG.CARD_WIN_LIMIT, MIN_WAGER: CFG.MIN_WAGER,
             BURN_SHARE: CFG.CARD_BURN_SHARE };
  };
  G.priceValue = function () { return Price.get(); };

  G.render = function () {
    Chain.refresh();
    Price.refresh();
    Price.paint();
    var note = document.getElementById('crdNote');
    if (note) {
      var left = CFG.CARD_WIN_LIMIT - winsToday();
      var wr = { 5: 13, 6: 18, 7: 24, 8: 31, 9: 37 }[CFG.GUESSES] || 18;
      note.textContent = left > 0
        ? left + ' of ' + CFG.CARD_WIN_LIMIT + ' wins left today · ' + wr + '% win rate over ' + CFG.GUESSES + ' guesses'
        : 'Win limit reached — resets in ' + hoursToReset() + 'h';
    }
  };

  function boot() {
    bindWager('crdAmt');
    var crd = document.getElementById('crdStart');
    if (crd) crd.addEventListener('click', startCards);

    Chain.loadCache();
    Chain.refresh();
    Price.refresh();
    Price.paint();
    setInterval(function () { Price.refresh(); }, 30000);
    setInterval(function () { Chain.refresh(); }, 60000);
    setInterval(function () { Price.paint(); }, 4000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
