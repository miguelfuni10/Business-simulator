// Front-end do Simulador de Empresas (JavaScript puro, sem build).

const POLL_MS = 4000;
const COLORS = ['#2456d6', '#e4572e', '#17a673', '#a14bd8', '#f2a541', '#1fb5c9', '#d6336c', '#6b8e23', '#8d6e63', '#5c6bc0', '#ef6c00', '#00897b'];

const S = {
  code: null,
  token: null,
  view: null,
  tab: 'decisions',
  selCompany: null,
  selPeriod: null,
  draft: null,
  draftPeriod: null,
  pollTimer: null,
  clockTimer: null,
};

// ---------- utilidades ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const fmtInt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const fmtMoney0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const fmtMoney2 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (x) => fmtMoney0.format(Math.round(x || 0) || 0);
const money2 = (x) => fmtMoney2.format(x || 0);
const int = (x) => fmtInt.format(Math.round(x || 0));
const pct = (x, d = 1) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })}%`);
const signPct = (x, d = 1) => (x == null ? '—' : `${x > 0 ? '+' : ''}${pct(x, d)}`);
const cls = (x) => (x > 0 ? 'good' : x < 0 ? 'bad' : '');

function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `show${isError ? ' error' : ''}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.className = ''; }, 3500);
}

function savedGames() {
  try { return JSON.parse(localStorage.getItem('bsim:games') || '{}'); } catch { return {}; }
}
function saveGame(code, token, companyName) {
  try {
    const all = savedGames();
    all[code] = { token, companyName, savedAt: Date.now() };
    localStorage.setItem('bsim:games', JSON.stringify(all));
  } catch { /* armazenamento indisponível */ }
}
function forgetGame(code) {
  try {
    const all = savedGames();
    delete all[code];
    localStorage.setItem('bsim:games', JSON.stringify(all));
  } catch { /* armazenamento indisponível */ }
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Erro ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function companyColor(id) {
  const idx = S.view.players.findIndex((p) => p.id === id);
  return COLORS[idx % COLORS.length];
}
const companyName = (id) => S.view.players.find((p) => p.id === id)?.companyName ?? '?';

// ---------- início ----------
function boot() {
  const params = new URLSearchParams(location.search);
  const code = params.get('jogo')?.toUpperCase();
  if (code && savedGames()[code]) return enterGame(code);
  renderHome(code);
}

function renderHome(prefillCode = '') {
  stopPolling();
  S.view = null;
  if (location.search) history.replaceState(null, '', location.pathname);
  const saved = Object.entries(savedGames()).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, 6);
  $('#app').innerHTML = `
    <div class="wrap">
      <section class="hero">
        <h1>📈 Simulador de Empresas</h1>
        <p>Você é o CEO. A cada período, tome <b>10 decisões</b> — preço, produção, marketing, investimentos, dívida, dividendos… —
        e dispute o mercado com seus amigos. No fim, vence quem entregar a <b>maior valorização da ação</b>.</p>
      </section>

      ${saved.length ? `
      <section class="card">
        <h2>Suas partidas</h2>
        <div class="statusbar">
          ${saved.map(([code, g]) => `<button class="btn small" data-resume="${esc(code)}">${esc(code)} · ${esc(g.companyName)}</button>`).join('')}
        </div>
      </section>` : ''}

      <div class="grid-2" style="margin-top:16px">
        <form class="card" id="create-form">
          <h2>Criar partida</h2>
          <div class="row">
            <label>Seu nome<input name="name" maxlength="30" required autocomplete="nickname"></label>
            <label>Nome da sua empresa<input name="companyName" maxlength="30" required placeholder="Ex.: Acme S.A."></label>
          </div>
          <div class="row">
            <label>Períodos (rodadas)
              <select name="totalPeriods">
                ${[5, 8, 10, 12, 15, 20, 30].map((n) => `<option value="${n}" ${n === 10 ? 'selected' : ''}>${n} períodos</option>`).join('')}
              </select>
            </label>
            <label>Ritmo
              <select name="mode">
                <option value="daily">Diário: 1 período por dia</option>
                <option value="live">Ao vivo: fecha quando todos enviarem</option>
              </select>
            </label>
          </div>
          <label id="hour-field">Horário de fechamento diário
            <select name="dailyCloseHour">
              ${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === 22 ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}
            </select>
          </label>
          <button class="btn primary block" type="submit">Criar partida</button>
        </form>

        <form class="card" id="join-form">
          <h2>Entrar em uma partida</h2>
          <label>Código da partida<input name="code" maxlength="5" required value="${esc(prefillCode || '')}" style="text-transform:uppercase;letter-spacing:.15em" placeholder="ABCDE"></label>
          <div class="row">
            <label>Seu nome<input name="name" maxlength="30" required autocomplete="nickname"></label>
            <label>Nome da sua empresa<input name="companyName" maxlength="30" required></label>
          </div>
          <button class="btn primary block" type="submit">Entrar</button>
        </form>
      </div>

      <section class="grid-3 steps">
        <div class="card step"><b>1. Monte a sala</b>Crie a partida, mande o link para os amigos e, se quiser, complete a mesa com empresas-robô.</div>
        <div class="card step"><b>2. Decida</b>Em cada período (um dia, ou uma rodada ao vivo) cada CEO envia suas 10 decisões. Todos disputam o mesmo mercado.</div>
        <div class="card step"><b>3. Analise</b>Ao fechar o período saem a DRE, o balanço, o fluxo de caixa e a nova cotação de cada empresa. Ajuste a estratégia!</div>
      </section>
      <footer>Partidas ficam salvas no servidor; seu acesso fica salvo neste navegador.</footer>
    </div>`;

  const createForm = $('#create-form');
  const syncMode = () => { $('#hour-field').style.display = createForm.mode.value === 'daily' ? '' : 'none'; };
  createForm.mode.addEventListener('change', syncMode);
  syncMode();
  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(createForm));
    try {
      const r = await api('POST', '/api/games', { ...f, tzOffset: new Date().getTimezoneOffset() });
      saveGame(r.code, r.token, f.companyName);
      enterGame(r.code);
    } catch (err) { toast(err.message, true); }
  });
  const joinForm = $('#join-form');
  joinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(joinForm));
    const code = f.code.trim().toUpperCase();
    try {
      const r = await api('POST', `/api/games/${encodeURIComponent(code)}/join`, f);
      saveGame(r.code, r.token, f.companyName);
      enterGame(r.code);
    } catch (err) { toast(err.message, true); }
  });
  $$('[data-resume]').forEach((b) => b.addEventListener('click', () => enterGame(b.dataset.resume)));
}

