/* 6ix AM Club web app — attendance first, everything else "in development".
   No build step: plain JS. Backend = Google Apps Script (see ../apps-script/Code.gs).
   With no API_URL in config.js it runs in DEMO mode against a mock stored on this device. */
(function () {
  'use strict';
  const CFG = window.SIX_CONFIG || {};
  const DEMO = !CFG.API_URL || new URLSearchParams(location.search).has('demo');
  // palette: ?theme=mono|firstlight overrides config (used for the palette board)
  document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || CFG.THEME || 'mono';
  const TZ = 'Africa/Johannesburg';
  const $app = document.getElementById('app');
  const LOGO = '<img src="assets/lockup-white.png" alt="6ix AM Club">';

  /* ---------- helpers ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
    del(k) { try { localStorage.removeItem(k); } catch (_) {} },
  };
  const me = () => store.get('six.member', null);
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function fmtDate(d) {
    if (!d) return '';
    const dt = new Date(d + 'T12:00:00');
    return dt.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function dayMonth(d) {
    const dt = new Date(d + 'T12:00:00');
    return { day: String(dt.getDate()).padStart(2, '0'), mon: dt.toLocaleDateString('en-ZA', { month: 'short' }).replace('.', '') };
  }
  const firstName = n => String(n || '').trim().split(/\s+/)[0];
  const ERR = {
    bad_code: "That code doesn't match today's run. Scan the QR at the start line again.",
    not_open_yet: 'Check-in opens on run day. See you there.',
    run_closed: 'Check-in for this run has closed.',
    run_not_found: "We couldn't find that run. Scan the QR again.",
    run_cancelled: 'This run was cancelled.',
    member_not_found: "We couldn't find your profile. Sign up again with the same number.",
    no_member: "No member with that number yet. Join below.",
    name_required: 'Add your name.',
    phone_invalid: 'Check your cellphone number.',
    bad_pin: 'Wrong organiser PIN.',
    network: 'No connection. Try again in a moment.',
  };
  const errMsg = e => ERR[e] || 'Something went wrong. Try again.';

  /* ---------- API (real or demo) ---------- */
  async function api(action, params) {
    const body = Object.assign({ action }, params || {});
    if (DEMO) return Mock.call(body);
    try {
      // text/plain keeps it a "simple" request: no CORS preflight against Apps Script
      const r = await fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
      return await r.json();
    } catch (_) { return { ok: false, error: 'network' }; }
  }

  /* Demo backend: same contract as Code.gs, stored in localStorage */
  const Mock = {
    db() {
      let db = store.get('six.demo', null);
      if (!db || db.seed !== today()) {
        const t = today();
        const nxt = new Date(t + 'T12:00:00'); nxt.setDate(nxt.getDate() + 7);
        const n = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(nxt);
        const prev = [21, 14, 7].map(k => { const d = new Date(t + 'T12:00:00'); d.setDate(d.getDate() - k); return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); });
        db = {
          seed: t, pin: '6060',
          members: (db && db.members) || [{ member_id: 'Mdemo01', name: 'Thando M.', phone: '27820000001' }, { member_id: 'Mdemo02', name: 'Lebo K.', phone: '27820000002' }],
          runs: [
            ...prev.map((d, i) => ({ run_id: 'R-' + d, date: d, time: '06:00', title: 'Club run · Vol.0' + (i + 1), location: 'Mamelodi', ticket_url: '', code: 'PAST', status: 'open' })),
            { run_id: 'R-2026-12-05', date: '2026-12-05', time: '05:30', title: 'Final Run of 2026 · 7KM × Dinho Cafe', location: 'Mamelodi', ticket_url: 'https://www.quicket.co.za/events/382399-5thdec26/', code: 'DEMO', status: 'open' },
          ],
          checkins: [],
          bookings: [{ run_id: 'R-2026-12-05', name: 'Thando M.', phone: '27820000001' }, { run_id: 'R-2026-12-05', name: 'Sipho N.', phone: '27820000003' }],
        };
        // seed a little history for the demo members
        prev.forEach(d => db.checkins.push({ run_id: 'R-' + d, member_id: 'Mdemo01', name: 'Thando M.', phone: '27820000001', method: 'qr', at: d + 'T06:02:00' }));
        store.set('six.demo', db);
      }
      return db;
    },
    save(db) { store.set('six.demo', db); },
    phone(v) { let d = String(v || '').replace(/\D/g, ''); if (d.startsWith('0') && d.length === 10) d = '27' + d.slice(1); if (d.length === 9) d = '27' + d; return d; },
    stats(db, id) {
      const t = today();
      const past = db.runs.filter(r => r.date <= t).sort((a, b) => a.date.localeCompare(b.date));
      const mine = db.checkins.filter(c => c.member_id === id);
      const att = new Set(mine.map(c => c.run_id));
      let streak = 0;
      for (let i = past.length - 1; i >= 0; i--) { if (att.has(past[i].run_id)) streak++; else if (past[i].date === t) continue; else break; }
      const by = Object.fromEntries(db.runs.map(r => [r.run_id, r]));
      return { total: att.size, streak, history: mine.map(c => ({ run_id: c.run_id, title: (by[c.run_id] || {}).title, date: (by[c.run_id] || {}).date, method: c.method })).sort((a, b) => b.date.localeCompare(a.date)) };
    },
    member(db, name, phone) {
      const ph = this.phone(phone);
      if (!String(name || '').trim()) throw 'name_required';
      if (ph.length < 11) throw 'phone_invalid';
      let m = db.members.find(x => x.phone === ph);
      if (m) return Object.assign({ existing: true }, m);
      m = { member_id: 'M' + Math.random().toString(16).slice(2, 10), name: String(name).trim(), phone: ph };
      db.members.push(m); return Object.assign({ existing: false }, m);
    },
    add(db, run, m, method) {
      if (db.checkins.find(c => c.run_id === run.run_id && c.member_id === m.member_id)) return { already: true };
      db.checkins.push({ run_id: run.run_id, member_id: m.member_id, name: m.name, phone: m.phone, method, at: new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, dateStyle: 'short', timeStyle: 'medium' }).format(new Date()).replace(' ', 'T') });
      return { already: false };
    },
    async call(p) {
      await new Promise(r => setTimeout(r, 250));
      const db = this.db(); const t = today();
      try {
        const out = (() => {
          switch (p.action) {
            case 'status': { const n = db.runs.filter(r => r.date >= t).sort((a, b) => a.date.localeCompare(b.date))[0]; return { today: t, next: n || null }; }
            case 'register': return { member: this.member(db, p.name, p.phone) };
            case 'signin': { const m = db.members.find(x => x.phone === this.phone(p.phone)); if (!m) throw 'no_member'; return { member: Object.assign({ existing: true }, m) }; }
            case 'vote': { db.votes = (db.votes || []).filter(v => v.member_id !== p.member_id); db.votes.push({ member_id: p.member_id, feature: p.feature }); return {}; }
            case 'me': { const m = db.members.find(x => x.member_id === p.member_id); if (!m) throw 'member_not_found'; return { member: m, stats: this.stats(db, m.member_id) }; }
            case 'checkin': {
              const run = db.runs.find(r => r.run_id === p.run_id); if (!run) throw 'run_not_found';
              if (run.date !== t) throw (run.date > t ? 'not_open_yet' : 'run_closed');
              if (String(p.code || '').toUpperCase() !== run.code) throw 'bad_code';
              const m = db.members.find(x => x.member_id === p.member_id); if (!m) throw 'member_not_found';
              const r = this.add(db, run, m, 'qr');
              return Object.assign({ run, count: db.checkins.filter(c => c.run_id === run.run_id).length, stats: this.stats(db, m.member_id) }, r);
            }
            case 'admin_run': {
              if (String(p.pin) !== db.pin) throw 'bad_pin';
              const run = db.runs.find(r => r.date === t) || db.runs.find(r => r.date > t);
              const checkins = db.checkins.filter(c => c.run_id === run.run_id).map(c => ({ name: c.name, phone: c.phone, method: c.method, at: c.at }));
              const inP = new Set(checkins.map(c => c.phone));
              const bk = db.bookings.filter(b => b.run_id === run.run_id);
              const bP = new Set(bk.map(b => this.phone(b.phone)));
              checkins.forEach(c => { c.booked = bP.has(c.phone); });
              return { today: t, run, checkins: checkins.reverse(), booked: bk.length, no_shows: bk.filter(b => !inP.has(this.phone(b.phone))), members: db.members.map(m => ({ member_id: m.member_id, name: m.name, last4: m.phone.slice(-4) })) };
            }
            case 'admin_add': {
              if (String(p.pin) !== db.pin) throw 'bad_pin';
              const run = db.runs.find(r => r.run_id === p.run_id); if (!run) throw 'run_not_found';
              const m = p.member_id ? db.members.find(x => x.member_id === p.member_id) : this.member(db, p.name, p.phone);
              if (!m) throw 'member_not_found';
              return Object.assign({ name: m.name }, this.add(db, run, m, 'organiser'));
            }
            default: throw 'unknown_action';
          }
        })();
        this.save(db);
        return Object.assign({ ok: true }, out);
      } catch (e) { return { ok: false, error: String(e) }; }
    },
  };

  /* ---------- router ---------- */
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, qs] = h.split('?');
    const params = Object.fromEntries(new URLSearchParams(qs || ''));
    return { parts: (path || '').split('/').filter(Boolean), params };
  }
  const go = h => { if (location.hash === h) route(); else location.hash = h; };
  const demoNote = () => DEMO ? '<div class="demo">Demo mode: saved on this phone only. Today\'s check-in code is <b>DEMO</b>, organiser PIN <b>6060</b>.</div>' : '';
  const loading = () => { $app.innerHTML = '<div class="splash" aria-label="Loading"><img src="assets/lockup-white.png" alt="6ix AM Club"><i></i></div>'; };

  async function route() {
    window.scrollTo(0, 0);
    clearInterval(route._poll);
    const { parts, params } = parseHash();
    const page = parts[0] || 'home';
    if (page === 'admin') return viewAdmin();
    if (page === 'soon') return viewSoon(parts[1]);
    if (!me()) {
      // keep where they were going (e.g. a QR check-in link) and come back after sign-up
      if (page === 'checkin') store.set('six.after', location.hash);
      return viewWelcome();
    }
    if (page === 'checkin') return viewCheckin(params);
    if (page === 'me') return viewMe();
    if (page === 'in') return viewIn();
    return viewHome();
  }
  window.addEventListener('hashchange', route);

  /* ---------- views ---------- */
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
  function signedIn(member, existing) {
    store.set('six.member', { member_id: member.member_id, name: member.name });
    toast(existing ? `Welcome back, ${firstName(member.name)}.` : `Welcome to the club, ${firstName(member.name)}.`);
    const after = store.get('six.after', null); store.del('six.after');
    go(after || (existing ? '#/home' : '#/in'));
  }
  function viewWelcome(mode) {
    const signin = mode === 'signin';
    // iPhone keeps home-screen apps separate from Safari: nudge people to install first, then join there
    const tip = (isIOS() && !standalone() && !signin)
      ? '<div class="card" style="margin-top:18px"><div class="label route">Tip</div><p class="small" style="margin:6px 0 0">Add it to your Home Screen first (Share → Add to Home Screen), then join from there. iPhone keeps the two separate.</p></div>' : '';
    $app.innerHTML = signin ? `
      <div class="top">${LOGO}</div>
      <div class="label route" style="margin-top:28px">Welcome back</div>
      <h1 class="h1">Already<br>a member?</h1>
      <p class="body">Sign in with the number you joined with.</p>
      <form id="f" novalidate>
        <label class="field"><span class="label">Cellphone number</span>
          <input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="082 123 4567" required></label>
        <button class="btn" type="submit">Sign in</button>
      </form>
      <a class="btn secondary" href="#" id="swap">New here? Join the club</a>
      ${demoNote()}` : `
      <div class="top">${LOGO}</div>
      <div class="label route" style="margin-top:28px">6 AM · Mamelodi</div>
      <h1 class="h1">Some clubs close at 6.<br>Ours opens.</h1>
      <p class="body">Join once, then check in at the start line on run days. Every run counts toward your streak.</p>
      <form id="f" novalidate>
        <label class="field"><span class="label">Your name</span>
          <input class="input" name="name" autocomplete="name" placeholder="Name and surname" required></label>
        <label class="field"><span class="label">Cellphone number</span>
          <input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="082 123 4567" required></label>
        <label class="check"><input type="checkbox" name="consent" required>
          <span>6ix AM Club can keep my name, number and run check-ins to run the club and contact me about runs. I can ask for them to be deleted any time.</span></label>
        <button class="btn" type="submit">Join the club</button>
      </form>
      <a class="btn secondary" href="#" id="swap">Already joined? Sign in</a>
      ${tip}
      ${demoNote()}`;
    document.getElementById('swap').onclick = e => { e.preventDefault(); viewWelcome(signin ? 'join' : 'signin'); };
    const f = document.getElementById('f');
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const phone = f.phone.value.trim();
      if (phone.replace(/\D/g, '').length < 9) return toast(ERR.phone_invalid);
      const b = f.querySelector('button[type=submit]');
      if (signin) {
        b.disabled = true; b.textContent = 'Signing in…';
        const r = await api('signin', { phone });
        if (r.ok) return signedIn(r.member, true);
        b.disabled = false; b.textContent = 'Sign in';
        if (r.error === 'no_member') { toast(ERR.no_member); return viewWelcome('join'); }
        if (r.error === 'unknown_action') { toast('Add your name too, same number as before.'); return viewWelcome('join'); }
        return toast(errMsg(r.error));
      }
      const name = f.name.value.trim();
      if (!name) return toast(ERR.name_required);
      if (!f.consent.checked) return toast('Tick the box to join.');
      b.disabled = true; b.textContent = 'Joining…';
      const r = await api('register', { name, phone, consent: true });
      if (!r.ok) { b.disabled = false; b.textContent = 'Join the club'; return toast(errMsg(r.error)); }
      signedIn(r.member, r.member.existing);
    });
  }

  /* ---------- you're in (once, right after joining) ---------- */
  const FEATURES = [['board', 'The Board'], ['live', 'Live run'], ['badges', 'Badges'], ['feed', 'Run feed']];
  async function sendVote() {
    const v = store.get('six.vote.pending', null), m = me();
    if (!v || !m) return;
    const r = await api('vote', { member_id: m.member_id, feature: v });
    if (r.ok) store.del('six.vote.pending');
  }
  async function viewIn() {
    loading();
    const m = me();
    const st = await api('status');
    const next = st.ok ? st.next : null;
    const ios = isIOS();
    const install = standalone() ? '' : `<li><b>Put it on your Home Screen.</b> ${ios ? 'Tap Share, then <i>Add to Home Screen</i>.' : 'Tap ⋮ in your browser, then <i>Add to Home screen</i>.'} One tap on run morning.</li>`;
    const runCard = next ? `<div class="card hero">
        <div class="label route">Next run</div>
        <div class="date-big">${dayMonth(next.date).day} ${esc(dayMonth(next.date).mon)}</div>
        <div class="h2">${esc(next.title)}</div>
        <div class="meta" style="margin-top:10px"><span>${esc(fmtDate(next.date))}</span><span>${esc(next.time)}</span><span>${esc(next.location)}</span></div>
        ${next.ticket_url ? `<a class="btn" href="${esc(next.ticket_url)}" target="_blank" rel="noopener">Get your ticket</a>` : ''}
      </div>` : '';
    const voted = store.get('six.vote', null);
    $app.innerHTML = `
      <div class="top">${LOGO}</div>
      <div class="label route" style="margin-top:28px">Welcome to the club</div>
      <h1 class="h1">You're in,<br>${esc(firstName(m.name))}.</h1>
      <p class="body">You're a member now. Every run you check in to counts toward your streak.</p>
      ${runCard}
      <div class="card">
        <div class="label route">What's next</div>
        <ol class="steps">
          ${next && next.ticket_url ? '<li><b>Get your ticket</b> on Quicket (button above).</li>' : ''}
          <li><b>On the morning,</b> scan the club QR at the start line. That's your check-in.</li>
          ${install}
          <li><b>Run updates</b> come from <a href="${esc(CFG.CLUB_IG || '#')}" target="_blank" rel="noopener">@6ixamclub_</a>.</li>
        </ol>
      </div>
      <div class="card">
        <div class="label route">Help shape the app</div>
        <p class="body" style="margin:8px 0 0">What should we build next? One tap.</p>
        <div class="vote">${FEATURES.map(([k, t]) => `<button type="button" class="opt${voted === k ? ' on' : ''}" data-k="${k}">${t}</button>`).join('')}</div>
      </div>
      <a class="btn" href="#/home">Go to the app</a>
      ${demoNote()}`;
    $app.querySelectorAll('.opt').forEach(b => b.onclick = async () => {
      $app.querySelectorAll('.opt').forEach(x => x.classList.toggle('on', x === b));
      store.set('six.vote', b.dataset.k); store.set('six.vote.pending', b.dataset.k);
      toast('Noted. Thanks for the vote.');
      sendVote();
    });
  }

  async function viewHome() {
    loading();
    sendVote();
    const m = me();
    const [st, mine] = await Promise.all([api('status'), api('me', { member_id: m.member_id })]);
    if (!mine.ok && mine.error === 'member_not_found') { store.del('six.member'); return go('#/'); }
    const next = st.ok ? st.next : null;
    const s = mine.ok ? mine.stats : { total: 0, streak: 0 };
    const isToday = next && next.date === (st.today || today());
    let runCard = `<div class="card hero"><div class="label">Next run</div><p class="body">No run posted yet. Check back soon.</p></div>`;
    if (next) {
      const dm = dayMonth(next.date);
      const tickets = next.ticket_url
        ? `<a class="btn" href="${esc(next.ticket_url)}" target="_blank" rel="noopener">Book the run</a>`
        : `<button class="btn" disabled>Tickets coming soon</button>`;
      runCard = `<div class="card hero">
          <div class="label route">${isToday ? 'Today' : 'Next run'}</div>
          <div class="date-big">${dm.day} ${esc(dm.mon)}</div>
          <div class="h2">${esc(next.title)}</div>
          <div class="meta" style="margin-top:10px"><span>${esc(fmtDate(next.date))}</span><span>${esc(next.time)}</span><span>${esc(next.location)}</span></div>
          ${tickets}
        </div>`;
    }
    $app.innerHTML = `
      <div class="top">${LOGO}<a class="pill" href="#/me"><svg width="11" height="13" viewBox="0 0 12 14" fill="currentColor" aria-hidden="true"><path d="M6 0S1 4 1 8a5 5 0 0010 0c0-2-1-3-1-3s-1 2-2 2 0-4-2-7z"/></svg>${s.streak} run streak</a></div>
      <div class="label">${esc(new Date().toLocaleDateString('en-ZA', { weekday: 'long', timeZone: TZ }))}</div>
      <h1 class="h1">Morning, ${esc(firstName(m.name))}.</h1>
      ${runCard}
      <div class="card">
        <div class="label route">Check in</div>
        <p class="body" style="margin:8px 0 0">${isToday ? 'At the start line? Open your camera and scan the club QR code.' : 'On run day, scan the club QR code at the start line with your camera.'}</p>
      </div>
      <div class="stats">
        <a class="stat" href="#/me" style="text-decoration:none"><span class="label">Runs</span><b>${s.total}</b></a>
        <a class="stat" href="#/me" style="text-decoration:none"><span class="label">Streak</span><b class="route">${s.streak}</b></a>
      </div>
      <div class="label" style="margin-top:26px">In development</div>
      <div class="grid">
        ${soonTile('board', 'The Board')}${soonTile('live', 'Live run')}${soonTile('badges', 'Badges')}${soonTile('feed', 'Run feed')}
      </div>
      <div class="foot"><a class="small" href="${esc(CFG.CLUB_IG || '#')}" target="_blank" rel="noopener">@6ixamclub_</a></div>
      ${demoNote()}`;
  }
  const soonTile = (k, t) => `<a class="soon" href="#/soon/${k}"><span class="tag">Soon</span><div class="h2">${t}</div></a>`;

  const SOON = {
    board: ['The Board', 'A club leaderboard ranked by showing up, not by splits. Built on your check-ins, so every run you scan in already counts.'],
    live: ['Live run', 'Pace, distance and your route on the morning, with the club playlist. Keep using your usual tracker until this lands.'],
    badges: ['Badges', 'First 5K, Sunrise, 50K Club, streak badges. Earned from your check-ins and runs.'],
    feed: ['Run feed', "Photos from the morning and a note for the crew after every run."],
  };
  function viewSoon(k) {
    const [t, d] = SOON[k] || ['Coming soon', 'This part of the app is in development.'];
    $app.innerHTML = `
      <div class="top">${LOGO}<a class="pill ghost" href="#/home">Back</a></div>
      <span class="tag route" style="margin-top:28px;display:inline-block">In development</span>
      <h1 class="h1">${esc(t)}</h1>
      <p class="body">${esc(d)}</p>
      <a class="btn secondary" href="#/home">Back home</a>`;
  }

  async function viewCheckin(params) {
    const m = me();
    if (!params.run || !params.code) {
      $app.innerHTML = `<div class="top">${LOGO}</div><div class="big-tick err">?</div>
        <h1 class="h1 center">Scan the QR</h1><p class="body center">Check in by scanning the club QR code at the start line.</p>
        <a class="btn secondary" href="#/home">Home</a>`;
      return;
    }
    $app.innerHTML = `
      <div class="top">${LOGO}<a class="pill ghost" href="#/home">Home</a></div>
      <div class="label route" style="margin-top:28px">Start line</div>
      <h1 class="h1">Ready, ${esc(firstName(m.name))}?</h1>
      <p class="body">Tap to check in to today's run. It counts toward your streak.</p>
      <button class="btn" id="go">Check me in</button>
      <p class="small center" style="margin-top:14px">Not ${esc(firstName(m.name))}? <button class="linkish" id="swap">Switch profile</button></p>`;
    document.getElementById('swap').onclick = () => { store.del('six.member'); store.set('six.after', location.hash); go('#/'); };
    document.getElementById('go').onclick = async e => {
      e.target.disabled = true; e.target.textContent = 'Checking in…';
      const r = await api('checkin', { member_id: m.member_id, run_id: params.run, code: params.code });
      if (!r.ok) {
        $app.innerHTML = `<div class="top">${LOGO}</div><div class="big-tick err">!</div>
          <h1 class="h1 center">Not checked in</h1><p class="body center">${esc(errMsg(r.error))}</p>
          <a class="btn secondary" href="#/home">Home</a>`;
        return;
      }
      $app.innerHTML = `<div class="top">${LOGO}</div>
        <div class="big-tick">✓</div>
        <div class="label route center">${esc(r.run.title)}</div>
        <h1 class="h1 center">${r.already ? 'Already in.' : "You're in."}</h1>
        <p class="body center">${r.already ? 'You checked in earlier. Go run.' : `Runner #${r.count} at the start line today.`}</p>
        <div class="stats"><div class="stat"><span class="label">Runs</span><b>${r.stats.total}</b></div>
          <div class="stat"><span class="label">Streak</span><b class="route">${r.stats.streak}</b></div></div>
        <button class="btn light" id="done">Done</button>`;
      document.getElementById('done').onclick = () => go('#/home');
      history.replaceState(null, '', '#/home'); // a refresh shouldn't re-submit
    };
  }

  async function viewMe() {
    loading();
    const m = me();
    const r = await api('me', { member_id: m.member_id });
    const s = r.ok ? r.stats : { total: 0, streak: 0, history: [] };
    const items = s.history.length
      ? s.history.map(h => `<li><span>${esc(h.title || 'Club run')}<br><span class="small">${esc(fmtDate(h.date))}</span></span><span class="tag ${h.method === 'qr' ? 'route' : ''}">${h.method === 'qr' ? 'QR' : 'Organiser'}</span></li>`).join('')
      : '<li><span class="small">No runs yet. Your first check-in shows up here.</span></li>';
    $app.innerHTML = `
      <div class="top">${LOGO}<a class="pill ghost" href="#/home">Back</a></div>
      <div class="label" style="margin-top:20px">Your runs</div>
      <h1 class="h1">${esc(m.name)}</h1>
      <div class="stats"><div class="stat"><span class="label">Runs</span><b>${s.total}</b></div>
        <div class="stat"><span class="label">Streak</span><b class="route">${s.streak}</b></div></div>
      <div class="card"><div class="label">History</div><ul class="list">${items}</ul></div>
      <div class="foot"><button class="linkish" id="out">Sign out on this phone</button></div>`;
    document.getElementById('out').onclick = () => { if (confirm('Sign out on this phone? Your runs stay saved.')) { store.del('six.member'); go('#/'); } };
  }

  /* ---------- organiser ---------- */
  async function viewAdmin() {
    clearInterval(route._poll);
    let pin = sessionStorage.getItem('six.pin');
    if (!pin) {
      $app.innerHTML = `
        <div class="top">${LOGO}<a class="pill ghost" href="#/home">Exit</a></div>
        <div class="label route" style="margin-top:28px">Organisers</div>
        <h1 class="h1">Start line</h1>
        <form id="p"><label class="field"><span class="label">Organiser PIN</span>
          <input class="input" name="pin" type="password" inputmode="numeric" autocomplete="off" required></label>
          <button class="btn">Open</button></form>${demoNote()}`;
      document.getElementById('p').onsubmit = e => { e.preventDefault(); sessionStorage.setItem('six.pin', e.target.pin.value.trim()); viewAdmin(); };
      return;
    }
    loading();
    const r = await api('admin_run', { pin });
    if (!r.ok) {
      if (r.error === 'bad_pin') sessionStorage.removeItem('six.pin');
      toast(errMsg(r.error)); return r.error === 'bad_pin' ? viewAdmin() : null;
    }
    if (!r.run) { $app.innerHTML = `<div class="top">${LOGO}</div><h1 class="h1">No runs yet</h1><p class="body">Add a run to the Runs tab in the club sheet.</p>`; return; }
    const run = r.run, isToday = run.date === r.today;
    const base = location.href.split('#')[0];
    const qrUrl = `${base}#/checkin?run=${encodeURIComponent(run.run_id)}&code=${encodeURIComponent(run.code)}`;
    const walkIns = r.checkins.filter(c => !c.booked).length;
    $app.innerHTML = `
      <div class="top">${LOGO}<button class="pill ghost" id="lock">Lock</button></div>
      <div class="label route">${isToday ? 'Today · check-in open' : 'Next run · check-in opens on the day'}</div>
      <h1 class="h1">${esc(run.title)}</h1>
      <div class="meta" style="margin-top:6px"><span>${esc(fmtDate(run.date))}</span><span>${esc(run.time)}</span></div>
      <div class="qr-wrap" id="qr" aria-label="Check-in QR code"></div>
      <div class="code" aria-label="Check-in code">${esc(run.code)}</div>
      <p class="small center">Runners scan this with their phone camera.</p>
      <div class="counts">
        <div class="stat"><span class="label">In</span><b class="route">${r.checkins.length}</b></div>
        <div class="stat"><span class="label">Booked</span><b>${r.booked}</b></div>
        <div class="stat"><span class="label">Walk-ins</span><b>${r.booked ? walkIns : '–'}</b></div>
      </div>
      <div class="card">
        <div class="label">Add a runner</div>
        <input class="input" id="q" placeholder="Search name" style="margin-top:10px" autocomplete="off">
        <ul class="list" id="res"></ul>
        <details style="margin-top:8px"><summary class="small" style="cursor:pointer">New runner (no phone with them)</summary>
          <form id="nw"><div class="row"><input class="input" name="name" placeholder="Name" style="margin-top:10px">
          <input class="input" name="phone" type="tel" placeholder="Cell number" style="margin-top:10px"></div>
          <button class="btn secondary">Add + check in</button></form></details>
      </div>
      <div class="card"><div class="label">Checked in (${r.checkins.length})</div><ul class="list">
        ${r.checkins.map(c => `<li><span>${esc(c.name)}<br><span class="small">${esc(String(c.at).slice(11, 16))}</span></span>
          <span>${c.booked ? '<span class="tag ok">Booked</span> ' : ''}<span class="tag ${c.method === 'qr' ? 'route' : ''}">${c.method === 'qr' ? 'QR' : 'Added'}</span></span></li>`).join('') || '<li><span class="small">Nobody yet.</span></li>'}
      </ul></div>
      ${r.no_shows.length ? `<div class="card"><div class="label">Booked on Quicket, not checked in (${r.no_shows.length})</div><ul class="list">
        ${r.no_shows.map(b => `<li><span>${esc(b.name)}</span><span class="small">…${esc(String(b.phone).slice(-4))}</span></li>`).join('')}</ul></div>` : ''}
      ${demoNote()}`;
    new QRCode(document.getElementById('qr'), { text: qrUrl, width: 512, height: 512, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    document.getElementById('lock').onclick = () => { sessionStorage.removeItem('six.pin'); go('#/home'); };

    const inNames = new Set(r.checkins.map(c => c.name));
    const q = document.getElementById('q'), res = document.getElementById('res');
    q.oninput = () => {
      const s = q.value.trim().toLowerCase();
      res.innerHTML = !s ? '' : r.members.filter(m => m.name.toLowerCase().includes(s)).slice(0, 6).map(m =>
        `<li><span>${esc(m.name)} <span class="small">…${esc(m.last4)}</span></span>${inNames.has(m.name) ? '<span class="tag ok">In</span>' : `<button class="add-btn" data-id="${esc(m.member_id)}">Check in</button>`}</li>`).join('')
        || '<li><span class="small">No match. Add them as a new runner below.</span></li>';
    };
    res.onclick = async e => {
      const id = e.target.dataset && e.target.dataset.id; if (!id) return;
      e.target.disabled = true;
      const a = await api('admin_add', { pin, run_id: run.run_id, member_id: id });
      toast(a.ok ? (a.already ? `${a.name} was already in.` : `${a.name} checked in.`) : errMsg(a.error));
      if (a.ok) viewAdmin();
    };
    document.getElementById('nw').onsubmit = async e => {
      e.preventDefault();
      const a = await api('admin_add', { pin, run_id: run.run_id, name: e.target.name.value, phone: e.target.phone.value });
      toast(a.ok ? `${a.name} checked in.` : errMsg(a.error));
      if (a.ok) viewAdmin();
    };
    // live list: refresh every 15 s while nobody is typing
    route._poll = setInterval(() => { if (document.activeElement && document.activeElement.tagName === 'INPUT') return; if (location.hash.startsWith('#/admin')) viewAdmin(); }, 15000);
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  route();
})();
