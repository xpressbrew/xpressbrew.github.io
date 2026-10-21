/* XpressBrew owner admin. Every action is checked again by the database / server (staff only). */
(function () {
  'use strict';
  const cfg = window.XPRESS_CONFIG || {};
  const DEMO = !cfg.supabaseUrl || cfg.supabaseUrl.includes('YOUR-PROJECT');
  // Implicit flow: password-reset emails sent from here open the app on any phone.
  const sb = DEMO ? null : window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { flowType: 'implicit' } });
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const when = (d) => (d ? new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
  const PLAN = { free: 'Starter', pro: 'Pro', pro_family: 'Elite' };
  const TOPIC = { help: 'Help', billing: 'Billing', business: 'Business', privacy: 'Privacy', bug: 'Bug', idea: 'Idea', other: 'Other' };
  const RESET_REDIRECT = 'xpressbrew://auth-callback?next=reset';
  const SHORTCUTS = [
    ['App Store Connect', 'https://appstoreconnect.apple.com'], ['Google Play Console', 'https://play.google.com/console'],
    ['Supabase', 'https://supabase.com/dashboard'], ['Anthropic usage', 'https://console.anthropic.com'], ['Resend emails', 'https://resend.com/emails'],
  ];

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600);
  }
  async function run(fn, ok) {
    try { await fn(); if (ok) toast(ok); await refreshBadges(); await render(current); }
    catch (e) { toast(e.message || String(e)); }
  }
  const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  async function callFn(name, body) {
    const { data, error } = await sb.functions.invoke(name, { body });
    if (error) {
      let msg = error.message;
      try { msg = (await error.context.json()).error || msg; } catch { /* keep */ }
      throw new Error(msg);
    }
    return data;
  }

  // ───────────────────────── Data (real database) ─────────────────────────
  const real = {
    stats: async () => check(await sb.rpc('admin_stats')),
    activity: async () => check(await sb.rpc('admin_activity', { p_limit: 15 })),
    requests: async (status) => {
      let q = sb.from('support_requests').select('*').order('created_at', { ascending: false }).limit(100);
      if (status !== 'all') q = q.eq('status', status);
      return check(await q);
    },
    updateRequest: async (id, f) => check(await sb.from('support_requests').update({ ...f, updated_at: new Date().toISOString() }).eq('id', id)),
    pendingBusinesses: async () => check(await sb.from('businesses').select('*, verification_requests(evidence, created_at)').eq('status', 'pending').order('created_at')),
    allBusinesses: async () => check(await sb.from('businesses').select('*').neq('status', 'pending').order('created_at', { ascending: false })),
    reviewBusiness: async (id, approve, notes, tier) => check(await sb.rpc('review_business', { b_id: id, approve, notes, grant_tier: tier })),
    setBusiness: async (id, status, tier, note) => check(await sb.rpc('admin_set_business', { p_id: id, p_status: status, p_tier: tier, p_note: note })),
    hiddenReviews: async () => check(await sb.from('reviews').select('*, review_reports(reason, details)').eq('status', 'hidden').order('updated_at')),
    recentReviews: async () => check(await sb.from('reviews').select('*').eq('status', 'visible').order('created_at', { ascending: false }).limit(50)),
    moderate: async (id, keep) => check(await sb.rpc('moderate_review', { r_id: id, keep })),
    removeReview: async (id) => check(await sb.rpc('admin_remove_review', { p_id: id })),
    users: async (search) => check(await sb.rpc('admin_users', { p_search: search, p_limit: 100, p_offset: 0 })),
    userDetail: async (id) => check(await sb.rpc('admin_user_detail', { p_user: id })),
    grantAccess: async (id, plan, days) => check(await sb.rpc('grant_access', { p_user: id, p_plan: plan, p_days: days })),
    setStaff: async (id, on) => check(await sb.rpc('admin_set_staff', { p_user: id, p_staff: on })),
    resetPassword: async (email) => check(await sb.auth.resetPasswordForEmail(email, { redirectTo: RESET_REDIRECT })),
    accountAction: async (id, action) => callFn('admin-user', { action, userId: id }),
    subscriptions: async (search, status) => check(await sb.rpc('admin_subscriptions', { p_search: search, p_status: status })),
    beans: async (search) => check(await sb.rpc('admin_beans', { p_search: search })),
    updateBean: async (id, f) => check(await sb.rpc('admin_update_bean', { p_id: id, p_roaster: f.roaster, p_name: f.name, p_origin: f.origin, p_process: f.process, p_roast: f.roast })),
    deleteBean: async (id) => check(await sb.rpc('admin_delete_bean', { p_id: id })),
    recipes: async (search) => check(await sb.rpc('admin_recipes', { p_search: search })),
    deleteRecipe: async (id) => check(await sb.rpc('admin_delete_recipe', { p_id: id })),
    circles: async (search) => check(await sb.rpc('admin_circles', { p_search: search })),
    deleteCircle: async (id) => check(await sb.rpc('admin_delete_circle', { p_id: id })),
    codes: async () => check(await sb.from('access_codes').select('*').order('created_at', { ascending: false })),
    createCode: async (plan, days, uses, note) => check(await sb.rpc('create_access_code', { p_plan: plan, p_days: days, p_max_uses: uses, p_note: note || null })),
    setCodeActive: async (code, active) => check(await sb.from('access_codes').update({ active }).eq('code', code)),
    terms: async () => (check(await sb.from('blocked_terms').select('term').order('term')) || []).map((t) => t.term),
    addTerm: async (t) => check(await sb.from('blocked_terms').insert({ term: t })),
    removeTerm: async (t) => check(await sb.from('blocked_terms').delete().eq('term', t)),
    settings: async () => Object.fromEntries((check(await sb.from('app_settings').select('key, value, updated_at')) || []).map((r) => [r.key, r])),
    setSetting: async (key, value) => check(await sb.rpc('admin_set_setting', { p_key: key, p_value: value })),
  };

  // ───────────────────────── Demo data (no Supabase keys yet) ─────────────────────────
  const now = Date.now();
  const ago = (d) => new Date(now - d * 86400000).toISOString();
  const db = {
    requests: [
      { id: 'r1', topic: 'billing', source: 'app', name: 'Mariam', email: 'mariam@example.com', message: 'I upgraded to Pro yearly but the app still shows Starter.', status: 'open', staff_note: '', created_at: ago(0.2) },
      { id: 'r2', topic: 'help', source: 'web', name: 'Omar', email: 'omar@example.com', message: 'My machine is not found when I search. It is switched on.', status: 'open', staff_note: '', created_at: ago(1) },
      { id: 'r3', topic: 'privacy', source: 'web', name: '', email: 'old.user@example.com', message: 'Please delete my XpressBrew account.', status: 'open', staff_note: '', created_at: ago(2) },
      { id: 'r4', topic: 'idea', source: 'app', name: 'Lina', email: 'lina@example.com', message: 'Please add iced coffee recipes!', status: 'answered', staff_note: 'On roadmap', created_at: ago(6) },
    ],
    businesses: [
      { id: 'b1', name: 'Desert Bloom Roasters', kind: 'roaster', country: 'UAE', website: 'https://desertbloom.example', license_number: 'CN-4411', requested_tier: 'pro', tier: 'starter', status: 'pending', created_at: ago(1), verification_requests: [{ evidence: { links: 'instagram.com/desertbloom' } }] },
      { id: 'b2', name: 'Corner Café', kind: 'cafe', country: 'UAE', website: 'https://cornercafe.example', license_number: 'CN-2090', requested_tier: 'starter', tier: 'starter', status: 'pending', created_at: ago(3), verification_requests: [{ evidence: { links: 'cornercafe.example/about' } }] },
      { id: 'b3', name: 'Nomad Coffee Lab', kind: 'roaster', country: 'Saudi Arabia', website: 'https://nomad.example', license_number: 'SA-77', requested_tier: 'partner', tier: 'partner', status: 'verified', created_at: ago(40) },
    ],
    reviews: [
      { id: 'v1', reviewer_name: 'Ahmed', rating: 1, body: 'Worst coffee ever, total scam', status: 'hidden', created_at: ago(2), review_reports: [{ reason: 'offensive' }, { reason: 'fake' }, { reason: 'fake' }] },
      { id: 'v2', reviewer_name: 'Mariam', rating: 5, body: 'Blueberry jam and jasmine. Perfect first try.', status: 'visible', created_at: ago(1) },
      { id: 'v3', reviewer_name: 'Sara', rating: 4, body: 'Lovely, a little sour at day 5.', status: 'visible', created_at: ago(3) },
    ],
    users: [
      { id: 'u1', name: 'Sadeem', email: 'owner@example.com', region: 'AE', paid_plan: 'free', plan: 'pro_family', comp_plan: null, comp_until: null, is_admin: true, created_at: ago(30), brews: 88, reviews: 4, last_sign_in_at: ago(0.1), banned_until: null },
      { id: 'u2', name: 'Mariam', email: 'mariam@example.com', region: 'AE', paid_plan: 'pro', plan: 'pro', paid_until: ago(-300), comp_plan: null, comp_until: null, is_admin: false, created_at: ago(12), brews: 41, reviews: 7, last_sign_in_at: ago(1), banned_until: null },
      { id: 'u3', name: 'Omar', email: 'omar@example.com', region: 'SA', paid_plan: 'free', plan: 'free', comp_plan: null, comp_until: null, is_admin: false, created_at: ago(2), brews: 3, reviews: 0, last_sign_in_at: ago(2), banned_until: null },
      { id: 'u4', name: 'Coffee creator', email: 'creator@example.com', region: 'AE', paid_plan: 'free', plan: 'pro', comp_plan: 'pro', comp_until: ago(-60), is_admin: false, created_at: ago(9), brews: 19, reviews: 2, last_sign_in_at: ago(3), banned_until: null },
    ],
    subs: [
      { id: 'apple:2000001', user_id: 'u2', name: 'Mariam', email: 'mariam@example.com', store: 'apple', product_id: 'xb_pro_yearly', plan: 'pro', status: 'active', expires_at: ago(-300), auto_renew: true, is_test: false, updated_at: ago(12) },
      { id: 'google:tok-77', user_id: 'u3', name: 'Omar', email: 'omar@example.com', store: 'google', product_id: 'xb_elite', plan: 'pro_family', status: 'expired', expires_at: ago(5), auto_renew: false, is_test: false, updated_at: ago(5) },
    ],
    beans: [
      { id: 'c1', roaster: 'Nomad Coffee Lab', name: 'Ethiopia Yirgacheffe', origin: 'Ethiopia', process: 'washed', roast_level: 'light', business: 'Nomad Coffee Lab', recipes: 4, reviews: 12, created_at: ago(20) },
      { id: 'c2', roaster: 'Raw Coffee', name: 'Brazil Cerrado', origin: 'Brazil', process: 'natural', roast_level: 'medium', business: null, recipes: 2, reviews: 3, created_at: ago(8) },
    ],
    recipes: [{ id: 'p1', name: 'Yirgacheffe · roaster recipe', business: 'Nomad Coffee Lab', owner: 'Khalid', bean: 'Nomad Coffee Lab · Ethiopia Yirgacheffe', brews: 310, reviews: 9, created_at: ago(20) }],
    circles: [
      { id: 'k1', name: 'Our home', kind: 'household', owner: 'Sadeem', owner_email: 'owner@example.com', owner_plan: 'pro_family', members: 4, created_at: ago(25) },
      { id: 'k2', name: 'Office coffee club', kind: 'friends', owner: 'Mariam', owner_email: 'mariam@example.com', owner_plan: 'pro', members: 7, created_at: ago(10) },
    ],
    codes: [{ code: 'XB-7F3A-91C2', plan: 'pro', duration_days: 30, max_uses: 20, uses: 7, note: 'Beta testers', active: true, created_at: ago(5) }],
    terms: ['bastard', 'bitch', 'shit'],
    settings: { announcement: { value: { active: false, title: '', text: '', tone: 'info' } }, free_scans_per_month: { value: 3 } },
    log: [{ at: ago(0.05), staff: 'Sadeem', action: 'business verified', target: 'Nomad Coffee Lab' }, { at: ago(1), staff: 'Sadeem', action: 'create code', target: 'XB-7F3A-91C2' }],
  };
  const logDemo = (action, target) => db.log.unshift({ at: new Date().toISOString(), staff: 'Sadeem', action, target });
  const demo = {
    stats: async () => ({
      users: db.users.length, new_7d: db.users.filter((u) => Date.parse(u.created_at) > now - 7 * 864e5).length,
      paying_pro: db.users.filter((u) => u.paid_plan === 'pro').length, paying_family: db.users.filter((u) => u.paid_plan === 'pro_family').length,
      code_access: db.users.filter((u) => u.comp_plan && !u.is_admin).length, staff: db.users.filter((u) => u.is_admin).length,
      active_subscriptions: db.subs.filter((s) => s.status === 'active').length, circles: db.circles.length,
      scans_month: 3410, brews_7d: 2291, brews_30d: 9032, reviews: db.reviews.filter((r) => r.status === 'visible').length,
      open_requests: db.requests.filter((r) => r.status === 'open').length, pending_businesses: db.businesses.filter((b) => b.status === 'pending').length,
      hidden_reviews: db.reviews.filter((r) => r.status === 'hidden').length, verified_businesses: db.businesses.filter((b) => b.status === 'verified').length,
    }),
    activity: async () => db.log.slice(0, 15),
    requests: async (s) => db.requests.filter((r) => s === 'all' || r.status === s),
    updateRequest: async (id, f) => { Object.assign(db.requests.find((r) => r.id === id), f); if (f.status) logDemo('request ' + f.status, id); },
    pendingBusinesses: async () => db.businesses.filter((b) => b.status === 'pending'),
    allBusinesses: async () => db.businesses.filter((b) => b.status !== 'pending'),
    reviewBusiness: async (id, approve, notes, tier) => { const b = db.businesses.find((x) => x.id === id); Object.assign(b, { status: approve ? 'verified' : 'rejected', tier: tier || 'starter', review_notes: notes }); logDemo('business ' + b.status, b.name); },
    setBusiness: async (id, status, tier) => { const b = db.businesses.find((x) => x.id === id); Object.assign(b, { status, ...(tier ? { tier } : {}) }); logDemo('business ' + status, b.name); },
    hiddenReviews: async () => db.reviews.filter((r) => r.status === 'hidden'),
    recentReviews: async () => db.reviews.filter((r) => r.status === 'visible'),
    moderate: async (id, keep) => { db.reviews.find((r) => r.id === id).status = keep ? 'visible' : 'removed'; },
    removeReview: async (id) => { db.reviews.find((r) => r.id === id).status = 'removed'; },
    users: async (q) => db.users.filter((u) => !q || (u.name + u.email).toLowerCase().includes(q.toLowerCase())),
    userDetail: async (id) => {
      const u = db.users.find((x) => x.id === id);
      return { ...u, subscriptions: db.subs.filter((s) => s.user_id === id), circles: db.circles.filter((c) => c.owner === u.name).map((c) => ({ ...c, role: 'owner' })),
        business: null, counts: { recipes: 6, brews: u.brews, reviews: u.reviews, scans_this_month: 2, support_requests: 1 } };
    },
    grantAccess: async (id, plan, days) => { const u = db.users.find((x) => x.id === id); Object.assign(u, { comp_plan: plan, comp_until: plan && days ? new Date(now + days * 864e5).toISOString() : null, plan: plan || u.paid_plan }); logDemo(plan ? 'give free access' : 'remove free access', u.name); },
    setStaff: async (id, on) => { const u = db.users.find((x) => x.id === id); u.is_admin = on; logDemo(on ? 'make staff' : 'remove staff', u.name); },
    resetPassword: async () => {},
    accountAction: async (id, action) => {
      const i = db.users.findIndex((x) => x.id === id); const u = db.users[i];
      if (action === 'delete') db.users.splice(i, 1);
      else u.banned_until = action === 'suspend' ? ago(-36500) : null;
      logDemo(action + ' account', u.name);
    },
    subscriptions: async (q, st) => db.subs.filter((s) => (st === 'all' || (st === 'active') === (s.status === 'active')) && (!q || (s.name + s.email + s.product_id).toLowerCase().includes(q.toLowerCase()))),
    beans: async (q) => db.beans.filter((b) => !q || (b.roaster + b.name + b.origin).toLowerCase().includes(q.toLowerCase())),
    updateBean: async (id, f) => { const b = db.beans.find((x) => x.id === id); Object.assign(b, { roaster: f.roaster, name: f.name, origin: f.origin, process: f.process, roast_level: f.roast }); logDemo('edit coffee', b.roaster + ' · ' + b.name); },
    deleteBean: async (id) => { const i = db.beans.findIndex((x) => x.id === id); logDemo('delete coffee', db.beans[i].name); db.beans.splice(i, 1); },
    recipes: async (q) => db.recipes.filter((r) => !q || (r.name + r.business).toLowerCase().includes(q.toLowerCase())),
    deleteRecipe: async (id) => { const i = db.recipes.findIndex((x) => x.id === id); logDemo('remove recipe', db.recipes[i].name); db.recipes.splice(i, 1); },
    circles: async (q) => db.circles.filter((c) => !q || (c.name + c.owner + c.owner_email).toLowerCase().includes(q.toLowerCase())),
    deleteCircle: async (id) => { const i = db.circles.findIndex((x) => x.id === id); logDemo('delete circle', db.circles[i].name); db.circles.splice(i, 1); },
    codes: async () => db.codes,
    createCode: async (plan, days, uses, note) => { const code = 'XB-' + Math.random().toString(16).slice(2, 6).toUpperCase() + '-' + Math.random().toString(16).slice(2, 6).toUpperCase(); db.codes.unshift({ code, plan, duration_days: days, max_uses: uses, uses: 0, note, active: true, created_at: new Date().toISOString() }); logDemo('create code', code); return code; },
    setCodeActive: async (code, active) => { db.codes.find((c) => c.code === code).active = active; },
    terms: async () => db.terms,
    addTerm: async (t) => { db.terms.push(t); db.terms.sort(); },
    removeTerm: async (t) => { db.terms = db.terms.filter((x) => x !== t); },
    settings: async () => db.settings,
    setSetting: async (key, value) => { db.settings[key] = { value, updated_at: new Date().toISOString() }; logDemo('setting', key); },
  };
  const api = DEMO ? demo : real;

  // ───────────────────────── Views ─────────────────────────
  let current = 'overview';
  const state = { inboxStatus: 'open', userSearch: '', userDetail: null, reviewsTab: 'reported', subSearch: '', subStatus: 'active', beanSearch: '', editBean: null, recipeSearch: '', circleSearch: '' };
  const searchBar = (id, act, value, placeholder) => `<div class="toolbar"><input id="${id}" placeholder="${esc(placeholder)}" value="${esc(value)}"><button class="btn primary" data-act="${act}">Search</button></div>`;
  const statusOf = (u) => u.banned_until && Date.parse(u.banned_until) > Date.now() ? 'suspended' : null;

  const views = {
    async overview(el) {
      const [s, log] = await Promise.all([api.stats(), api.activity().catch(() => [])]);
      const tile = (label, n, alert, view) => `<div class="tile${alert ? ' alert' : ''}"${view ? ` data-goto="${view}" role="button" tabindex="0"` : ''}><div class="muted">${esc(label)}</div><div class="n">${esc(n)}</div></div>`;
      el.innerHTML = `<h1>Overview</h1><p class="muted">Live numbers from the app.</p>
        <h2>Needs your attention</h2>
        <div class="tiles">
          ${tile('Open support requests', s.open_requests, s.open_requests > 0, 'inbox')}
          ${tile('Business applications', s.pending_businesses, s.pending_businesses > 0, 'business')}
          ${tile('Reported reviews', s.hidden_reviews, s.hidden_reviews > 0, 'reviews')}
        </div>
        <h2>People & money</h2>
        <div class="tiles">
          ${tile('Users', s.users, false, 'users')}${tile('New this week', s.new_7d)}
          ${tile('Active subscriptions', s.active_subscriptions ?? '—', false, 'subs')}${tile('Pro subscribers', s.paying_pro)}${tile('Elite subscribers', s.paying_family)}
          ${tile('Free access (codes)', s.code_access)}${tile('Verified businesses', s.verified_businesses, false, 'business')}${tile('Circles', s.circles ?? '—', false, 'circles')}
        </div>
        <h2>Usage</h2>
        <div class="tiles">
          ${tile('AI scans this month', s.scans_month)}${tile('Brews (7 days)', s.brews_7d)}
          ${tile('Brews (30 days)', s.brews_30d)}${tile('Visible reviews', s.reviews)}
        </div>
        <h2>Recent staff activity</h2>
        <div class="card scroll">${log.length ? `<table class="table"><tbody>${log.map((l) => `<tr><td class="muted">${when(l.at)}</td><td><b>${esc(l.staff)}</b></td><td>${esc(l.action)}</td><td>${esc(l.target || '')}</td></tr>`).join('')}</tbody></table>` : '<span class="muted">Nothing yet.</span>'}</div>
        <h2>Shortcuts</h2>
        <div class="row">${SHORTCUTS.map(([n, u]) => `<a class="btn" href="${u}" target="_blank" rel="noopener">${esc(n)}</a>`).join('')}</div>
        <p class="muted">Revenue and refunds: App Store Connect → Sales and Trends, and Google Play Console → Financial reports.</p>`;
    },

    async inbox(el) {
      const list = await api.requests(state.inboxStatus);
      el.innerHTML = `<h1>Inbox</h1><p class="muted">Messages from the app's Help & support, the website contact form and account-deletion requests.</p>
        <div class="toolbar">${['open', 'answered', 'closed', 'all'].map((s) =>
          `<button class="btn${state.inboxStatus === s ? ' primary' : ''}" data-act="inboxFilter" data-v="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
        ${list.length ? '' : '<div class="card muted">Nothing here.</div>'}
        ${list.map((r) => `<div class="card">
          <div class="row between"><div class="row"><span class="pill ${esc(r.status)}">${esc(r.status)}</span><b>${esc(TOPIC[r.topic] || r.topic)}</b><span class="muted">from ${esc(r.source)} · ${date(r.created_at)}</span></div>
          <span class="muted">${esc(r.name || '')} ${r.email ? '&lt;' + esc(r.email) + '&gt;' : ''}</span></div>
          <div class="msg">${esc(r.message)}</div>
          ${/delete my .*account/i.test(r.message) && r.email ? `<p class="muted">Account deletion request — find the person under <button class="link" data-act="findUser" data-v="${esc(r.email)}">Users</button>, check the email matches, then Delete account.</p>` : ''}
          <label>Private note<textarea data-note="${esc(r.id)}" placeholder="Only staff see this">${esc(r.staff_note || '')}</textarea></label>
          <div class="row">
            ${r.email ? `<a class="btn primary" href="mailto:${esc(r.email)}?subject=${encodeURIComponent('Re: your XpressBrew message')}&body=${encodeURIComponent('\n\n---\nYou wrote:\n' + r.message)}" data-act="replied" data-id="${esc(r.id)}">Reply by email</a>` : ''}
            <button class="btn sage" data-act="reqStatus" data-id="${esc(r.id)}" data-v="answered">Mark answered</button>
            <button class="btn" data-act="reqStatus" data-id="${esc(r.id)}" data-v="closed">Close</button>
            ${r.status !== 'open' ? `<button class="btn" data-act="reqStatus" data-id="${esc(r.id)}" data-v="open">Reopen</button>` : ''}
            <button class="link" data-act="saveNote" data-id="${esc(r.id)}">Save note</button>
          </div></div>`).join('')}`;
    },

    async business(el) {
      const [pending, all] = await Promise.all([api.pendingBusinesses(), api.allBusinesses()]);
      el.innerHTML = `<h1>Businesses</h1><p class="muted">Approve or reject badge applications, and manage verified businesses.</p>
        <h2>Applications (${pending.length})</h2>
        ${pending.length ? '' : '<div class="card muted">No pending applications.</div>'}
        ${pending.map((b) => `<div class="card">
          <div class="row between"><h3>${esc(b.name)}</h3><span class="pill pending">wants ${esc(b.requested_tier)}</span></div>
          <div class="muted">${esc(b.kind)} · ${esc(b.country || '—')} · licence ${esc(b.license_number || '—')} · applied ${date(b.created_at)}</div>
          ${b.website ? `<a href="${esc(b.website)}" target="_blank" rel="noopener">${esc(b.website)}</a>` : ''}
          ${(b.verification_requests || []).map((v) => v.evidence && v.evidence.links ? `<div class="msg">${esc(v.evidence.links)}</div>` : '').join('')}
          <label>Note to applicant (required to reject)<textarea data-bnote="${esc(b.id)}"></textarea></label>
          <div class="row">
            <button class="btn sage" data-act="approve" data-id="${esc(b.id)}" data-tier="${esc(b.requested_tier)}">Approve as ${esc(b.requested_tier)}</button>
            <button class="btn" data-act="approve" data-id="${esc(b.id)}" data-tier="starter">Approve as starter</button>
            <button class="btn danger" data-act="reject" data-id="${esc(b.id)}">Reject</button>
          </div></div>`).join('')}
        <h2 style="margin-top:24px">All businesses</h2>
        <div class="scroll"><table class="table"><thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Plan</th><th>Actions</th></tr></thead><tbody>
        ${all.map((b) => `<tr><td>${esc(b.name)}</td><td>${esc(b.kind)}</td><td><span class="pill ${esc(b.status)}">${esc(b.status)}</span></td>
          <td><select data-tier="${esc(b.id)}">${['starter', 'pro', 'partner'].map((t) => `<option ${b.tier === t ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
          <td class="row"><button class="link" data-act="bizTier" data-id="${esc(b.id)}" data-status="${esc(b.status)}">Save plan</button>
          ${b.status === 'verified' ? `<button class="link" data-act="bizStatus" data-id="${esc(b.id)}" data-v="suspended">Suspend</button>` : `<button class="link" data-act="bizStatus" data-id="${esc(b.id)}" data-v="verified">${b.status === 'rejected' ? 'Approve' : 'Reinstate'}</button>`}</td></tr>`).join('')}
        </tbody></table></div>`;
    },

    async reviews(el) {
      const reported = state.reviewsTab === 'reported';
      const list = reported ? await api.hiddenReviews() : await api.recentReviews();
      el.innerHTML = `<h1>Reviews</h1><p class="muted">Reviews reported by 3 people are hidden until you decide.</p>
        <div class="toolbar"><button class="btn${reported ? ' primary' : ''}" data-act="revTab" data-v="reported">Reported</button>
        <button class="btn${!reported ? ' primary' : ''}" data-act="revTab" data-v="recent">Latest reviews</button></div>
        ${list.length ? '' : '<div class="card muted">Nothing to review.</div>'}
        ${list.map((r) => `<div class="card">
          <div class="row between"><div class="row"><span class="stars">${'★'.repeat(r.rating)}</span><b>${esc(r.reviewer_name)}</b><span class="muted">${date(r.created_at)}</span></div><span class="pill ${esc(r.status)}">${esc(r.status)}</span></div>
          ${r.body ? `<div class="msg">${esc(r.body)}</div>` : ''}
          ${r.review_reports ? `<div class="muted">Reported for: ${esc(r.review_reports.map((x) => x.reason).join(', '))}</div>` : ''}
          <div class="row">${reported
            ? `<button class="btn sage" data-act="keep" data-id="${esc(r.id)}">Keep (show again)</button><button class="btn danger" data-act="remove" data-id="${esc(r.id)}">Remove</button>`
            : `<button class="btn danger" data-act="remove" data-id="${esc(r.id)}">Remove</button>`}</div></div>`).join('')}`;
    },

    async users(el) {
      const [list, detail] = await Promise.all([api.users(state.userSearch), state.userDetail ? api.userDetail(state.userDetail).catch(() => null) : null]);
      el.innerHTML = `<h1>Users</h1><p class="muted">Search, open a person to see everything about them, give free access, make staff, send a password reset, suspend or delete.</p>
        ${searchBar('userSearch', 'userSearch', state.userSearch, 'Search name or email')}
        ${detail ? userPanel(detail) : ''}
        <div class="scroll"><table class="table"><thead><tr><th>Person</th><th>Plan</th><th>Activity</th><th>Free access</th><th>Staff</th><th></th></tr></thead><tbody>
        ${list.map((u) => `<tr>
          <td><b>${esc(u.name)}</b>${statusOf(u) ? ' <span class="pill suspended">suspended</span>' : ''}<br><span class="muted">${esc(u.email || '')}</span><br><span class="muted">joined ${date(u.created_at)}</span></td>
          <td><span class="pill ${esc(u.plan)}">${esc(PLAN[u.plan])}</span><br><span class="muted">${u.is_admin ? 'staff' : u.comp_plan && u.plan !== u.paid_plan ? 'free access' + (u.comp_until ? ' until ' + date(u.comp_until) : ' (forever)') : u.paid_plan !== 'free' ? 'paying' + (u.paid_until ? ' · renews ' + date(u.paid_until) : '') : ''}</span></td>
          <td class="muted">${esc(u.brews)} brews · ${esc(u.reviews)} reviews${u.last_sign_in_at ? '<br>last seen ' + date(u.last_sign_in_at) : ''}</td>
          <td><div class="row"><select data-gplan="${esc(u.id)}" title="Free access plan"><option value="pro"${u.comp_plan === 'pro' ? ' selected' : ''}>Pro</option><option value="pro_family"${u.comp_plan === 'pro_family' ? ' selected' : ''}>Elite</option><option value="">Remove</option></select>
            <select data-gdays="${esc(u.id)}" title="Length"><option value="30">30 days</option><option value="90">3 months</option><option value="365">1 year</option><option value=""${u.comp_plan && !u.comp_until ? ' selected' : ''}>Forever</option></select>
            <button class="link" data-act="grant" data-id="${esc(u.id)}">Apply</button></div></td>
          <td>${u.is_admin ? `<button class="link" data-act="staff" data-id="${esc(u.id)}" data-v="0">Remove staff</button>` : `<button class="link" data-act="staff" data-id="${esc(u.id)}" data-v="1">Make staff</button>`}</td>
          <td><button class="btn" data-act="userOpen" data-id="${esc(u.id)}">Details</button></td>
        </tr>`).join('')}</tbody></table></div>`;
    },

    async subs(el) {
      const list = await api.subscriptions(state.subSearch, state.subStatus);
      el.innerHTML = `<h1>Subscriptions</h1><p class="muted">Every App Store and Google Play subscription, as checked with Apple and Google. Refunds and cancellations are done by the person in their store account (or by Apple/Google).</p>
        <div class="toolbar">${['active', 'ended', 'all'].map((s) => `<button class="btn${state.subStatus === s ? ' primary' : ''}" data-act="subStatus" data-v="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
        ${searchBar('subSearch', 'subSearch', state.subSearch, 'Search name, email or product')}
        ${list.length ? '' : '<div class="card muted">No subscriptions here yet.</div>'}
        ${list.length ? `<div class="scroll"><table class="table"><thead><tr><th>Person</th><th>Store</th><th>Plan</th><th>Status</th><th>Ends / renews</th><th></th></tr></thead><tbody>
        ${list.map((s) => `<tr><td><b>${esc(s.name || '—')}</b><br><span class="muted">${esc(s.email || '')}</span></td>
          <td>${s.store === 'apple' ? 'App Store' : 'Google Play'}${s.is_test ? ' <span class="pill closed">test</span>' : ''}<br><span class="muted">${esc(s.product_id)}</span></td>
          <td><span class="pill ${esc(s.plan)}">${esc(PLAN[s.plan])}</span></td>
          <td><span class="pill ${s.status === 'active' ? 'verified' : s.status === 'cancelled' || s.status === 'grace' ? 'pending' : 'closed'}">${esc(s.status)}</span>${s.auto_renew === false ? '<br><span class="muted">auto-renew off</span>' : ''}</td>
          <td>${date(s.expires_at)}</td>
          <td>${s.user_id ? `<button class="link" data-act="userOpen" data-id="${esc(s.user_id)}">Open person</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : ''}`;
    },

    async beans(el) {
      const list = await api.beans(state.beanSearch);
      const edit = state.editBean && list.find((b) => b.id === state.editBean);
      el.innerHTML = `<h1>Coffees</h1><p class="muted">Every coffee page in the app (created by bag scans and roasters). Fix a name, or delete a page — its reviews go with it; recipes stay.</p>
        ${searchBar('beanSearch', 'beanSearch', state.beanSearch, 'Search roaster, coffee or origin')}
        ${edit ? `<div class="card"><h3>Edit coffee</h3>
          <div class="row"><label>Roaster<input id="beanRoaster" value="${esc(edit.roaster)}"></label><label>Name<input id="beanName" value="${esc(edit.name)}"></label>
          <label>Origin<input id="beanOrigin" value="${esc(edit.origin || '')}"></label><label>Process<input id="beanProcess" value="${esc(edit.process || '')}"></label>
          <label>Roast<select id="beanRoast">${['', 'light', 'medium-light', 'medium', 'medium-dark', 'dark'].map((r) => `<option ${edit.roast_level === r ? 'selected' : ''} value="${r}">${r || '—'}</option>`).join('')}</select></label></div>
          <div class="row"><button class="btn primary" data-act="beanSave" data-id="${esc(edit.id)}">Save</button><button class="btn" data-act="beanCancel">Cancel</button></div></div>` : ''}
        ${list.length ? `<div class="scroll"><table class="table"><thead><tr><th>Coffee</th><th>Origin</th><th>Claimed by</th><th>Recipes</th><th>Reviews</th><th></th></tr></thead><tbody>
        ${list.map((b) => `<tr><td><b>${esc(b.name)}</b><br><span class="muted">${esc(b.roaster)}</span></td><td>${esc([b.origin, b.process, b.roast_level].filter(Boolean).join(' · ') || '—')}</td>
          <td>${esc(b.business || '—')}</td><td>${esc(b.recipes)}</td><td>${esc(b.reviews)}</td>
          <td class="row"><button class="link" data-act="beanEdit" data-id="${esc(b.id)}">Edit</button><button class="link" data-act="beanDelete" data-id="${esc(b.id)}">Delete</button></td></tr>`).join('')}
        </tbody></table></div>` : '<div class="card muted">No coffees found.</div>'}`;
    },

    async recipes(el) {
      const list = await api.recipes(state.recipeSearch);
      el.innerHTML = `<h1>Recipes</h1><p class="muted">Recipes published by verified roasters and cafés (shown to everyone). People's private and Circle recipes stay private.</p>
        ${searchBar('recipeSearch', 'recipeSearch', state.recipeSearch, 'Search recipe or business')}
        ${list.length ? `<div class="scroll"><table class="table"><thead><tr><th>Recipe</th><th>Business</th><th>Coffee</th><th>Brews</th><th>Reviews</th><th></th></tr></thead><tbody>
        ${list.map((r) => `<tr><td><b>${esc(r.name)}</b><br><span class="muted">by ${esc(r.owner || '—')} · ${date(r.created_at)}</span></td><td>${esc(r.business)}</td><td>${esc(r.bean || '—')}</td>
          <td>${esc(r.brews)}</td><td>${esc(r.reviews)}</td><td><button class="link" data-act="recipeDelete" data-id="${esc(r.id)}">Take down</button></td></tr>`).join('')}
        </tbody></table></div>` : '<div class="card muted">No published recipes yet.</div>'}`;
    },

    async circles(el) {
      const list = await api.circles(state.circleSearch);
      el.innerHTML = `<h1>Circles</h1><p class="muted">Households and friends groups. A household's size limit follows the owner's plan (Starter 2, Pro 4, Elite 6).</p>
        ${searchBar('circleSearch', 'circleSearch', state.circleSearch, 'Search circle, owner name or email')}
        ${list.length ? `<div class="scroll"><table class="table"><thead><tr><th>Circle</th><th>Owner</th><th>Owner plan</th><th>Members</th><th>Created</th><th></th></tr></thead><tbody>
        ${list.map((c) => `<tr><td><b>${esc(c.name)}</b><br><span class="muted">${esc(c.kind)}</span></td><td>${esc(c.owner || '—')}<br><span class="muted">${esc(c.owner_email || '')}</span></td>
          <td><span class="pill ${esc(c.owner_plan)}">${esc(PLAN[c.owner_plan] || c.owner_plan)}</span></td><td>${esc(c.members)}</td><td>${date(c.created_at)}</td>
          <td><button class="link" data-act="circleDelete" data-id="${esc(c.id)}">Delete</button></td></tr>`).join('')}
        </tbody></table></div>` : '<div class="card muted">No circles found.</div>'}`;
    },

    async codes(el) {
      const list = await api.codes();
      el.innerHTML = `<h1>Access codes</h1>
        <p class="muted">For testers using development or TestFlight builds. App Store and Google Play builds use store offer codes instead (create those in App Store Connect and Play Console). To give one person free access, use Users → Free access.</p>
        <div class="card"><h3>New code</h3>
          <div class="row"><label>Plan<select id="codePlan"><option value="pro">Pro</option><option value="pro_family">Elite</option></select></label>
          <label>Length<select id="codeDays"><option value="7">7 days</option><option value="30" selected>30 days</option><option value="90">3 months</option><option value="365">1 year</option><option value="">Forever</option></select></label>
          <label>People<input id="codeUses" type="number" min="1" max="10000" value="1" style="width:100px"></label>
          <label style="flex:1">Note<input id="codeNote" placeholder="Who it's for"></label></div>
          <div><button class="btn primary" data-act="createCode">Create code</button></div></div>
        ${list.map((c) => `<div class="card"><div class="row between"><b style="font-size:18px;letter-spacing:1px">${esc(c.code)}</b>${c.active ? '<span class="pill verified">active</span>' : '<span class="pill closed">off</span>'}</div>
          <div class="muted">${esc(PLAN[c.plan])} · ${c.duration_days ? esc(c.duration_days) + ' days' : 'forever'} · used ${esc(c.uses)}/${esc(c.max_uses)}${c.note ? ' · ' + esc(c.note) : ''}</div>
          <div class="row"><button class="link" data-act="copy" data-v="${esc(c.code)}">Copy</button><button class="link" data-act="codeActive" data-v="${esc(c.code)}" data-on="${c.active ? 0 : 1}">${c.active ? 'Turn off' : 'Turn on'}</button></div></div>`).join('')}`;
    },

    async filter(el) {
      const terms = await api.terms();
      el.innerHTML = `<h1>Word filter</h1><p class="muted">Reviews and replies containing these whole words are rejected. Links are always blocked.</p>
        <div class="toolbar"><input id="newTerm" placeholder="Add a word"><button class="btn primary" data-act="addTerm">Add</button></div>
        <div class="card"><div class="row">${terms.map((t) => `<span class="pill">${esc(t)} <button class="link" aria-label="Remove ${esc(t)}" data-act="removeTerm" data-v="${esc(t)}">×</button></span>`).join('')}</div></div>`;
    },

    async settings(el) {
      const s = await api.settings();
      const a = (s.announcement && s.announcement.value) || { active: false, title: '', text: '', tone: 'info' };
      const free = s.free_scans_per_month ? s.free_scans_per_month.value : 3;
      el.innerHTML = `<h1>App settings</h1><p class="muted">These change the app straight away for everyone — no app update needed.</p>
        <div class="card"><h3>Announcement on the Home screen</h3>
          <label class="row" style="gap:8px"><input id="annActive" type="checkbox" ${a.active ? 'checked' : ''} style="width:auto;min-height:auto"> Show the announcement</label>
          <label>Title (up to 60 characters)<input id="annTitle" maxlength="60" value="${esc(a.title)}" placeholder="New roasts this week"></label>
          <label>Text (up to 280 characters)<textarea id="annText" maxlength="280" placeholder="Nomad Roasters published 3 new verified recipes.">${esc(a.text)}</textarea></label>
          <p class="muted">Arabic version (optional) — people using the app in Arabic see this. Leave empty to show the English to everyone.</p>
          <label>Arabic title<input id="annTitleAr" dir="rtl" lang="ar" maxlength="60" value="${esc(a.title_ar || '')}" placeholder="محاصيل جديدة هذا الأسبوع"></label>
          <label>Arabic text<textarea id="annTextAr" dir="rtl" lang="ar" maxlength="280" placeholder="نشرت محمصة نوماد ٣ وصفات موثّقة جديدة.">${esc(a.text_ar || '')}</textarea></label>
          <label>Style<select id="annTone"><option value="info" ${a.tone !== 'warning' ? 'selected' : ''}>Good news (green)</option><option value="warning" ${a.tone === 'warning' ? 'selected' : ''}>Important (amber)</option></select></label>
          <div class="row"><button class="btn primary" data-act="saveAnnouncement">Save announcement</button></div></div>
        <div class="card"><h3>Free AI bag scans per month (Starter plan)</h3>
          <p class="muted">Pro and Elite get 60 a month (set in the app and the scan function). Shown on the Plans and Me screens.</p>
          <div class="row"><input id="freeScans" type="number" min="0" max="100" value="${esc(free)}" style="width:120px"><button class="btn primary" data-act="saveFreeScans">Save</button></div></div>
        <div class="card"><h3>Prices and plans</h3><p class="muted">Prices, free trials and offer codes are set in App Store Connect (Monetization → Subscriptions) and Google Play Console (Monetize → Subscriptions). The app shows the store's price automatically.</p>
          <div class="row"><a class="btn" href="https://appstoreconnect.apple.com" target="_blank" rel="noopener">App Store Connect</a><a class="btn" href="https://play.google.com/console" target="_blank" rel="noopener">Google Play Console</a></div></div>`;
    },
  };

  function userPanel(d) {
    const suspended = d.banned_until && Date.parse(d.banned_until) > Date.now();
    const c = d.counts || {};
    return `<div class="card" id="userPanel"><div class="row between"><h3>${esc(d.name)} ${suspended ? '<span class="pill suspended">suspended</span>' : ''}${d.is_admin ? ' <span class="pill verified">staff</span>' : ''}</h3><button class="link" data-act="userClose">Close</button></div>
      <div class="muted">${esc(d.email || '')} · region ${esc(d.region || '—')} · joined ${date(d.created_at)} · last seen ${date(d.last_sign_in_at)}</div>
      <p><span class="pill ${esc(d.plan)}">${esc(PLAN[d.plan])}</span>
        ${d.paid_plan && d.paid_plan !== 'free' ? ` paying for ${esc(PLAN[d.paid_plan])}${d.paid_until ? ' until ' + date(d.paid_until) : ''}` : ''}
        ${d.comp_plan ? ` · free access ${esc(PLAN[d.comp_plan])}${d.comp_until ? ' until ' + date(d.comp_until) : ' (forever)'}` : ''}</p>
      <p class="muted">${esc(c.recipes ?? 0)} recipes · ${esc(c.brews ?? 0)} brews · ${esc(c.reviews ?? 0)} reviews · ${esc(c.scans_this_month ?? 0)} scans this month · ${esc(c.support_requests ?? 0)} support messages</p>
      <h3>Subscriptions</h3>${(d.subscriptions || []).length ? `<table class="table"><tbody>${d.subscriptions.map((s) => `<tr><td>${s.store === 'apple' ? 'App Store' : 'Google Play'}${s.is_test ? ' (test)' : ''}</td><td>${esc(s.product_id)}</td><td>${esc(s.status)}</td><td>${date(s.expires_at)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">None.</p>'}
      <h3>Circles</h3>${(d.circles || []).length ? `<p>${d.circles.map((k) => `${esc(k.name)} <span class="muted">(${esc(k.kind)}, ${esc(k.role)}, ${esc(k.members)} people)</span>`).join(' · ')}</p>` : '<p class="muted">None.</p>'}
      ${d.business ? `<h3>Business</h3><p>${esc(d.business.name)} <span class="pill ${esc(d.business.status)}">${esc(d.business.status)}</span> ${esc(d.business.tier)}</p>` : ''}
      <div class="row">
        ${d.email ? `<button class="btn" data-act="userReset" data-v="${esc(d.email)}">Send password-reset email</button>` : ''}
        ${suspended ? `<button class="btn sage" data-act="userAccount" data-id="${esc(d.id)}" data-v="unsuspend">Unsuspend</button>` : `<button class="btn" data-act="userAccount" data-id="${esc(d.id)}" data-v="suspend">Suspend</button>`}
        <button class="btn danger" data-act="userDelete" data-id="${esc(d.id)}" data-name="${esc(d.name)}">Delete account</button>
      </div></div>`;
  }

  async function render(view) {
    current = view;
    document.querySelectorAll('.nav').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('main section').forEach((s) => { s.hidden = s.id !== 'view-' + view; });
    const el = $('#view-' + view);
    try { await views[view](el); } catch (e) { el.innerHTML = `<div class="card error">${esc(e.message)}</div>`; }
  }

  async function refreshBadges() {
    try {
      const s = await api.stats();
      $('#badgeInbox').textContent = s.open_requests || '';
      $('#badgeBusiness').textContent = s.pending_businesses || '';
      $('#badgeReviews').textContent = s.hidden_reviews || '';
    } catch { /* ignore */ }
  }

  // ───────────────────────── Actions ─────────────────────────
  document.addEventListener('click', (ev) => {
    const nav = ev.target.closest('.nav');
    if (nav) return render(nav.dataset.view);
    const go = ev.target.closest('[data-goto]');
    if (go) return render(go.dataset.goto);
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const { act, id, v } = b.dataset;
    const val = (sel) => (document.querySelector(sel) || {}).value;
    switch (act) {
      case 'inboxFilter': state.inboxStatus = v; return render('inbox');
      case 'reqStatus': return run(() => api.updateRequest(id, { status: v }), 'Updated');
      case 'replied': setTimeout(() => run(() => api.updateRequest(id, { status: 'answered' })), 500); return; // opens the mail app
      case 'saveNote': return run(() => api.updateRequest(id, { staff_note: val(`[data-note="${id}"]`) }), 'Note saved');
      case 'findUser': state.userSearch = v; state.userDetail = null; return render('users');
      case 'approve': return run(() => api.reviewBusiness(id, true, val(`[data-bnote="${id}"]`) || 'Approved', b.dataset.tier), 'Approved — badge is live');
      case 'reject': {
        const note = (val(`[data-bnote="${id}"]`) || '').trim();
        if (!note) return toast('Write what they need to fix first');
        return run(() => api.reviewBusiness(id, false, note, null), 'Rejected — they can fix and resubmit');
      }
      case 'bizStatus': return run(() => api.setBusiness(id, v, null, v === 'suspended' ? 'Suspended by XpressBrew' : null), 'Updated');
      case 'bizTier': return run(() => api.setBusiness(id, b.dataset.status, val(`[data-tier="${id}"]`), null), 'Plan saved');
      case 'revTab': state.reviewsTab = v; return render('reviews');
      case 'keep': return run(() => api.moderate(id, true), 'Review restored');
      case 'remove': if (!confirm('Remove this review for everyone?')) return; return run(() => api.removeReview(id), 'Review removed');
      case 'userSearch': state.userSearch = val('#userSearch') || ''; return render('users');
      case 'userOpen': state.userDetail = id; return render('users').then(() => { const p = $('#userPanel'); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      case 'userClose': state.userDetail = null; return render('users');
      case 'userReset': if (!confirm(`Send a password-reset email to ${v}?`)) return; return run(() => api.resetPassword(v), 'Reset email sent');
      case 'userAccount': {
        const msg = v === 'suspend' ? 'Suspend this account? They will be signed out and can’t sign in until you unsuspend.' : 'Let this person sign in again?';
        if (!confirm(msg)) return;
        return run(() => api.accountAction(id, v), v === 'suspend' ? 'Account suspended' : 'Account unsuspended');
      }
      case 'userDelete': {
        const typed = prompt(`Delete ${b.dataset.name}'s account and all their data? This can't be undone.\n\nType DELETE to confirm.`);
        if ((typed || '').trim().toUpperCase() !== 'DELETE') return toast('Not deleted');
        state.userDetail = null;
        return run(() => api.accountAction(id, 'delete'), 'Account deleted');
      }
      case 'grant': {
        const plan = val(`[data-gplan="${id}"]`) || null;
        const days = val(`[data-gdays="${id}"]`);
        return run(() => api.grantAccess(id, plan, plan && days ? Number(days) : null), plan ? 'Free access given' : 'Free access removed');
      }
      case 'staff': if (v === '1' && !confirm('Make this person staff? They can use this admin and get every feature free.')) return;
        return run(() => api.setStaff(id, v === '1'), v === '1' ? 'Now staff' : 'Staff removed');
      case 'subStatus': state.subStatus = v; return render('subs');
      case 'subSearch': state.subSearch = val('#subSearch') || ''; return render('subs');
      case 'beanSearch': state.beanSearch = val('#beanSearch') || ''; return render('beans');
      case 'beanEdit': state.editBean = id; return render('beans');
      case 'beanCancel': state.editBean = null; return render('beans');
      case 'beanSave': return run(async () => {
        await api.updateBean(id, { roaster: val('#beanRoaster'), name: val('#beanName'), origin: val('#beanOrigin'), process: val('#beanProcess'), roast: val('#beanRoast') });
        state.editBean = null;
      }, 'Coffee saved');
      case 'beanDelete': if (!confirm('Delete this coffee page and its reviews? Recipes stay.')) return; return run(() => api.deleteBean(id), 'Coffee deleted');
      case 'recipeSearch': state.recipeSearch = val('#recipeSearch') || ''; return render('recipes');
      case 'recipeDelete': if (!confirm('Take this recipe down for everyone? Saved copies and its reviews are removed too.')) return; return run(() => api.deleteRecipe(id), 'Recipe taken down');
      case 'circleSearch': state.circleSearch = val('#circleSearch') || ''; return render('circles');
      case 'circleDelete': if (!confirm('Delete this circle? Members keep their own accounts and recipes.')) return; return run(() => api.deleteCircle(id), 'Circle deleted');
      case 'createCode': {
        const days = val('#codeDays');
        return run(async () => {
          const code = await api.createCode(val('#codePlan'), days ? Number(days) : null, Math.max(1, Number(val('#codeUses')) || 1), val('#codeNote'));
          navigator.clipboard && navigator.clipboard.writeText(code).catch(() => {});
          toast('Created ' + code + ' (copied)');
        });
      }
      case 'copy': navigator.clipboard && navigator.clipboard.writeText(v); return toast('Copied ' + v);
      case 'codeActive': return run(() => api.setCodeActive(v, b.dataset.on === '1'), 'Updated');
      case 'addTerm': {
        const t = (val('#newTerm') || '').trim().toLowerCase();
        if (!/^[a-z؀-ۿ]{2,30}$/.test(t)) return toast('Enter one word');
        return run(() => api.addTerm(t), 'Added');
      }
      case 'removeTerm': return run(() => api.removeTerm(v), 'Removed');
      case 'saveAnnouncement': return run(() => api.setSetting('announcement', {
        active: $('#annActive').checked, title: (val('#annTitle') || '').trim(), text: (val('#annText') || '').trim(),
        title_ar: (val('#annTitleAr') || '').trim(), text_ar: (val('#annTextAr') || '').trim(), tone: val('#annTone') || 'info',
      }), 'Announcement saved — the app shows it within a few minutes');
      case 'saveFreeScans': {
        const n = Number(val('#freeScans'));
        if (!Number.isInteger(n) || n < 0 || n > 100) return toast('Enter a whole number from 0 to 100');
        return run(() => api.setSetting('free_scans_per_month', n), 'Saved');
      }
    }
  });
  document.addEventListener('keydown', (e) => {
    const map = { userSearch: ['userSearch', 'users'], subSearch: ['subSearch', 'subs'], beanSearch: ['beanSearch', 'beans'], recipeSearch: ['recipeSearch', 'recipes'], circleSearch: ['circleSearch', 'circles'] };
    if (e.key === 'Enter' && map[e.target.id]) { state[map[e.target.id][0]] = e.target.value; render(map[e.target.id][1]); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset && e.target.dataset.goto) { e.preventDefault(); render(e.target.dataset.goto); }
  });

  // ───────────────────────── Sign-in ─────────────────────────
  async function start(email) {
    $('#login').hidden = true; $('#app').hidden = false;
    $('#demoBanner').hidden = !DEMO;
    $('#whoami').textContent = email;
    await refreshBadges();
    await render('overview');
  }

  async function boot() {
    if (DEMO) return start('demo@xpressbrew');
    const { data } = await sb.auth.getSession();
    if (data.session && (await isStaff())) return start(data.session.user.email);
    $('#login').hidden = false;
  }

  async function isStaff() {
    const { data, error } = await sb.rpc('admin_stats');
    return !error && !!data;
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#loginError').textContent = '';
    const { data, error } = await sb.auth.signInWithPassword({ email: $('#loginEmail').value.trim(), password: $('#loginPassword').value });
    if (error) return ($('#loginError').textContent = /banned/i.test(error.message) ? 'This account is suspended.' : 'Email or password is incorrect.');
    if (!(await isStaff())) {
      await sb.auth.signOut();
      return ($('#loginError').textContent = 'This account is not staff.');
    }
    start(data.user.email);
  });

  $('#forgotLink').addEventListener('click', async (e) => {
    e.preventDefault();
    const email = $('#loginEmail').value.trim();
    if (!email) return ($('#loginError').textContent = 'Type your email first, then tap “Forgot password”.');
    if (DEMO) return ($('#loginError').textContent = 'Demo mode.');
    await sb.auth.resetPasswordForEmail(email, { redirectTo: RESET_REDIRECT });
    $('#loginError').textContent = 'If that email has an account, a reset link is on its way. Open it on your phone with XpressBrew installed, then come back here.';
  });

  $('#signOut').addEventListener('click', async () => {
    if (sb) await sb.auth.signOut();
    location.reload();
  });

  boot();
})();