async function enterGame(code) {
  S.code = code;
  S.token = savedGames()[code]?.token;
  S.view = null;
  S.draft = null;
  S.tab = 'decisions';
  history.replaceState(null, '', `?jogo=${code}`);
  try {
    await refresh();
    startPolling();
  } catch (err) {
    if (err.status === 403 || err.status === 404) {
      forgetGame(code);
      toast(err.message, true);
      renderHome(err.status === 403 ? code : '');
    } else {
      toast(err.message, true);
    }
  }
}

function startPolling() {
  stopPolling();
  S.pollTimer = setInterval(() => refresh().catch(() => {}), POLL_MS);
  S.clockTimer = setInterval(updateClock, 1000);
}
function stopPolling() {
  clearInterval(S.pollTimer);
  clearInterval(S.clockTimer);
}

async function refresh() {
  const since = S.view ? `&since=${S.view.version}` : '';
  const data = await api('GET', `/api/games/${S.code}?token=${encodeURIComponent(S.token)}${since}`);
  if (data.unchanged) return;
  const prev = S.view;
  S.view = data;
  S.clockSkew = data.serverTime - Date.now();
  onViewChange(prev);
}

function onViewChange(prev) {
  const v = S.view;
  const periodClosed = prev && prev.history.length < v.history.length;
  if (periodClosed) {
    S.selPeriod = null;
    if (v.status === 'finished') {
      S.tab = 'market';
      toast('Fim de jogo! Confira o ranking final.');
    } else {
      S.tab = 'results';
      toast(`Período ${v.history.at(-1).period} fechado! Veja os resultados.`);
    }
  }
  if (prev && prev.status === 'lobby' && v.status === 'running') S.tab = 'decisions';
  if (v.status === 'finished' && S.tab === 'decisions') S.tab = 'market';
  const sameScreen = prev && prev.status === v.status && prev.period === v.period && !periodClosed;
  if (sameScreen && S.tab === 'decisions' && v.status === 'running') {
    renderStatus();
    return;
  }
  render();
}

// ---------- telas ----------
function render() {
  const v = S.view;
  if (v.status === 'lobby') return renderLobby();
  const me = v.me;
  const tabs = [
    ...(v.status === 'running' ? [['decisions', 'Decisões']] : []),
    ['results', 'Resultados'],
    ['market', v.status === 'finished' ? 'Ranking final' : 'Mercado & ranking'],
    ['news', 'Notícias'],
    ['help', 'Como jogar'],
  ];
  if (!tabs.some(([k]) => k === S.tab)) S.tab = tabs[0][0];
  $('#app').innerHTML = `
    <div class="topbar"><div class="wrap">
      <a class="brand" href="/" id="home-link">📈 Simulador</a>
      <span class="pill">Partida <b>${esc(v.code)}</b></span>
      <span class="pill">${v.status === 'finished' ? 'Encerrada' : `Período <b>${v.period}</b> de ${v.settings.totalPeriods}`}</span>
      <span class="pill" id="clock" ${v.nextDeadline ? '' : 'hidden'}></span>
      <span class="spacer"></span>
      <span><span class="dot" style="background:${companyColor(me.id)}"></span><b>${esc(me.companyName)}</b> <small>· ${esc(me.name)}</small></span>
    </div></div>
    <div class="wrap">
      <div id="status"></div>
      <nav class="tabs">${tabs.map(([k, label]) => `<button data-tab="${k}" class="${S.tab === k ? 'active' : ''}">${label}</button>`).join('')}</nav>
      <main id="tab"></main>
      <footer>Código da partida: <b>${esc(v.code)}</b> · <button class="link-btn" id="leave">Sair desta partida neste navegador</button></footer>
    </div>`;
  $('#home-link').addEventListener('click', (e) => { e.preventDefault(); renderHome(); });
  $('#leave').addEventListener('click', () => {
    if (confirm('Remover o acesso a esta partida deste navegador? Você não conseguirá voltar sem o link de acesso.')) {
      forgetGame(v.code);
      renderHome();
    }
  });
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => { S.tab = b.dataset.tab; render(); }));
  renderStatus();
  updateClock();
  const tab = $('#tab');
  if (S.tab === 'decisions') renderDecisions(tab);
  else if (S.tab === 'results') renderResults(tab);
  else if (S.tab === 'market') renderMarket(tab);
  else if (S.tab === 'news') renderNews(tab);
  else renderHelp(tab);
}

function renderStatus() {
  const el = $('#status');
  if (!el) return;
  const v = S.view;
  if (v.status !== 'running') { el.innerHTML = ''; return; }
  const humans = v.players.filter((p) => !p.isBot);
  const done = humans.filter((p) => p.submitted).length;
  el.innerHTML = `
    <div class="statusbar">
      <small>Decisões do período ${v.period}: <b>${done}/${humans.length}</b> CEOs enviaram</small>
      ${v.players.map((p) => `<span class="chip ${p.submitted ? 'ok' : ''}" title="${esc(p.name)}">${p.submitted ? '✓' : '…'} ${esc(p.companyName)}${p.isBot ? ' 🤖' : ''}</span>`).join('')}
      ${v.me.isHost ? '<span class="spacer"></span><button class="btn small" id="force-close">Fechar período agora</button>' : ''}
    </div>`;
  $('#force-close')?.addEventListener('click', async () => {
    const missing = humans.length - done;
    const msg = missing > 0
      ? `${missing} CEO(s) ainda não enviaram. Eles repetirão as decisões do período anterior. Fechar o período ${v.period} agora?`
      : `Fechar o período ${v.period} agora?`;
    if (!confirm(msg)) return;
    try {
      await api('POST', `/api/games/${S.code}/close`, { token: S.token });
      await refresh();
    } catch (err) { toast(err.message, true); }
  });
}

function updateClock() {
  const el = $('#clock');
  const v = S.view;
  if (!el || !v?.nextDeadline) return;
  const ms = v.nextDeadline - (Date.now() + (S.clockSkew || 0));
  if (ms <= 0) { el.textContent = 'Fechando…'; return; }
  const h = Math.floor(ms / 3.6e6);
  const m = Math.floor((ms % 3.6e6) / 6e4);
  const s = Math.floor((ms % 6e4) / 1000);
  const when = new Date(v.nextDeadline).toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  el.textContent = `⏰ Fecha ${when} (em ${h}h${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s)`;
}

// ---------- lobby ----------
function renderLobby() {
  const v = S.view;
  const link = `${location.origin}${location.pathname}?jogo=${v.code}`;
  const profiles = v.rules.botProfiles;
  $('#app').innerHTML = `
    <div class="topbar"><div class="wrap">
      <a class="brand" href="/" id="home-link">📈 Simulador</a>
      <span class="pill">Sala de espera</span>
    </div></div>
    <div class="wrap" style="margin-top:24px">
      <div class="grid-2">
        <section class="card">
          <h2>Convide seus amigos</h2>
          <p class="muted">Envie o link ou o código. Cada um entra com o próprio nome e empresa.</p>
          <div class="code-big">${esc(v.code)}</div>
          <div class="share-link" style="margin-top:12px">
            <input readonly value="${esc(link)}" id="share-url">
            <button class="btn" id="copy-link">Copiar</button>
          </div>
          <p class="muted" style="margin-top:16px">
            ${v.settings.totalPeriods} períodos ·
            ${v.settings.mode === 'daily'
              ? `1 período por dia, fechando às ${String(v.settings.dailyCloseHour).padStart(2, '0')}:00`
              : 'ao vivo: o período fecha quando todos enviarem'}
          </p>
        </section>
        <section class="card">
          <h2>Empresas (${v.players.length})</h2>
          <ul class="players">
            ${v.players.map((p) => `
              <li>
                <span><span class="dot" style="background:${companyColor(p.id)}"></span><b>${esc(p.companyName)}</b>
                  <small>· ${esc(p.name)}${p.isHost ? ' (anfitrião)' : ''}</small></span>
                ${v.me.isHost && !p.isHost ? `<button class="btn small" data-remove="${p.id}">Remover</button>` : ''}
              </li>`).join('')}
          </ul>
          ${v.me.isHost ? `
            <div class="row" style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
              <select id="bot-profile" style="flex:1 1 160px">
                ${Object.entries(profiles).map(([k, p]) => `<option value="${k}">Robô ${esc(p.label)}</option>`).join('')}
              </select>
              <button class="btn" id="add-bot">+ Adicionar robô</button>
            </div>
            <button class="btn primary block" id="start" style="margin-top:16px">Começar partida</button>
            <p class="muted" style="font-size:.85rem">Depois de começar, ninguém mais entra.</p>`
          : '<p class="muted" style="margin-top:16px">Aguardando o anfitrião começar a partida…</p>'}
        </section>
      </div>
    </div>`;
  $('#home-link').addEventListener('click', (e) => { e.preventDefault(); renderHome(); });
  $('#copy-link').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link); toast('Link copiado!'); } catch { $('#share-url').select(); }
  });
  $('#add-bot')?.addEventListener('click', () => hostAction('bots', { profile: $('#bot-profile').value }));
  $('#start')?.addEventListener('click', () => hostAction('start', {}));
  $$('[data-remove]').forEach((b) => b.addEventListener('click', () => hostAction('remove', { playerId: b.dataset.remove })));
}

async function hostAction(action, body) {
  try {
    await api('POST', `/api/games/${S.code}/${action}`, { token: S.token, ...body });
    await refresh();
  } catch (err) { toast(err.message, true); }
}

// ---------- decisões ----------
function unitCost(units, salaryPct, materialMult) {
  const C = S.view.rules.config;
  const salary = salaryPct / 100;
  const scale = Math.pow(Math.max(units, 1000) / 10000, -0.05);
  return C.materialCost * materialMult * scale + (C.laborCost * salary) / (0.6 + 0.4 * salary);
}

function estimate(d) {
  const v = S.view;
  const C = v.rules.config;
  const c = v.companies[v.me.id];
  const env = v.env;
  const produced = clamp(d.production, 0, c.capacity);
  const uc = unitCost(produced, d.salary, env.materialMult);
  const productionCost = produced * uc;
  const admin = C.adminFixed + C.adminSalaryLinked * d.salary / 100;
  const loan = d.loan > 0 ? Math.min(d.loan, Math.max(0, c.creditLimit - c.debt)) : -Math.min(-d.loan, c.debt, Math.max(0, c.cash));
  const issue = d.shares > 0 ? Math.min(d.shares, c.shares * C.maxIssuePct) * c.price * (1 - C.issueDiscount) : 0;
  const buyback = d.shares < 0 ? Math.min(-d.shares, c.shares * C.maxBuybackPct) * c.price * (1 + C.buybackPremium) : 0;
  const debt = c.debt + loan;
  const equity = c.equity + issue;
  const rate = env.interestRate + Math.min(0.05, 0.01 * Math.max(0, (equity > 0 ? debt / equity : Infinity) - 0.5));
  const interest = debt * rate;
  const financialIncome = Math.max(0, c.cash) * env.interestRate * C.cashYieldShare;
  const depreciation = c.fixedAssets * C.depreciationRate;
  const cashBeforeSales = c.cash + c.receivables + loan + issue + financialIncome
    - productionCost - d.marketing - d.rnd - admin - interest - d.capex - d.dividends - buyback;
  const available = c.inventoryUnits + produced;
  const cashShare = 1 - d.creditDays / C.periodDays;
  const margin = d.price - uc;
  const fixed = d.marketing + d.rnd + admin + depreciation + interest - financialIncome;
  return {
    produced, uc, productionCost, admin, loan, issue, buyback, interest, rate, financialIncome, depreciation,
    cashBeforeSales, available, cashShare, margin,
    breakEven: margin > 0 ? fixed / margin : Infinity,
    revenueIfAll: available * d.price,
    capped: d.production > c.capacity,
    loanCapped: d.loan > 0 && loan < d.loan,
  };
}

function marketStats() {
  const last = S.view.history.at(-1);
  if (!last) return null;
  const reps = Object.values(last.reports);
  const avg = (f) => reps.reduce((s, r) => s + f(r), 0) / reps.length;
  return {
    price: avg((r) => r.decisions.price),
    marketing: avg((r) => r.decisions.marketing),
    rnd: avg((r) => r.decisions.rnd),
    salary: avg((r) => r.decisions.salary),
    creditDays: avg((r) => r.decisions.creditDays),
    mine: last.reports[S.view.me.id],
  };
}

function renderDecisions(tab) {
  const v = S.view;
  if (!S.draft || S.draftPeriod !== v.period) {
    S.draft = { ...(v.myDecisions ?? v.lastDecisions) };
    S.draftPeriod = v.period;
  }
  const c = v.companies[v.me.id];
  const env = v.env;
  const m = marketStats();
  const hints = {
    price: m ? `Último período: você cobrou ${money2(m.mine.decisions.price)} · média do mercado ${money2(m.price)}` : `Preço de referência do mercado: ${money(v.rules.config.refPrice)}`,
    production: `Capacidade neste período: <b>${int(c.capacity)}</b> un. · em estoque: ${int(c.inventoryUnits)} un.${m ? ` · sua demanda no último período: ${int(m.mine.operations.demand)} un.` : ''}`,
    marketing: m ? `Média do mercado no último período: ${money(m.marketing)}` : '',
    rnd: m ? `Média do mercado no último período: ${money(m.rnd)}` : '',
    capex: `Depreciação deste período: ${money(c.fixedAssets * v.rules.config.depreciationRate)} — investir isso apenas mantém a capacidade.`,
    salary: m ? `Média do mercado: ${Math.round(m.salary)}%` : '',
    creditDays: m ? `Média do mercado: ${Math.round(m.creditDays)} dias` : '',
    loan: `Dívida atual: ${money(c.debt)} · limite de crédito: ${money(c.creditLimit)} · juros base ${pct(env.interestRate)} por período`,
    dividends: `Caixa atual: ${money(c.cash)} · ${int(c.shares)} ações`,
    shares: `Cotação: ${money2(c.price)} · ${int(c.shares)} ações · recompra máx. ${int(c.shares * v.rules.config.maxBuybackPct)}`,
  };
  tab.innerHTML = `
    <div class="decide">
      <form class="card" id="decision-form" novalidate>
        <h2>Suas 10 decisões para o período ${v.period}</h2>
        <p class="muted" style="margin:0">Você pode reenviar quantas vezes quiser até o fechamento. Quem não enviar repete as decisões do período anterior.</p>
        ${v.rules.decisions.map((def, i) => `
          <div class="field">
            <label for="d-${def.key}"><span class="n">${i + 1}.</span>${esc(def.label)} <span class="unit">(${esc(def.unit)})</span></label>
            ${def.key === 'creditDays'
              ? `<select id="d-${def.key}" name="${def.key}">${[0, 30, 60, 90].map((x) => `<option value="${x}" ${S.draft[def.key] === x ? 'selected' : ''}>${x === 0 ? 'À vista' : `${x} dias`}</option>`).join('')}</select>`
              : `<input id="d-${def.key}" name="${def.key}" type="number" inputmode="decimal" step="${def.step}" min="${def.min}" max="${def.max}" value="${S.draft[def.key]}">`}
            <p class="help">${esc(def.help)}</p>
            ${hints[def.key] ? `<p class="hint">${hints[def.key]}</p>` : ''}
          </div>`).join('')}
      </form>
      <aside class="side">
        <section class="card">
          <h3>Cenário do período ${v.period}</h3>
          ${env.event ? `<div class="event"><b>${esc(env.event.title)}</b><br><small>${esc(env.event.text)}</small></div>` : '<small>Sem grandes notícias. Mercado em ritmo normal.</small>'}
          <div class="kv" style="margin-top:10px">
            <span>Previsão de demanda</span><span class="num ${cls(env.demandMult - 1)}">${signPct(env.demandMult - 1)}</span>
            <span>Custo da matéria-prima</span><span class="num ${cls(1 - env.materialMult)}">${signPct(env.materialMult - 1)}</span>
            <span>Juros básicos / período</span><span class="num">${pct(env.interestRate, 2)}</span>
          </div>
        </section>
        <section class="card">
          <h3>Sua empresa agora</h3>
          <div class="kv">
            <span>Cotação da ação</span><span class="num">${money2(c.price)} <small class="${cls(c.tsr)}">(${signPct(c.tsr)})</small></span>
            <span>Caixa</span><span class="num">${money(c.cash)}</span>
            <span>A receber (entra agora)</span><span class="num">${money(c.receivables)}</span>
            <span>Estoque</span><span class="num">${int(c.inventoryUnits)} un.</span>
            <span>Dívida</span><span class="num">${money(c.debt)}</span>
            <span>Patrimônio líquido</span><span class="num">${money(c.equity)}</span>
            <span>Reputação</span><span class="num">${pct(c.reputation, 0)}</span>
          </div>
        </section>
        <section class="card" id="budget"></section>
        <button class="btn primary block" id="submit-decisions">${v.myDecisions ? 'Atualizar decisões' : 'Enviar decisões'}</button>
        <p class="muted" style="margin:0;text-align:center;font-size:.85rem">${v.myDecisions ? '✓ Decisões enviadas. Aguardando os demais.' : 'Você ainda não enviou neste período.'}</p>
      </aside>
    </div>`;

  const form = $('#decision-form');
  form.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.name) return;
    const val = Number(t.value);
    S.draft[t.name] = Number.isFinite(val) ? val : 0;
    renderBudget();
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  $('#submit-decisions').addEventListener('click', async () => {
    const btn = $('#submit-decisions');
    btn.disabled = true;
    try {
      await api('POST', `/api/games/${S.code}/decisions`, { token: S.token, period: v.period, decisions: S.draft });
      toast('Decisões enviadas!');
      S.view.myDecisions = { ...S.draft };
      await refresh();
      if (S.tab === 'decisions' && S.view.status === 'running' && S.view.period === v.period) render();
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
      if (err.status === 409) refresh();
    }
  });
  renderBudget();
}

function renderBudget() {
  const el = $('#budget');
  if (!el) return;
  const d = S.draft;
  const e = estimate(d);
  const C = S.view.rules.config;
  const warnings = [];
  if (e.capped) warnings.push(`A produção será limitada à capacidade (${int(e.produced)} un.).`);
  if (e.loanCapped) warnings.push(`O banco só libera ${money(e.loan)} (limite de crédito).`);
  if (e.margin <= 0) warnings.push('Seu preço não cobre nem o custo variável por unidade!');
  const notes = [];
  if (e.cashBeforeSales < 0) {
    const needed = -e.cashBeforeSales;
    const line = `Para o caixa não ficar negativo, você precisa vender ao menos ${money(needed)} à vista (≈ ${int(needed / (d.price * e.cashShare || 1))} un.). Se faltar, o banco cobre com empréstimo emergencial e multa de ${pct(C.emergencyFeeRate, 0)}.`;
    if (needed > 0.7 * e.revenueIfAll * e.cashShare) warnings.push(line);
    else notes.push(line);
  }
  if (d.dividends > 0 && e.cashBeforeSales < 0) warnings.push('Dividendos só são pagos com caixa disponível.');
  el.innerHTML = `
    <h3>Orçamento estimado</h3>
    <div class="kv">
      <span>Caixa + recebimentos</span><span class="num">${money(S.view.companies[S.view.me.id].cash + S.view.companies[S.view.me.id].receivables)}</span>
      <span>Financiamento (empréstimo/ações)</span><span class="num">${money(e.loan + e.issue - e.buyback)}</span>
      <span>Produção (${int(e.produced)} × ${money2(e.uc)})</span><span class="num">−${money(e.productionCost)}</span>
      <span>Marketing + P&amp;D</span><span class="num">−${money(d.marketing + d.rnd)}</span>
      <span>Administração</span><span class="num">−${money(e.admin)}</span>
      <span>Juros (${pct(e.rate, 2)}) − rendimento</span><span class="num">−${money(e.interest - e.financialIncome)}</span>
      <span>Investimento na fábrica</span><span class="num">−${money(d.capex)}</span>
      <span>Dividendos</span><span class="num">−${money(d.dividends)}</span>
      <span class="total">Caixa antes das vendas</span><span class="num total ${cls(e.cashBeforeSales)}">${money(e.cashBeforeSales)}</span>
    </div>
    <div class="kv" style="margin-top:10px">
      <span>Margem por unidade</span><span class="num ${cls(e.margin)}">${money2(e.margin)}</span>
      <span>Ponto de equilíbrio</span><span class="num">${Number.isFinite(e.breakEven) ? `${int(e.breakEven)} un.` : '—'}</span>
      <span>Unidades disponíveis</span><span class="num">${int(e.available)} un.</span>
      <span>Receita se vender tudo</span><span class="num">${money(e.revenueIfAll)}</span>
    </div>
    ${notes.map((w) => `<p class="muted" style="font-size:.85rem;margin:8px 0 0">${w}</p>`).join('')}
    ${warnings.map((w) => `<div class="warn">${w}</div>`).join('')}
    <p class="muted" style="font-size:.78rem;margin:8px 0 0">Estimativa antes de impostos e estocagem. A demanda real depende das decisões dos concorrentes.</p>`;
}

// ---------- resultados ----------
function renderResults(tab) {
  const v = S.view;
  if (!v.history.length) {
    tab.innerHTML = '<div class="card"><p>Os primeiros resultados aparecem quando o período 1 fechar.</p></div>';
    return;
  }
  const period = S.selPeriod ?? v.history.at(-1).period;
  const companyId = S.selCompany ?? v.me.id;
  const h = v.history.find((x) => x.period === period) ?? v.history.at(-1);
  const r = h.reports[companyId];
  const isMe = companyId === v.me.id;
  const i = r.income;
  const b = r.balance;
  const cf = r.cashflow;
  const o = r.operations;
  const st = r.stock;
  const row = (label, value, opts = {}) => `<tr class="${opts.strong ? 'strong' : ''}"><td>${label}</td><td class="num ${opts.color ? cls(value) : ''}">${opts.fmt ? opts.fmt(value) : money(value)}</td></tr>`;
  const neg = (x) => (x ? -x : 0);

  tab.innerHTML = `
    <div class="card" style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">
      <label style="margin:0;flex:1 1 200px">Empresa
        <select id="sel-company">${v.players.map((p) => `<option value="${p.id}" ${p.id === companyId ? 'selected' : ''}>${esc(p.companyName)}${p.id === v.me.id ? ' (você)' : ''}</option>`).join('')}</select>
      </label>
      <label style="margin:0;flex:0 1 160px">Período
        <select id="sel-period">${v.history.map((x) => `<option value="${x.period}" ${x.period === h.period ? 'selected' : ''}>Período ${x.period}</option>`).join('')}</select>
      </label>
    </div>
    ${isMe && h.autoSubmitted.includes(v.me.id) ? '<div class="warn">Você não enviou decisões neste período: foram repetidas as do período anterior.</div>' : ''}
    <div class="grid-3" style="margin-top:16px">
      <section class="card">
        <h3>Ação</h3>
        <div class="kv">
          <span>Cotação</span><span class="num">${money2(st.price)}</span>
          <span>Variação no período</span><span class="num ${cls(st.change)}">${signPct(st.change)}</span>
          <span>Valorização total (c/ dividendos)</span><span class="num ${cls(st.tsr)}">${signPct(st.tsr)}</span>
          <span>Lucro por ação (LPA)</span><span class="num">${money2(st.eps)}</span>
          <span>Valor patrimonial / ação</span><span class="num">${money2(st.bvps)}</span>
          <span>Dividendos / ação</span><span class="num">${money2(st.dividendsPerShare)}</span>
          <span>Ações em circulação</span><span class="num">${int(st.shares)}</span>
          <span>Valor de mercado</span><span class="num">${money(st.marketCap)}</span>
        </div>
      </section>
      <section class="card">
        <h3>Operações</h3>
        <div class="kv">
          <span>Demanda</span><span class="num">${int(o.demand)} un.</span>
          <span>Vendas</span><span class="num">${int(o.sales)} un.</span>
          <span>Demanda não atendida</span><span class="num ${o.unmet > 0 ? 'bad' : ''}">${int(o.unmet)} un.</span>
          <span>Participação de mercado</span><span class="num">${pct(o.marketShare)}</span>
          <span>Produção / capacidade</span><span class="num">${int(o.produced)} / ${int(o.capacity)} (${pct(o.utilization, 0)})</span>
          <span>Custo unitário de produção</span><span class="num">${money2(o.unitCost)}</span>
          <span>Estoque final</span><span class="num">${int(o.inventoryUnits)} un.</span>
          <span>Reputação</span><span class="num">${pct(o.reputation, 0)}</span>
          <span>Força da marca</span><span class="num">${o.brandIndex.toFixed(2)}×</span>
          <span>Qualidade do produto</span><span class="num">${o.qualityIndex.toFixed(2)}×</span>
          <span>Capacidade no próximo período</span><span class="num">${int(o.nextCapacity)} un.</span>
        </div>
      </section>
      <section class="card">
        <h3>Indicadores</h3>
        <div class="kv">
          <span>Margem bruta</span><span class="num">${pct(r.indicators.grossMargin)}</span>
          <span>Margem líquida</span><span class="num ${cls(r.indicators.netMargin)}">${pct(r.indicators.netMargin)}</span>
          <span>ROE do período</span><span class="num ${cls(r.indicators.roe)}">${pct(r.indicators.roe)}</span>
          <span>Dívida / patrimônio</span><span class="num">${r.indicators.debtToEquity == null ? '—' : r.indicators.debtToEquity.toFixed(2)}</span>
          <span>Juros pagos (taxa)</span><span class="num">${pct(r.appliedFinance.interestRate, 2)}</span>
        </div>
        ${cf.emergencyLoan > 0 ? `<div class="warn">O caixa ficou negativo: empréstimo emergencial de ${money(cf.emergencyLoan)} com multa de ${money(i.emergencyFee)}.</div>` : ''}
      </section>
    </div>
    <div class="grid-3" style="margin-top:16px">
      <section class="card">
        <h3>DRE — Demonstração do Resultado</h3>
        <table><tbody>
          ${row('Receita de vendas', i.revenue)}
          ${row('(−) Custo dos produtos vendidos', neg(i.cogs))}
          ${row('= Lucro bruto', i.grossProfit, { strong: true })}
          ${row('(−) Marketing', neg(i.marketing))}
          ${row('(−) Pesquisa &amp; Desenvolvimento', neg(i.rnd))}
          ${row('(−) Administração e salários', neg(i.admin))}
          ${row('(−) Estocagem', neg(i.carrying))}
          ${row('(−) Inadimplência', neg(i.badDebt))}
          ${row('(−) Depreciação', neg(i.depreciation))}
          ${row('= Lucro operacional (EBIT)', i.ebit, { strong: true, color: true })}
          ${row('(+) Rendimento do caixa', i.financialIncome)}
          ${row('(−) Juros', neg(i.interest))}
          ${row('= Lucro antes do IR', i.ebt, { strong: true })}
          ${row('(−) IR e CSLL (34%)', neg(i.tax))}
          ${i.emergencyFee ? row('(−) Multa do empréstimo emergencial', neg(i.emergencyFee)) : ''}
          ${row('= Lucro líquido', i.netIncome, { strong: true, color: true })}
        </tbody></table>
      </section>
      <section class="card">
        <h3>Balanço patrimonial</h3>
        <table><tbody>
          ${row('Caixa', b.cash)}
          ${row('Contas a receber', b.receivables)}
          ${row('Estoques', b.inventory)}
          ${row('Imobilizado (fábrica)', b.fixedAssets)}
          ${row('Total do ativo', b.totalAssets, { strong: true })}
          ${row('Empréstimos', b.debt)}
          ${row('Patrimônio líquido', b.equity, { color: true })}
          ${row('Total passivo + PL', b.totalLiabilitiesAndEquity, { strong: true })}
        </tbody></table>
      </section>
      <section class="card">
        <h3>Fluxo de caixa</h3>
        <table><tbody>
          ${row('Caixa inicial', cf.begin)}
          ${row('(+) Recebimento de vendas anteriores', cf.collections)}
          ${row('(+) Vendas à vista', cf.cashSales)}
          ${row('= Fluxo operacional (líquido)', cf.operating, { strong: true, color: true })}
          ${row('Fluxo de investimentos', cf.investing, { color: true })}
          ${row('Fluxo de financiamentos', cf.financing, { color: true })}
          ${row('Caixa final', cf.end, { strong: true })}
        </tbody></table>
        <h3 style="margin-top:16px">Decisões tomadas</h3>
        <table><tbody>
          ${v.rules.decisions.map((def) => `<tr><td>${esc(def.label)}</td><td class="num">${fmtDecision(def, r.decisions[def.key])}</td></tr>`).join('')}
        </tbody></table>
      </section>
    </div>`;
  $('#sel-company').addEventListener('change', (e) => { S.selCompany = e.target.value; render(); });
  $('#sel-period').addEventListener('change', (e) => { S.selPeriod = Number(e.target.value); render(); });
}

function fmtDecision(def, value) {
  if (def.unit.startsWith('R$/')) return money2(value);
  if (def.unit.startsWith('R$')) return money(value);
  if (def.key === 'salary') return `${value}%`;
  if (def.key === 'creditDays') return value === 0 ? 'À vista' : `${value} dias`;
  return int(value);
}

// ---------- mercado & ranking ----------
function rankingRows() {
  const v = S.view;
  const last = v.history.at(-1);
  return v.players
    .map((p) => {
      const c = v.companies[p.id];
      const r = last?.reports[p.id];
      return { p, c, r, tsr: c.tsr };
    })
    .sort((a, b) => b.tsr - a.tsr);
}

function renderMarket(tab) {
  const v = S.view;
  const rows = rankingRows();
  const periods = [0, ...v.history.map((h) => h.period)];
  const priceSeries = v.players.map((p) => ({
    id: p.id,
    name: p.companyName,
    values: [v.rules.config.initialPrice, ...v.history.map((h) => h.reports[p.id].stock.price + h.reports[p.id].stock.cumDividendsPerShare)],
  }));
  const shareSeries = v.players.map((p) => ({
    id: p.id,
    name: p.companyName,
    values: [null, ...v.history.map((h) => h.reports[p.id].operations.marketShare)],
  }));
  const medals = ['🥇', '🥈', '🥉'];
  tab.innerHTML = `
    ${v.status === 'finished' ? `
      <section class="card" style="text-align:center">
        <h2>🏆 ${esc(rows[0].p.companyName)} venceu!</h2>
        <p class="muted">CEO: ${esc(rows[0].p.name)} · valorização total de <b class="${cls(rows[0].tsr)}">${signPct(rows[0].tsr)}</b></p>
        <div class="podium">
          ${[1, 0, 2].filter((k) => rows[k]).map((k) => `
            <div class="p${k + 1}">
              <div class="medal">${medals[k]}</div>
              <b>${esc(rows[k].p.companyName)}</b><br>
              <span class="${cls(rows[k].tsr)}">${signPct(rows[k].tsr)}</span>
            </div>`).join('')}
        </div>
      </section>` : ''}
    <section class="card">
      <h2>Ranking — valorização da ação</h2>
      <p class="muted" style="margin-top:0">Valorização total = (cotação atual + dividendos recebidos por ação) ÷ cotação inicial (R$ ${v.rules.config.initialPrice},00) − 1.</p>
      <div class="table-scroll"><table>
        <thead><tr><th>#</th><th>Empresa</th><th class="num">Cotação</th><th class="num">Dividendos/ação</th><th class="num">Valorização</th><th class="num">Último lucro</th><th class="num">Participação</th><th class="num">Caixa</th><th class="num">Dívida</th></tr></thead>
        <tbody>
          ${rows.map((x, k) => `
            <tr class="${x.p.id === v.me.id ? 'me' : ''}">
              <td>${medals[k] ?? k + 1}</td>
              <td><span class="dot" style="background:${companyColor(x.p.id)}"></span>${esc(x.p.companyName)} <small>${esc(x.p.name)}${x.p.isBot ? ' 🤖' : ''}</small></td>
              <td class="num">${money2(x.c.price)}</td>
              <td class="num">${money2(x.c.cumDividendsPerShare)}</td>
              <td class="num ${cls(x.tsr)}"><b>${signPct(x.tsr)}</b></td>
              <td class="num ${cls(x.r?.income.netIncome)}">${x.r ? money(x.r.income.netIncome) : '—'}</td>
              <td class="num">${x.c.marketShare == null ? '—' : pct(x.c.marketShare)}</td>
              <td class="num">${money(x.c.cash)}</td>
              <td class="num">${money(x.c.debt)}</td>
            </tr>`).join('')}
        </tbody>
      </table></div>
    </section>
    <div class="grid-2" style="margin-top:16px">
      <section class="card chart">
        <h3>Cotação + dividendos acumulados (R$)</h3>
        ${lineChart(priceSeries, periods, (x) => money2(x))}
      </section>
      <section class="card chart">
        <h3>Participação de mercado</h3>
        ${v.history.length ? lineChart(shareSeries, periods, (x) => pct(x, 0)) : '<p class="muted">Disponível após o primeiro período.</p>'}
      </section>
    </div>
    ${v.history.length ? comparisonTable() : ''}`;
}

function comparisonTable() {
  const v = S.view;
  const h = v.history.at(-1);
  const metrics = [
    ['Preço', (r) => money2(r.decisions.price)],
    ['Produção', (r) => int(r.decisions.production)],
    ['Vendas (un.)', (r) => int(r.operations.sales)],
    ['Não atendida (un.)', (r) => int(r.operations.unmet)],
    ['Marketing', (r) => money(r.decisions.marketing)],
    ['P&D', (r) => money(r.decisions.rnd)],
    ['Investimento fábrica', (r) => money(r.decisions.capex)],
    ['Salário', (r) => `${r.decisions.salary}%`],
    ['Prazo', (r) => `${r.decisions.creditDays} d`],
    ['Receita', (r) => money(r.income.revenue)],
    ['Lucro líquido', (r) => `<span class="${cls(r.income.netIncome)}">${money(r.income.netIncome)}</span>`],
    ['Dividendos', (r) => money(r.appliedFinance.dividends)],
    ['Variação da ação', (r) => `<span class="${cls(r.stock.change)}">${signPct(r.stock.change)}</span>`],
  ];
  return `
    <section class="card" style="margin-top:16px">
      <h3>Comparativo do período ${h.period} (dados publicados)</h3>
      <div class="table-scroll"><table>
        <thead><tr><th></th>${v.players.map((p) => `<th class="num"><span class="dot" style="background:${companyColor(p.id)}"></span>${esc(p.companyName)}</th>`).join('')}</tr></thead>
        <tbody>${metrics.map(([label, f]) => `<tr><td>${label}</td>${v.players.map((p) => `<td class="num">${f(h.reports[p.id])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      <p class="muted" style="font-size:.85rem;margin-bottom:0">Mercado: demanda total de ${int(h.market.totalDemand)} un., preço médio ${money2(h.market.avgPrice)}.</p>
    </section>`;
}

function lineChart(series, labels, fmt) {
  const W = 560;
  const H = 260;
  const pad = { l: 64, r: 12, t: 12, b: 28 };
  const all = series.flatMap((s) => s.values.filter((x) => x != null));
  if (!all.length) return '';
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (max - min < 1e-9) { max += 1; min -= 1; }
  const span = max - min;
  min -= span * 0.08;
  max += span * 0.08;
  const n = labels.length;
  const x = (i) => pad.l + (n <= 1 ? 0 : (i * (W - pad.l - pad.r)) / (n - 1));
  const y = (val) => pad.t + ((max - val) * (H - pad.t - pad.b)) / (max - min);
  const ticks = Array.from({ length: 5 }, (_, k) => min + ((max - min) * k) / 4);
  const step = Math.max(1, Math.ceil(n / 10));
  const lines = series.map((s) => {
    const pts = s.values.map((val, i) => (val == null ? null : `${x(i).toFixed(1)},${y(val).toFixed(1)}`)).filter(Boolean);
    const color = companyColor(s.id);
    const width = s.id === S.view.me.id ? 3.5 : 2;
    const lastIdx = s.values.length - 1;
    return `<polyline fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round" points="${pts.join(' ')}"><title>${esc(s.name)}</title></polyline>
      ${s.values[lastIdx] != null ? `<circle cx="${x(lastIdx)}" cy="${y(s.values[lastIdx])}" r="3.5" fill="${color}"><title>${esc(s.name)}: ${fmt(s.values[lastIdx])}</title></circle>` : ''}`;
  });
  return `
    <svg viewBox="0 0 ${W} ${H}" role="img">
      ${ticks.map((tv) => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(tv)}" y2="${y(tv)}"/><text x="${pad.l - 6}" y="${y(tv) + 4}" text-anchor="end">${fmt(tv)}</text>`).join('')}
      ${labels.map((lb, i) => (i % step === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${lb === 0 ? 'início' : `P${lb}`}</text>` : '')).join('')}
      ${lines.join('')}
    </svg>
    <div class="legend">${series.map((s) => `<span><span class="dot" style="background:${companyColor(s.id)}"></span>${esc(s.name)}</span>`).join('')}</div>`;
}

// ---------- notícias ----------
function headlines(h) {
  const v = S.view;
  const reps = Object.entries(h.reports);
  const out = [];
  const best = reps.reduce((a, b) => (b[1].stock.change > a[1].stock.change ? b : a));
  const worst = reps.reduce((a, b) => (b[1].stock.change < a[1].stock.change ? b : a));
  const leader = reps.reduce((a, b) => (b[1].operations.sales > a[1].operations.sales ? b : a));
  const cheapest = reps.reduce((a, b) => (b[1].decisions.price < a[1].decisions.price ? b : a));
  out.push(`📈 <b>${esc(companyName(best[0]))}</b> foi o destaque da bolsa: ${signPct(best[1].stock.change)} no período.`);
  if (worst[0] !== best[0]) out.push(`📉 <b>${esc(companyName(worst[0]))}</b> teve a pior variação: ${signPct(worst[1].stock.change)}.`);
  out.push(`🏭 <b>${esc(companyName(leader[0]))}</b> liderou as vendas com ${pct(leader[1].operations.marketShare)} do mercado.`);
  out.push(`🏷️ Preço mais agressivo: <b>${esc(companyName(cheapest[0]))}</b>, a ${money2(cheapest[1].decisions.price)} por unidade.`);
  for (const [id, r] of reps) {
    if (r.operations.unmet > r.operations.demand * 0.05) out.push(`📦 Faltou produto na <b>${esc(companyName(id))}</b>: ${int(r.operations.unmet)} clientes saíram de mãos vazias.`);
    if (r.cashflow.emergencyLoan > 0) out.push(`🚨 <b>${esc(companyName(id))}</b> ficou sem caixa e precisou de empréstimo emergencial de ${money(r.cashflow.emergencyLoan)}.`);
    if (r.appliedFinance.dividends > 0) out.push(`💰 <b>${esc(companyName(id))}</b> pagou ${money(r.appliedFinance.dividends)} em dividendos.`);
    if (r.appliedFinance.buybackShares > 0) out.push(`🔁 <b>${esc(companyName(id))}</b> recomprou ${int(r.appliedFinance.buybackShares)} ações.`);
    if (r.appliedFinance.issuedShares > 0) out.push(`🧾 <b>${esc(companyName(id))}</b> emitiu ${int(r.appliedFinance.issuedShares)} novas ações.`);
    if (r.income.netIncome < 0) out.push(`🔻 <b>${esc(companyName(id))}</b> registrou prejuízo de ${money(-r.income.netIncome)}.`);
  }
  if (h.autoSubmitted.length) out.push(`😴 Não enviaram decisões: ${h.autoSubmitted.map((id) => `<b>${esc(companyName(id))}</b>`).join(', ')}.`);
  return out.slice(0, 14).map((x) => `<li>${x}</li>`).join('');
}

function renderNews(tab) {
  const v = S.view;
  const items = [];
  if (v.status === 'running') {
    items.push(`
      <section class="card">
        <h3>Agora — período ${v.period}</h3>
        ${v.env.event ? `<div class="event"><b>${esc(v.env.event.title)}</b><br>${esc(v.env.event.text)}</div>` : '<p class="muted">Sem grandes notícias.</p>'}
      </section>`);
  }
  for (const h of [...v.history].reverse()) {
    items.push(`
      <section class="card">
        <h3>Período ${h.period}</h3>
        ${h.env.event ? `<div class="event"><b>${esc(h.env.event.title)}</b><br><small>${esc(h.env.event.text)}</small></div>` : ''}
        <ul>${headlines(h)}</ul>
      </section>`);
  }
  tab.innerHTML = items.join('');
}

// ---------- ajuda ----------
function renderHelp(tab) {
  const v = S.view;
  const C = v.rules.config;
  tab.innerHTML = `
    <section class="card prose">
      <h2>Como jogar</h2>
      <p>Todas as empresas fabricam o mesmo tipo de produto e disputam <b>o mesmo mercado</b>. Cada período representa um trimestre
      contábil. Você envia 10 decisões; quando o período fecha, o simulador calcula a demanda, as vendas, os demonstrativos e a nova
      cotação da ação de todo mundo ao mesmo tempo.</p>
      <h3>Como a demanda é dividida</h3>
      <ul>
        <li><b>Preço</b> relativo à média do mercado é o fator mais forte. Se todos sobem o preço, o mercado total encolhe.</li>
        <li><b>Marca</b> (marketing acumulado) e <b>qualidade</b> (P&amp;D acumulado) atraem clientes, com retornos decrescentes.</li>
        <li><b>Salários</b> melhores melhoram o atendimento; <b>prazo</b> maior atrai clientes.</li>
        <li><b>Reputação</b> cai quando falta produto. Metade dos clientes não atendidos vai para concorrentes com estoque.</li>
      </ul>
      <h3>Como a ação é precificada</h3>
      <p>O mercado olha o <b>patrimônio por ação</b> e o quanto a empresa rende acima do custo de capital
      (${pct(C.costOfEquity)} por período, maior se você estiver muito endividado). Lucros consistentes, crescimento de receita e
      investimentos em marca/P&amp;D são valorizados; cortar tudo no último período para inflar o lucro não engana os investidores.
      Há também um pouco de humor do mercado (sorte). O ranking usa a <b>valorização total</b>: cotação + dividendos pagos.</p>
      <h3>As 10 decisões</h3>
      <ol>${v.rules.decisions.map((d) => `<li><b>${esc(d.label)}</b> (${esc(d.unit)}): ${esc(d.help)}</li>`).join('')}</ol>
      <h3>Regras contábeis</h3>
      <ul>
        <li>Estoque avaliado ao custo médio. Estocagem: ${money2(C.inventoryCarryCost)} por unidade por período.</li>
        <li>Depreciação de ${pct(C.depreciationRate, 0)} do imobilizado por período. Capacidade = imobilizado ÷ ${money(C.capitalPerUnit)}.</li>
        <li>IR + CSLL de ${pct(C.taxRate, 0)} sobre o lucro, com compensação de prejuízos anteriores.</li>
        <li>Caixa aplicado rende ${pct(C.cashYieldShare, 0)} da taxa básica. Se o caixa ficar negativo, o banco cobre com um
          empréstimo emergencial e multa de ${pct(C.emergencyFeeRate, 0)}.</li>
        <li>Inadimplência de ${pct(C.badDebtPer30Days)} da receita para cada 30 dias de prazo concedido.</li>
      </ul>
      <h3>Dicas</h3>
      <ul>
        <li>Use o painel <b>Orçamento estimado</b> para não ficar sem caixa.</li>
        <li>Olhe o <b>comparativo</b> na aba Mercado: os demonstrativos de todas as empresas são públicos.</li>
        <li>Capacidade leva um período para ficar pronta — planeje o crescimento com antecedência.</li>
      </ul>
    </section>`;
}

boot();
