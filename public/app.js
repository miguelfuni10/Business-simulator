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
  moves: null,
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

// Versão de teste (artefato): o jogo inteiro roda no navegador, sem servidor.
const LOCAL = typeof window.LOCAL_API === 'function' ? window.LOCAL_API : null;

function setUrl(url) {
  try { history.replaceState(null, '', url); } catch { /* ambiente sem histórico (ex.: artefato) */ }
}

/** Confirmação dentro da página (o navegador do artefato não exibe confirm()). */
function askConfirm(message, okLabel = 'Confirmar') {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-text">
        <p id="modal-text">${esc(message)}</p>
        <div class="modal-actions">
          <button class="btn" id="modal-cancel">Cancelar</button>
          <button class="btn primary" id="modal-ok">${esc(okLabel)}</button>
        </div>
      </div>`;
    const close = (answer) => { wrap.remove(); resolve(answer); };
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(false); });
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(false); });
    document.body.append(wrap);
    $('#modal-cancel', wrap).addEventListener('click', () => close(false));
    $('#modal-ok', wrap).addEventListener('click', () => close(true));
    $('#modal-ok', wrap).focus();
  });
}

async function api(method, url, body) {
  if (LOCAL) return LOCAL(method, url, body);
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

const DEADLINE_OPTIONS = [
  ['5', '5 minutos'], ['10', '10 minutos'], ['15', '15 minutos'], ['30', '30 minutos'],
  ['60', '1 hora'], ['120', '2 horas'], ['240', '4 horas'], ['480', '8 horas'], ['720', '12 horas'],
  ['1440', '24 horas'], ['daily', 'Todo dia num horário fixo'], ['none', 'Sem prazo (espera todos)'],
];

function deadlineText(st) {
  const early = st.closeEarly ?? st.mode === 'live';
  let text;
  if (st.mode === 'daily') text = `prazo: todo dia às ${String(st.dailyCloseHour).padStart(2, '0')}:00`;
  else if (st.mode === 'timer') text = `prazo de ${DEADLINE_OPTIONS.find(([v]) => Number(v) === st.periodMinutes)?.[1] ?? `${st.periodMinutes} min`} por período`;
  else return 'sem prazo: o período fecha quando todos enviarem';
  return `${text}${early ? ' (ou antes, se todos enviarem)' : ''}`;
}

const formatPin = (pin) => `${pin.slice(0, 3)}-${pin.slice(3)}`;
const gameLink = () => `${location.origin}${location.pathname}?jogo=${S.code}`;
const accessLink = () => `${gameLink()}&pin=${S.view.me.pin}`;

async function copyText(text, okMessage) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMessage);
  } catch {
    askConfirm(`Copie manualmente: ${text}`, 'OK');
  }
}

// ---------- lembretes ----------
const canNotify = () => !LOCAL && 'Notification' in window;
const notifyOn = () => canNotify() && Notification.permission === 'granted' && localGet('bsim:notify') === '1';

function localGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function localSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* sem armazenamento */ }
}

function notify(title, body) {
  if (!notifyOn()) return;
  try { new Notification(title, { body, tag: `bsim-${S.code}` }); } catch { /* navegador recusou */ }
}

async function toggleNotifications() {
  if (notifyOn()) {
    localSet('bsim:notify', '0');
    toast('Avisos desligados neste aparelho.');
  } else {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return toast('O navegador não liberou os avisos. Libere nas configurações do site.', true);
    localSet('bsim:notify', '1');
    toast('Pronto! Você será avisado quando o período fechar e quando o prazo estiver acabando (com o jogo aberto em alguma aba).');
  }
  renderStatus();
}

function deadlineLabel(ts) {
  return new Date(ts).toLocaleString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function whatsappLink() {
  const v = S.view;
  const when = v.nextDeadline ? `fecha ${deadlineLabel(v.nextDeadline)}` : 'está aberto';
  const text = `📈 Simulador de Empresas — o período ${v.period} de ${v.settings.totalPeriods} ${when}. Mande suas decisões: ${gameLink()}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** Arquivo de agenda com os prazos que faltam (modo diário), com alarme 1 hora antes. */
function calendarFile() {
  const v = S.view;
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`; };
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Simulador de Empresas//PT-BR', 'CALSCALE:GREGORIAN'];
  for (let p = v.period, t = v.nextDeadline; p <= v.settings.totalPeriods; p++, t += 24 * 3600 * 1000) {
    lines.push('BEGIN:VEVENT', `UID:${v.code}-${p}@simulador`, `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(t - 30 * 60 * 1000)}`, `DTEND:${stamp(t)}`,
      `SUMMARY:Simulador: fecha o período ${p} (${v.code})`, `DESCRIPTION:Mande suas decisões: ${gameLink()}`, `URL:${gameLink()}`,
      'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', `DESCRIPTION:Faltam 1h30 para fechar o período ${p}`, 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  if (S.icsUrl) URL.revokeObjectURL(S.icsUrl);
  S.icsUrl = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  return S.icsUrl;
}

// ---------- início ----------
function boot() {
  const params = new URLSearchParams(location.search);
  const code = params.get('jogo')?.toUpperCase();
  const pin = params.get('pin');
  if (code && pin) return recoverAndEnter(code, pin);
  if (code && savedGames()[code]) return enterGame(code);
  renderHome(code);
}

function renderHome(prefillCode = '') {
  stopPolling();
  S.view = null;
  if (location.search) setUrl(location.pathname);
  const saved = Object.entries(savedGames()).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, 6);
  $('#app').innerHTML = `
    <div class="wrap">
      <section class="hero">
        <h1>📈 Simulador de Empresas</h1>
        <p>Você é o CEO. A cada período, tome <b>10 decisões</b> — preço, produção, marketing, investimentos, dívida, dividendos… —
        e dispute o mercado com seus amigos. No fim, vence quem entregar a <b>maior valorização da ação</b>.</p>
      </section>

      ${LOCAL ? `
      <section class="card localbar-home">
        <div>
          <h2>Versão de teste</h2>
          <p class="muted" style="margin:0">Aqui o jogo roda inteiro neste navegador, sem servidor. Jogue contra robôs ou crie
          vários jogadores e alterne entre eles no mesmo aparelho. Para jogar com amigos, cada um no seu celular, publique o site.</p>
        </div>
        <button class="btn primary" id="quick-start">Partida rápida: você + 3 robôs</button>
      </section>` : ''}
      ${saved.length ? `
      <section class="card" style="margin-top:16px">
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
            <label>Prazo de cada período
              <select name="deadline">
                ${DEADLINE_OPTIONS.map(([value, label]) => `<option value="${value}" ${value === '1440' ? 'selected' : ''}>${label}</option>`).join('')}
              </select>
            </label>
          </div>
          <label class="check" id="early-field"><input type="checkbox" name="closeEarly" checked> Fechar antes do prazo quando todos enviarem</label>
          <label id="hour-field">Horário de fechamento diário
            <select name="dailyCloseHour">
              ${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === 22 ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}
            </select>
          </label>
          <label class="check"><input type="checkbox" name="allowAcquisitions" checked> Aquisições de empresas (leilões)</label>
          <label class="check"><input type="checkbox" name="allowIllegal" checked> Práticas ilegais e denúncias</label>
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
          <details class="recover">
            <summary>Já está na partida e trocou de aparelho?</summary>
            <div class="row" style="margin-top:10px">
              <label>Código da partida<input id="recover-code" maxlength="5" value="${esc(prefillCode || '')}" style="text-transform:uppercase;letter-spacing:.15em" placeholder="ABCDE"></label>
              <label>Seu código pessoal<input id="recover-pin" maxlength="7" style="text-transform:uppercase;letter-spacing:.12em" placeholder="ABC-123"></label>
            </div>
            <button class="btn block" type="button" id="recover-btn">Voltar para minha empresa</button>
          </details>
        </form>
      </div>

      <section class="grid-3 steps">
        <div class="card step"><b>1. Monte a sala</b>Crie a partida, mande o link para os amigos e, se quiser, complete a mesa com empresas-robô.</div>
        <div class="card step"><b>2. Decida no seu tempo</b>Cada período tem um prazo. Até ele acabar, cada CEO envia (e pode mudar) suas 10 decisões, quando e de onde quiser. Ninguém precisa estar online junto.</div>
        <div class="card step"><b>3. A revelação</b>No fim do prazo o jogo consolida tudo: saem a DRE, o balanço, a nova cotação e o ranking. Veja quem subiu e ajuste a estratégia!</div>
      </section>
      <footer>Partidas ficam salvas no servidor; seu acesso fica salvo neste navegador.</footer>
    </div>`;

  const createForm = $('#create-form');
  const syncMode = () => {
    $('#hour-field').style.display = createForm.deadline.value === 'daily' ? '' : 'none';
    $('#early-field').style.display = createForm.deadline.value === 'none' ? 'none' : '';
  };
  createForm.deadline.addEventListener('change', syncMode);
  syncMode();
  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(createForm));
    try {
      const dl = createForm.deadline.value;
      const r = await api('POST', '/api/games', {
        ...f,
        mode: dl === 'daily' ? 'daily' : dl === 'none' ? 'live' : 'timer',
        periodMinutes: Number(dl) || null,
        closeEarly: createForm.closeEarly.checked,
        allowAcquisitions: createForm.allowAcquisitions.checked,
        allowIllegal: createForm.allowIllegal.checked,
        tzOffset: new Date().getTimezoneOffset(),
      });
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
  $('#recover-btn').addEventListener('click', () => {
    const code = $('#recover-code').value.trim().toUpperCase();
    const pin = $('#recover-pin').value.trim();
    if (!code || !pin) return toast('Preencha o código da partida e o seu código pessoal.', true);
    recoverAndEnter(code, pin);
  });
}

async function recoverAndEnter(code, pin) {
  try {
    const r = await api('POST', `/api/games/${encodeURIComponent(code)}/recover`, { pin });
    saveGame(r.code, r.token, r.companyName);
    toast(`Bem-vindo de volta, ${r.companyName}!`);
    enterGame(r.code);
  } catch (err) {
    toast(err.message, true);
    renderHome(code);
  }
}

async function enterGame(code) {
  S.code = code;
  S.token = savedGames()[code]?.token;
  S.view = null;
  S.draft = null;
  S.tab = 'decisions';
  if (!LOCAL) setUrl(`?jogo=${code}`);
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
    const lastClosed = v.history.at(-1).period;
    notify(v.status === 'finished' ? 'Fim de jogo!' : `Período ${lastClosed} fechado`,
      v.status === 'finished' ? 'Veja o ranking final e o seu Raio-X.' : 'Os resultados e o novo ranking já saíram.');
    S.selPeriod = null;
    S.selCompany = null;
    window.scrollTo(0, 0);
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
    ...(v.history.length ? [['xray', 'Raio-X do CEO']] : []),
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
      ${localBar()}
      <div id="status"></div>
      <nav class="tabs">${tabs.map(([k, label]) => `<button data-tab="${k}" class="${S.tab === k ? 'active' : ''}">${label}</button>`).join('')}</nav>
      <main id="tab"></main>
      <footer>
        Código da partida: <b>${esc(v.code)}</b>
        ${!LOCAL && me.pin ? ` · Seu código pessoal: <b>${esc(formatPin(me.pin))}</b> <button class="link-btn" id="copy-access">copiar meu link de acesso</button>` : ''}
        · <button class="link-btn" id="leave">Sair desta partida neste navegador</button>
      </footer>
    </div>`;
  $('#home-link').addEventListener('click', (e) => { e.preventDefault(); renderHome(); });
  $('#copy-access')?.addEventListener('click', () => copyText(accessLink(), 'Link de acesso copiado. Guarde-o: ele abre sua empresa em qualquer aparelho.'));
  $('#leave').addEventListener('click', async () => {
    if (await askConfirm('Remover o acesso a esta partida deste navegador? Você não conseguirá voltar sem o link de acesso.', 'Sair da partida')) {
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
  else if (S.tab === 'xray') renderXray(tab);
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
      <span class="spacer"></span>
      ${!LOCAL ? `<a class="btn small" href="${whatsappLink()}" target="_blank" rel="noopener">Avisar o grupo no WhatsApp</a>` : ''}
      ${canNotify() ? `<button class="btn small" id="notify-toggle">${notifyOn() ? '🔔 Avisos ligados' : '🔕 Ligar avisos'}</button>` : ''}
      ${!LOCAL && v.settings.mode === 'daily' && v.nextDeadline ? `<a class="btn small" href="${calendarFile()}" download="simulador-${esc(v.code)}.ics">📅 Prazos na agenda</a>` : ''}
      ${v.me.isHost ? '<button class="btn small" id="force-close">Fechar período agora</button>' : ''}
    </div>`;
  $('#notify-toggle')?.addEventListener('click', toggleNotifications);
  $('#force-close')?.addEventListener('click', async () => {
    const missing = humans.length - done;
    const msg = missing > 0
      ? `${missing} CEO(s) ainda não enviaram. Eles repetirão as decisões do período anterior. Fechar o período ${v.period} agora?`
      : `Fechar o período ${v.period} agora?`;
    if (!(await askConfirm(msg, 'Fechar período'))) return;
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
  if (ms < 15 * 60 * 1000 && !v.myDecisions && S.warnedPeriod !== v.period) {
    S.warnedPeriod = v.period;
    notify('Faltam 15 minutos!', `Você ainda não enviou as decisões do período ${v.period}.`);
  }
  const h = Math.floor(ms / 3.6e6);
  const m = Math.floor((ms % 3.6e6) / 6e4);
  const s = Math.floor((ms % 6e4) / 1000);
  const when = new Date(v.nextDeadline).toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const left = h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m${String(s).padStart(2, '0')}s`;
  el.textContent = ms < 3.6e6 ? `⏰ Faltam ${left}` : `⏰ Fecha ${when} (em ${left})`;
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
      ${localBar()}
      <div class="grid-2">
        <section class="card">
          <h2>Convide seus amigos</h2>
          <p class="muted">Envie o link ou o código. Cada um entra com o próprio nome e empresa.</p>
          <div class="code-big">${esc(v.code)}</div>
          ${!LOCAL && v.me.pin ? `<div class="access-box">
            <b>Seu código pessoal: ${esc(formatPin(v.me.pin))}</b>
            <small class="muted">Use para entrar de outro aparelho. Não compartilhe: ele dá acesso à sua empresa.</small>
            <button class="btn small" id="copy-access">Copiar meu link de acesso</button>
          </div>` : ''}
          ${LOCAL ? '<p class="muted">Na versão de teste, todos jogam neste aparelho: adicione jogadores na barra acima e alterne entre eles.</p>' : `
          <div class="share-link" style="margin-top:12px">
            <input readonly value="${esc(link)}" id="share-url">
            <button class="btn" id="copy-link">Copiar</button>
          </div>`}
          <p class="muted" style="margin-top:16px">
            ${v.settings.totalPeriods} períodos ·
            ${deadlineText(v.settings)}
            <br>Aquisições: ${v.settings.allowAcquisitions === false ? 'desligadas' : 'ligadas'} ·
            práticas ilegais: ${v.settings.allowIllegal === false ? 'desligadas' : 'ligadas'}
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
  $('#copy-access')?.addEventListener('click', () => copyText(accessLink(), 'Link de acesso copiado. Guarde-o: ele abre sua empresa em qualquer aparelho.'));
  $('#copy-link')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link); toast('Link copiado!'); } catch { $('#share-url').select(); }
  });
  $('#add-bot')?.addEventListener('click', () => hostAction('bots', { profile: $('#bot-profile').value }));
  $('#start')?.addEventListener('click', () => hostAction('start', {}));
  $$('[data-remove]').forEach((b) => b.addEventListener('click', () => hostAction('remove', { playerId: b.dataset.remove })));
}

// ---------- versão de teste (artefato) ----------
function localBar() {
  if (!LOCAL || !S.code) return '';
  const humans = LOCAL.humans(S.code);
  const inLobby = S.view?.status === 'lobby';
  return `
    <div class="card localbar">
      <span class="pill"><b>Modo teste</b></span>
      <label for="local-player" class="inline">Jogando como
        <select id="local-player">
          ${humans.map((h) => `<option value="${h.id}" ${h.token === S.token ? 'selected' : ''}>${esc(h.companyName)} (${esc(h.name)})</option>`).join('')}
        </select>
      </label>
      ${inLobby ? `
        <span class="localbar-add">
          <input id="local-name" placeholder="Nome do jogador" maxlength="30" aria-label="Nome do jogador">
          <input id="local-company" placeholder="Empresa" maxlength="30" aria-label="Nome da empresa">
          <button class="btn small" id="local-add">+ Jogador humano</button>
        </span>` : '<small class="muted">Troque de jogador para tomar as decisões de cada um.</small>'}
    </div>`;
}

function switchLocalPlayer(id) {
  const h = LOCAL.humans(S.code).find((x) => x.id === id);
  if (!h) return;
  saveGame(S.code, h.token, h.companyName);
  S.token = h.token;
  S.view = null;
  S.draft = null;
  S.selCompany = null;
  S.tab = 'decisions';
  window.scrollTo(0, 0);
  refresh().then(() => toast(`Agora você joga como ${h.companyName}.`)).catch((err) => toast(err.message, true));
}

async function addLocalPlayer() {
  try {
    await api('POST', `/api/games/${S.code}/join`, { name: $('#local-name').value, companyName: $('#local-company').value });
    await refresh();
  } catch (err) { toast(err.message, true); }
}

async function quickStart() {
  try {
    const r = await api('POST', '/api/games', {
      name: 'Você', companyName: 'Minha Empresa', totalPeriods: 5, mode: 'live',
      allowAcquisitions: true, allowIllegal: true,
    });
    for (const profile of ['equilibrada', 'agressiva', 'inovadora']) {
      await api('POST', `/api/games/${r.code}/bots`, { token: r.token, profile });
    }
    await api('POST', `/api/games/${r.code}/start`, { token: r.token });
    saveGame(r.code, r.token, 'Minha Empresa');
    enterGame(r.code);
  } catch (err) { toast(err.message, true); }
}

if (LOCAL) {
  document.addEventListener('change', (e) => { if (e.target.id === 'local-player') switchLocalPlayer(e.target.value); });
  document.addEventListener('click', (e) => {
    if (e.target.id === 'local-add') addLocalPlayer();
    if (e.target.id === 'quick-start') quickStart();
  });
}

async function hostAction(action, body) {
  try {
    await api('POST', `/api/games/${S.code}/${action}`, { token: S.token, ...body });
    await refresh();
  } catch (err) { toast(err.message, true); }
}

// ---------- decisões ----------
function unitCost(units, salaryPct, materialMult, illegal = []) {
  const C = S.view.rules.config;
  const salary = salaryPct / 100;
  const scale = Math.pow(Math.max(units, 1000) / 10000, -0.05);
  const labor = ((C.laborCost * salary) / (0.6 + 0.4 * salary)) * (illegal.includes('informalLabor') ? 0.7 : 1);
  return C.materialCost * materialMult * scale - (illegal.includes('illegalDumping') ? 3 : 0) + labor;
}

function estimate(d, mv = S.moves ?? emptyMoves()) {
  const v = S.view;
  const C = v.rules.config;
  const c = v.companies[v.me.id];
  const env = v.env;
  const produced = clamp(d.production, 0, c.capacity);
  const uc = unitCost(produced, d.salary, env.materialMult, mv.illegal);
  const acquisition = env.acquisition && mv.acquisitionBid >= env.acquisition.minBid ? mv.acquisitionBid : 0;
  const legal = mv.reportTarget ? C.reportCost : 0;
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
    - productionCost - d.marketing - d.rnd - admin - interest - d.capex - d.dividends - buyback - acquisition - legal;
  const available = c.inventoryUnits + produced;
  const cashShare = 1 - d.creditDays / C.periodDays;
  const margin = d.price - uc;
  const fixed = d.marketing + d.rnd + admin + depreciation + interest - financialIncome;
  return {
    produced, uc, productionCost, admin, loan, acquisition, legal, issue, buyback, interest, rate, financialIncome, depreciation,
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
    S.moves = v.myMoves ? { ...v.myMoves, illegal: [...v.myMoves.illegal], cartel: v.myCartel?.pendingMove ?? null } : emptyMoves();
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
    ${guideBanner()}
    ${companySnapshot(c, m)}
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
        ${renderMovesSection()}
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
        <section class="card" id="projection"><h3>Projeção do resultado</h3><p class="muted">Calculando…</p></section>
        <section class="card" id="budget"></section>
        <button class="btn primary block" id="submit-decisions">${v.myDecisions ? 'Atualizar decisões' : 'Enviar decisões'}</button>
        <p class="muted" style="margin:0;text-align:center;font-size:.85rem">${v.myDecisions ? '✓ Decisões enviadas. Aguardando os demais.' : 'Você ainda não enviou neste período.'}</p>
      </aside>
    </div>`;

  const form = $('#decision-form');
  form.addEventListener('input', (e) => {
    const t = e.target;
    if (t.name === 'acquisitionBid') {
      S.moves.acquisitionBid = Math.max(0, Number(t.value) || 0);
    } else if (t.name === 'illegal') {
      S.moves.illegal = $$('input[name=illegal]:checked', form).map((x) => x.value);
    } else if (t.name === 'reportTarget') {
      S.moves.reportTarget = t.value || null;
    } else if (t.name?.startsWith('cartel')) {
      S.moves.cartel = readCartelMove(form);
    } else if (t.name) {
      const val = Number(t.value);
      S.draft[t.name] = Number.isFinite(val) ? val : 0;
    } else {
      return;
    }
    renderBudget();
    schedulePreview();
  });
  $('#guide')?.addEventListener('toggle', (e) => {
    try { localStorage.setItem('bsim:guide-closed', e.target.open ? '0' : '1'); } catch { /* sem armazenamento */ }
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  $('#submit-decisions').addEventListener('click', async () => {
    const btn = $('#submit-decisions');
    btn.disabled = true;
    try {
      await api('POST', `/api/games/${S.code}/decisions`, { token: S.token, period: v.period, decisions: S.draft, moves: S.moves });
      toast('Decisões enviadas!');
      S.view.myDecisions = { ...S.draft };
      S.view.myMoves = { ...S.moves };
      await refresh();
      if (S.tab === 'decisions' && S.view.status === 'running' && S.view.period === v.period) render();
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
      if (err.status === 409) refresh();
    }
  });
  renderBudget();
  runPreview();
}

// ---------- banner "como as coisas se afetam" ----------
const GUIDE_ROWS = [
  ['Preço', 'Margem maior em cada unidade', 'Clientes migram para quem cobra menos; se todos sobem, o mercado encolhe', 'Na hora'],
  ['Produção', 'Vende tudo o que a demanda pedir', 'Sobra vira estoque (R$ 2/un. por período) e prende caixa; falta derruba a reputação', 'Na hora'],
  ['Marketing', 'Marca mais forte: mais clientes', 'Despesa que reduz o lucro já neste período', 'Acumula; perde 35% por período'],
  ['P&D', 'Produto melhor: mais clientes', 'Despesa que reduz o lucro já neste período', 'Lento; dura bastante'],
  ['Fábrica', 'Capacidade para vender mais', 'Sai do caixa agora; deprecia 5% por período', 'No próximo período'],
  ['Salário', 'Produtividade e atendimento', 'Mão de obra e administração mais caras', 'Na hora'],
  ['Prazo ao cliente', 'Atrai clientes', 'O dinheiro a prazo só entra no próximo período; aumenta o calote', 'Caixa no próximo'],
  ['Empréstimo', 'Caixa para investir e evitar o emergencial', 'Juros todo período; dívida alta encarece os juros e assusta o mercado', 'Na hora'],
  ['Dividendos', 'Somam direto na sua valorização', 'Reduzem caixa e patrimônio', 'Na hora'],
  ['Emitir / recomprar ações', 'Emitir levanta caixa; recomprar concentra o lucro', 'Emitir dilui os sócios; recomprar gasta caixa', 'Na hora'],
];

function guideBanner() {
  let closed = false;
  try { closed = localStorage.getItem('bsim:guide-closed') === '1'; } catch { /* sem armazenamento */ }
  const C = S.view.rules.config;
  return `
    <details class="card guide" id="guide" ${closed ? '' : 'open'}>
      <summary><b>Como as coisas se afetam</b> <small class="muted">(toque para abrir ou recolher)</small></summary>
      <ol class="flow" aria-label="Cadeia de efeitos">
        <li><b>Suas decisões</b><small>preço, produção, investimentos…</small></li>
        <li><b>Clientes e custos</b><small>quanto vende e quanto gasta</small></li>
        <li><b>DRE</b><small>receita − custos = lucro</small></li>
        <li><b>Balanço</b><small>caixa, dívida e patrimônio</small></li>
        <li><b>Cotação da ação</b><small>o que decide o ranking</small></li>
      </ol>
      <p class="guide-rule">A ação sobe quando o lucro rende mais que <b>${pct(C.costOfEquity)} do patrimônio por período</b> (o custo de capital).
      Crescer a receita ajuda; dívida alta, escândalos e prejuízo derrubam. Sua clientela depende do seu preço,
      marca, qualidade, salário e prazo <b>comparados aos dos concorrentes</b>.</p>
      <div class="table-scroll">
        <table class="guide-table">
          <thead><tr><th>Se você aumentar…</th><th>Ganha</th><th>Paga</th><th>Quando aparece</th></tr></thead>
          <tbody>${GUIDE_ROWS.map(([k, gain, cost, when]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(gain)}</td><td>${esc(cost)}</td><td class="muted">${esc(when)}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    </details>`;
}

// ---------- balanço e referências no topo das decisões ----------
function companySnapshot(c, m) {
  const v = S.view;
  const C = v.rules.config;
  const env = v.env;
  const unitCostNow = unitCost(Math.min(10000, c.capacity), 100, env.materialMult);
  const avgPrice = m ? m.price : C.refPrice;
  const expectedDemand = (m ? m.mine.operations.demand : C.baseDemandPerCompany) * env.demandMult;
  const assets = c.cash + c.receivables + c.inventoryValue + c.fixedAssets + (c.goodwill || 0);
  return `
    <section class="card snapshot">
      <div class="snapshot-head">
        <h2>Sua empresa no início do período ${v.period}</h2>
        <small class="muted">Balanço patrimonial e números de referência para decidir</small>
      </div>
      <div class="snapshot-grid">
        <div>
          <h3>Ativo <small class="muted">o que a empresa tem</small></h3>
          <div class="kv">
            <span>Caixa</span><span class="num">${money(c.cash)}</span>
            <span>A receber <small class="muted">(entra neste período)</small></span><span class="num">${money(c.receivables)}</span>
            <span>Estoque <small class="muted">(${int(c.inventoryUnits)} un.)</small></span><span class="num">${money(c.inventoryValue)}</span>
            <span>Fábrica <small class="muted">(${int(c.capacity)} un./período)</small></span><span class="num">${money(c.fixedAssets)}</span>
            ${c.goodwill ? `<span>Ágio de aquisições</span><span class="num">${money(c.goodwill)}</span>` : ''}
            <span class="total">Total do ativo</span><span class="num total">${money(assets)}</span>
          </div>
        </div>
        <div>
          <h3>Passivo + PL <small class="muted">quem financia</small></h3>
          <div class="kv">
            <span>Empréstimos <small class="muted">(juros ${pct(v.myInterestRate ?? env.interestRate, 2)})</small></span><span class="num">${money(c.debt)}</span>
            <span>Patrimônio líquido</span><span class="num">${money(c.equity)}</span>
            <span class="total">Total</span><span class="num total">${money(c.debt + c.equity)}</span>
          </div>
          <div class="kv" style="margin-top:10px">
            <span>Cotação da ação</span><span class="num">${money2(c.price)} <small class="${cls(c.tsr)}">(${signPct(c.tsr)})</small></span>
            <span>Valor patrimonial por ação</span><span class="num">${money2(c.equity / c.shares)}</span>
            <span>Limite de crédito livre</span><span class="num">${money(Math.max(0, c.creditLimit - c.debt))}</span>
          </div>
        </div>
        <div>
          <h3>Referências <small class="muted">para este período</small></h3>
          <div class="kv">
            <span>Demanda esperada</span><span class="num">≈ ${int(expectedDemand)} un.</span>
            <span>Preço médio do mercado</span><span class="num">${money2(avgPrice)}</span>
            <span>Custo para produzir 1 un.</span><span class="num">≈ ${money2(unitCostNow)}</span>
            <span>Despesas fixas (adm. + depreciação)</span><span class="num">≈ ${money(C.adminFixed + C.adminSalaryLinked + c.fixedAssets * C.depreciationRate)}</span>
            ${m ? `<span>Seu último lucro líquido</span><span class="num ${cls(m.mine.income.netIncome)}">${money(m.mine.income.netIncome)}</span>` : ''}
            <span>Reputação</span><span class="num">${pct(c.reputation, 0)}</span>
          </div>
        </div>
      </div>
    </section>`;
}

// ---------- projeção do resultado ----------
function schedulePreview() {
  clearTimeout(S.previewTimer);
  S.previewTimer = setTimeout(runPreview, 350);
}

async function runPreview() {
  const seq = (S.previewSeq = (S.previewSeq || 0) + 1);
  let p;
  try {
    p = await api('POST', `/api/games/${S.code}/preview`, { token: S.token, decisions: S.draft, moves: S.moves });
  } catch {
    return;
  }
  const el = $('#projection');
  if (!el || seq !== S.previewSeq) return;
  el.innerHTML = `
    <h3>Projeção do resultado</h3>
    <p class="muted" style="margin:0 0 8px;font-size:.82rem">Se os concorrentes repetirem o último período.</p>
    <div class="kv">
      <span>Vendas</span><span class="num">${int(p.operations.sales)} un. <small class="muted">(${pct(p.operations.marketShare, 0)})</small></span>
      ${p.operations.unmet > 0 ? `<span>Faltaria produto</span><span class="num bad">${int(p.operations.unmet)} un.</span>` : ''}
      <span>Receita</span><span class="num">${money(p.income.revenue)}</span>
      <span>Lucro líquido</span><span class="num ${cls(p.income.netIncome)}"><b>${money(p.income.netIncome)}</b></span>
      <span>Caixa no fim</span><span class="num">${money(p.balance.cash)}</span>
      <span>Estoque no fim</span><span class="num">${int(p.operations.inventoryUnits)} un.</span>
      <span class="total">Cotação estimada</span><span class="num total">${money2(p.stock.price)} <small class="${cls(p.stock.change)}">(${signPct(p.stock.change)})</small></span>
    </div>
    ${p.emergencyLoan > 0 ? `<div class="warn">Pela projeção, o caixa fica negativo: empréstimo emergencial de ${money(p.emergencyLoan)} com multa.</div>` : ''}
    <p class="muted" style="margin:8px 0 0;font-size:.78rem">Estimativa sem sorte ou azar, sem leilão e sem a chance de ser pego. O resultado real depende das decisões dos concorrentes neste período.</p>`;
}

function emptyMoves() {
  return { acquisitionBid: 0, illegal: [], reportTarget: null, cartel: null };
}

// ---------- cartel ----------
function cartelSection() {
  const v = S.view;
  const C = v.rules.config;
  const info = v.myCartel;
  if (!info) return '';
  const mv = S.moves.cartel;
  const choice = mv ? (mv.type === 'accept' ? `accept:${mv.cartelId}` : mv.type) : 'none';
  const radio = (value, label, extra = '') => `
    <label class="check"><input type="radio" name="cartel-action" value="${esc(value)}" ${choice === value ? 'checked' : ''}> <span>${label}${extra}</span></label>`;
  const pr = v.rules.cartelPractice;
  const intro = `<p class="help">${esc(pr.benefit)} ${esc(pr.risk)} Se o CADE pegar o cartel, <b>todos os membros</b> levam
    multa (${C.fineMultiplier}× a vantagem indevida + ${money(C.fixedFine)}), tombo de ${pct(pr.shock, 0)} na ação e reputação arranhada.
    Quem <b>delatar primeiro</b> sai sem multa nenhuma.</p>`;
  if (info.membership) {
    const m = info.membership;
    const forming = m.status === 'forming';
    return `
      <div class="move shady cartel">
        <h3>🤝 Seu cartel ${forming ? '(aguardando adesões)' : `(ativo há ${m.periods} período(s))`}</h3>
        ${intro}
        <p>Preço mínimo combinado: <b>${money2(m.price)}</b> · fundado por ${esc(m.founder)}</p>
        <table class="cartel-table"><thead><tr><th>Membro</th><th class="num">Preço no último período</th><th></th></tr></thead><tbody>
          ${m.members.map((x) => `<tr><td>${esc(x.name)}${x.id === v.me.id ? ' (você)' : ''}</td>
            <td class="num">${x.lastPrice == null ? '—' : money2(x.lastPrice)}</td>
            <td>${x.lastPrice == null || forming ? '' : x.lastPrice >= m.price ? '<span class="good">cumpriu</span>' : '<span class="bad">furou o acordo</span>'}</td></tr>`).join('')}
        </tbody></table>
        ${m.invited.length ? `<p class="hint">Convites pendentes: ${m.invited.map(esc).join(', ')}</p>` : ''}
        <div class="cartel-options">
          ${radio('none', 'Continuar no cartel')}
          ${radio('leave', 'Sair do cartel', ' <small class="muted">— para de acumular vantagem, mas o que já ganhou continua exposto</small>')}
          ${forming ? '' : radio('delate', '<b>Delatar o cartel</b>', ' <small class="muted">— derruba os parceiros neste fechamento e você fica imune</small>')}
        </div>
      </div>`;
  }
  const others = v.players.filter((p) => p.id !== v.me.id);
  const proposing = mv?.type === 'propose';
  return `
    <div class="move shady cartel">
      <h3>🤝 Cartel de preços</h3>
      ${intro}
      <div class="cartel-options">
        ${radio('none', 'Não participar')}
        ${info.invites.map((inv) => radio(`accept:${inv.id}`, `Aceitar o convite de <b>${esc(inv.founder)}</b>`,
          ` <small class="muted">— preço mínimo ${money2(inv.price)} · membros: ${inv.members.map(esc).join(', ')}</small>`)).join('')}
        ${radio('propose', 'Propor um cartel')}
      </div>
      <div class="cartel-propose" ${proposing ? '' : 'hidden'}>
        <label for="cartel-price">Preço mínimo combinado (R$/un.)
          <input id="cartel-price" name="cartel-price" type="number" min="10" max="200" step="1" value="${proposing ? mv.price : Math.max(65, Math.round(S.draft.price))}">
        </label>
        <p class="hint" style="margin:0 0 6px">Convidar (o convite chega em segredo no próximo período):</p>
        ${others.map((p) => `<label class="check"><input type="checkbox" name="cartel-invite" value="${p.id}" ${proposing && mv.invite.includes(p.id) ? 'checked' : ''}> <span>${esc(p.companyName)}${p.isBot ? ' 🤖 <small class="muted">(robôs nunca aceitam)</small>' : ''}</span></label>`).join('')}
      </div>
    </div>`;
}

function readCartelMove(form) {
  const choice = $('input[name=cartel-action]:checked', form)?.value ?? 'none';
  const box = $('.cartel-propose', form);
  if (box) box.hidden = choice !== 'propose';
  if (choice === 'none') return null;
  if (choice === 'propose') {
    return {
      type: 'propose',
      price: Number($('#cartel-price', form)?.value) || 0,
      invite: $$('input[name=cartel-invite]:checked', form).map((x) => x.value),
    };
  }
  if (choice.startsWith('accept:')) return { type: 'accept', cartelId: choice.slice(7) };
  return { type: choice };
}

function renderMovesSection() {
  const v = S.view;
  const C = v.rules.config;
  const mv = S.moves;
  const parts = [];
  const target = v.env.acquisition;
  if (v.settings.allowAcquisitions !== false) {
    parts.push(target ? `
      <div class="move">
        <h3>🏢 Empresa à venda: ${esc(target.name)} <span class="unit">(${esc(target.kind)})</span></h3>
        <p class="help">${esc(target.text)}</p>
        <div class="kv">
          <span>Fábrica</span><span class="num">${money(target.fixedAssets)} · +${int(target.capacity)} un. de capacidade</span>
          <span>Clientes próprios</span><span class="num">${int(target.customers)} un. por período</span>
          <span>Marca / tecnologia</span><span class="num">+${money(target.brand)} / +${money(target.quality)}</span>
          <span>Lance mínimo</span><span class="num"><b>${money(target.minBid)}</b></span>
        </div>
        <label for="m-bid" style="margin-top:12px">Seu lance (R$) <span class="unit">— deixe 0 para não participar</span>
          <input id="m-bid" name="acquisitionBid" type="number" step="10000" min="0" value="${mv.acquisitionBid || 0}">
        </label>
        <p class="hint">Leilão fechado: ninguém vê os lances. O maior lance acima do mínimo leva e paga o próprio lance no fechamento;
        o que passar do valor da fábrica vira ágio no balanço. Seu poder de compra (caixa + recebíveis + crédito livre):
        <b>${money(v.myBuyingPower)}</b>. Se o caixa não cobrir, tome empréstimo na decisão 8.</p>
      </div>`
      : '<div class="move"><h3>🏢 Aquisições</h3><p class="muted">Nenhuma empresa à venda neste período. Fique de olho nos próximos.</p></div>');
  }
  if (v.settings.allowIllegal !== false) {
    const me = v.myIllegal;
    parts.push(`
      <div class="move shady">
        <h3>🕶️ Bastidores (práticas ilegais)</h3>
        <p class="help">Retorno rápido, mas cada período em uso aumenta o risco de ser pego. Se descoberto: multa de
        ${C.fineMultiplier}× tudo o que ganhou com a prática + ${money(C.fixedFine)} (em dobro para reincidentes), tombo na
        bolsa, clientes perdendo a confiança, ${C.investigationPeriods} períodos sob investigação e um desconto permanente de
        ${pct(C.governanceDiscount, 0)} na ação por condenação. Ganhos não punidos continuam expostos mesmo depois de parar.
        Ninguém vê suas escolhas — a não ser que você seja pego.</p>
        ${me.investigation > 0 ? `<div class="warn">Sua empresa está sob investigação por mais ${me.investigation} período(s): riscos 50% maiores.</div>` : ''}
        ${v.period >= v.settings.totalPeriods ? `<div class="warn">Último período: auditoria de encerramento (+${pct(C.finalAuditRisk, 0)} de risco em tudo que estiver exposto).</div>` : ''}
        ${v.rules.illegalPractices.map((pr) => {
          const st = me.practices[pr.key];
          return `
          <label class="check practice">
            <input type="checkbox" name="illegal" value="${pr.key}" ${mv.illegal.includes(pr.key) ? 'checked' : ''}>
            <span><b>${esc(pr.label)}</b> — ${esc(pr.benefit)}<br>
            <small>${esc(pr.risk)} Risco se usar agora: <b>${pct(st.riskIfActive, 0)}</b>${st.streak ? ` · em uso há ${st.streak} período(s)` : ''}${st.exposure > 0 ? ` · ganhos expostos: ${money(st.exposure)} (risco mesmo parando: ${pct(st.riskIfIdle, 0)})` : ''}</small></span>
          </label>`;
        }).join('')}
        <p class="hint">Os riscos acima não incluem denúncias: cada denúncia recebida soma +${pct(C.reportDetectionBoost, 0)}.</p>
      </div>
      <div class="move">
        <h3>🚨 Denunciar concorrente</h3>
        <p class="help">Desconfia de alguém? A denúncia custa ${money(C.reportCost)} em advogados e aumenta em
        ${pct(C.reportDetectionBoost, 0)} a chance de cada prática ilegal dele ser descoberta. Se ele for pego, você recebe
        ${money(C.reportReward)} de recompensa e continua anônimo.</p>
        <p class="help"><b>Cuidado:</b> se a empresa for honesta, a denúncia é <b>caluniosa</b>: você paga
        ${money(C.falseReportIndemnity)} de indenização a ela, perde reputação e seu nome sai nas notícias. Se ela
        trapaceava mas escapou, a denúncia só é arquivada.</p>
        <select name="reportTarget" id="m-report">
          <option value="">Não denunciar ninguém</option>
          ${v.players.filter((p) => p.id !== v.me.id).map((p) => `<option value="${p.id}" ${mv.reportTarget === p.id ? 'selected' : ''}>${esc(p.companyName)}</option>`).join('')}
        </select>
      </div>
      ${cartelSection()}`);
  }
  if (!parts.length) return '';
  return `<h2 style="margin-top:28px">Movimentos estratégicos <span class="unit">(opcionais)</span></h2>${parts.join('')}`;
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
      ${e.acquisition ? `<span>Aquisição (se vencer o leilão)</span><span class="num">−${money(e.acquisition)}</span>` : ''}
      ${e.legal ? `<span>Advogados (denúncia)</span><span class="num">−${money(e.legal)}</span>` : ''}
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
    ${isMe && h === v.history.at(-1) ? revealCard() : ''}
    ${eventBanners(r, companyId)}
    ${r.private ? privateCard(r) : ''}
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
          ${o.captiveDemand ? `<span>…de clientes adquiridos</span><span class="num">${int(o.captiveDemand)} un.</span>` : ''}
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
        <h3>Balanço patrimonial</h3>
        <table><tbody>
          ${row('Caixa', b.cash)}
          ${row('Contas a receber', b.receivables)}
          ${row('Estoques', b.inventory)}
          ${row('Imobilizado (fábrica)', b.fixedAssets)}
          ${b.goodwill ? row('Ágio de aquisições', b.goodwill) : ''}
          ${row('Total do ativo', b.totalAssets, { strong: true })}
          ${row('Empréstimos', b.debt)}
          ${row('Patrimônio líquido', b.equity, { color: true })}
          ${row('Total passivo + PL', b.totalLiabilitiesAndEquity, { strong: true })}
        </tbody></table>
      </section>
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
          ${i.legal ? row('(−) Despesas jurídicas', neg(i.legal)) : ''}
          ${row('= Lucro operacional (EBIT)', i.ebit, { strong: true, color: true })}
          ${row('(+) Rendimento do caixa', i.financialIncome)}
          ${row('(−) Juros', neg(i.interest))}
          ${row('= Lucro antes do IR', i.ebt, { strong: true })}
          ${row('(−) IR e CSLL (34%)', neg(i.tax))}
          ${i.fines ? row('(−) Multas e acordos judiciais', neg(i.fines)) : ''}
          ${i.reward ? row('(+) Recompensa por denúncia', i.reward) : ''}
          ${i.compensation ? row('(+) Indenização por denúncia caluniosa recebida', i.compensation) : ''}
          ${i.slanderPaid ? row('(−) Indenização por denúncia caluniosa', neg(i.slanderPaid)) : ''}
          ${i.emergencyFee ? row('(−) Multa do empréstimo emergencial', neg(i.emergencyFee)) : ''}
          ${row('= Lucro líquido', i.netIncome, { strong: true, color: true })}
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

function revealCard() {
  const v = S.view;
  const h = v.history.at(-1);
  const m = rankMove(v.me.id);
  const r = h.reports[v.me.id];
  const n = v.players.length;
  const leader = Object.entries(h.reports).sort((a, b) => b[1].stock.tsr - a[1].stock.tsr)[0];
  const moveText = !m.delta ? 'manteve a posição' : m.delta > 0 ? `subiu ${m.delta} posição(ões) ▲` : `caiu ${-m.delta} posição(ões) ▼`;
  return `
    <section class="card reveal">
      <div class="reveal-rank">${m.rank}º<small> de ${n}</small></div>
      <div>
        <h2 style="margin:0">Fechamento do período ${h.period}</h2>
        <p style="margin:4px 0 0">Sua ação foi a ${money2(r.stock.price)} (<span class="${cls(r.stock.change)}">${signPct(r.stock.change)}</span> no período,
        <span class="${cls(r.stock.tsr)}">${signPct(r.stock.tsr)}</span> no total) e você <b class="${cls(m.delta)}">${moveText}</b>.
        ${leader[0] === v.me.id ? 'Você lidera o ranking! 🏆' : `Líder: <b>${esc(companyName(leader[0]))}</b> (${signPct(leader[1].stock.tsr)}).`}</p>
      </div>
    </section>`;
}

function eventBanners(r, companyId) {
  const out = [];
  const ev = r.events;
  if (!ev) return '';
  const name = esc(companyName(companyId));
  if (ev.acquired) out.push(`🏢 ${name} comprou <b>${esc(ev.acquired.name)}</b> por ${money(ev.acquired.price)}.`);
  for (const sc of ev.scandals) out.push(`🚔 ${name} foi pega por <b>${esc(sc.label)}</b>${sc.reported ? ' após denúncia' : ''}: multa de ${money(sc.fine)}${sc.repeatOffender ? ' (reincidente: multa em dobro)' : ''}.`);
  if (ev.falseAccusers?.length) {
    out.push(`⚖️ ${name} foi acusada sem provas por ${ev.falseAccusers.map((id) => `<b>${esc(companyName(id))}</b>`).join(', ')} e recebeu ${money(S.view.rules.config.falseReportIndemnity * ev.falseAccusers.length)} de indenização.`);
  } else if (ev.reportsReceived && !ev.scandals.length) {
    out.push(`📨 ${name} recebeu ${ev.reportsReceived} denúncia(s) anônima(s), arquivada(s) por falta de provas.`);
  }
  if (ev.leniency) out.push(`🗣️ ${name} fez <b>delação premiada</b> do próprio cartel e ficou imune.`);
  if (ev.falseAccusationAgainst) out.push(`⚖️ ${name} acusou <b>${esc(companyName(ev.falseAccusationAgainst))}</b>, que era honesta: denúncia caluniosa, ${money(S.view.rules.config.falseReportIndemnity)} de indenização e reputação arranhada.`);
  return out.map((x) => `<div class="card banner">${x}</div>`).join('');
}

function privateCard(r) {
  const pv = r.private;
  const prs = Object.fromEntries([...S.view.rules.illegalPractices, S.view.rules.cartelPractice].map((x) => [x.key, x]));
  const used = pv.moves.illegal;
  const exposed = Object.entries(pv.illegal).filter(([, st]) => st.exposure > 0);
  const items = [];
  if (pv.moves.acquisitionBid) items.push(`Seu lance no leilão: ${money(pv.moves.acquisitionBid)}${r.events.acquired ? ' — vencedor!' : ' — não venceu.'}`);
  if (used.length) items.push(`Práticas usadas: ${used.map((k) => `${esc(prs[k].label)} (ganho ≈ ${money(pv.gains[k])})`).join(', ')}.`);
  if (exposed.length) items.push(`Ainda expostos: ${exposed.map(([k, st]) => `${esc(prs[k].label)} ${money(st.exposure)}`).join(', ')}.`);
  if (pv.moves.reportTarget) {
    const who = esc(companyName(pv.moves.reportTarget));
    if (pv.reward) items.push(`Você denunciou ${who} e recebeu ${money(pv.reward)} de recompensa!`);
    else if (r.events.falseAccusationAgainst) items.push(`Você denunciou ${who}, que era honesta: denúncia caluniosa, você pagou indenização e foi exposto.`);
    else items.push(`Você denunciou ${who}: nada foi provado e a denúncia foi arquivada. Ela não estava limpa, mas escapou desta vez.`);
  }
  if (pv.investigation > 0) items.push(`Sob investigação por mais ${pv.investigation} período(s).`);
  if (!items.length) return '';
  return `<section class="card shady" style="margin-top:16px"><h3>🔒 Só você vê</h3><ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul></section>`;
}

function fmtDecision(def, value) {
  if (def.unit.startsWith('R$/')) return money2(value);
  if (def.unit.startsWith('R$')) return money(value);
  if (def.key === 'salary') return `${value}%`;
  if (def.key === 'creditDays') return value === 0 ? 'À vista' : `${value} dias`;
  return int(value);
}

// ---------- mercado & ranking ----------
/** Posição de cada empresa no ranking após cada período (índice 0 = início, todos empatados). */
function rankAt(periodIndex) {
  const h = S.view.history[periodIndex - 1];
  if (!h) return null;
  const ids = Object.keys(h.reports).sort((a, b) => h.reports[b].stock.tsr - h.reports[a].stock.tsr);
  return Object.fromEntries(ids.map((id, i) => [id, i + 1]));
}

function rankMove(id, periodIndex = S.view.history.length) {
  const now = rankAt(periodIndex);
  const before = rankAt(periodIndex - 1);
  if (!now) return null;
  return { rank: now[id], delta: before ? before[id] - now[id] : 0 };
}

const moveBadge = (m) => (!m || !m.delta ? '<span class="muted">–</span>'
  : m.delta > 0 ? `<span class="good">▲${m.delta}</span>` : `<span class="bad">▼${-m.delta}</span>`);

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

const scandalCount = (id) => S.view.history.reduce((n, h) => n + (h.reports[id].events?.scandals.length ?? 0), 0);

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
        <button class="btn primary" id="see-xray" style="margin-top:12px">Ver o Raio-X da partida</button>
      </section>` : ''}
    <section class="card">
      <h2>Ranking — valorização da ação</h2>
      <p class="muted" style="margin-top:0">Valorização total = (cotação atual + dividendos recebidos por ação) ÷ cotação inicial (R$ ${v.rules.config.initialPrice},00) − 1.</p>
      <div class="table-scroll"><table>
        <thead><tr><th>#</th><th></th><th>Empresa</th><th class="num">Cotação</th><th class="num">Dividendos/ação</th><th class="num">Valorização</th><th class="num">Último lucro</th><th class="num">Participação</th><th class="num">Caixa</th><th class="num">Dívida</th></tr></thead>
        <tbody>
          ${rows.map((x, k) => `
            <tr class="${x.p.id === v.me.id ? 'me' : ''}">
              <td>${medals[k] ?? k + 1}</td>
              <td>${moveBadge(rankMove(x.p.id))}</td>
              <td><span class="dot" style="background:${companyColor(x.p.id)}"></span>${esc(x.p.companyName)} <small>${esc(x.p.name)}${x.p.isBot ? ' 🤖' : ''}</small>${scandalCount(x.p.id) ? ` <span title="Escândalos">🚔×${scandalCount(x.p.id)}</span>` : ''}${x.c.acquisitions.length ? ` <span title="Aquisições">🏢×${x.c.acquisitions.length}</span>` : ''}</td>
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
  wireSeeXray();
}

function wireSeeXray() {
  $('#see-xray')?.addEventListener('click', () => { S.tab = 'xray'; S.selCompany = null; render(); window.scrollTo(0, 0); });
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

// ---------- raio-x do CEO ----------
function xrayData(id) {
  const v = S.view;
  const C = v.rules.config;
  const reps = v.history.map((h) => ({ r: h.reports[id], h }));
  const last = reps.at(-1).r;
  const sumOf = (f) => reps.reduce((acc, x) => acc + f(x.r, x.h), 0);
  const avgOf = (f) => sumOf(f) / reps.length;
  const eps = sumOf((r) => r.stock.eps);
  const dividends = last.stock.cumDividendsPerShare;
  const issue = last.stock.bvps - C.initialPrice - eps + dividends;
  const premium = last.stock.price - last.stock.bvps;
  const roes = reps.map((x) => x.r.indicators.roe).filter((x) => x != null);
  return {
    id,
    tsr: last.stock.tsr,
    price: last.stock.price,
    bvps: last.stock.bvps,
    eps, dividends, issue, premium,
    total: last.stock.price + dividends,
    roeAvg: roes.length ? roes.reduce((a, b) => a + b, 0) / roes.length : 0,
    priceGap: avgOf((r, h) => r.decisions.price / h.market.avgPrice - 1),
    shareAvg: avgOf((r) => r.operations.marketShare),
    revenueGrowth: last.income.revenue / Math.max(1, reps[0].r.income.revenue) - 1,
    acc: {
      revenue: sumOf((r) => r.income.revenue),
      cogs: sumOf((r) => r.income.cogs),
      gross: sumOf((r) => r.income.grossProfit),
      growth: sumOf((r) => r.income.marketing + r.income.rnd),
      admin: sumOf((r) => r.income.admin),
      depreciation: sumOf((r) => r.income.depreciation),
      other: sumOf((r) => r.income.carrying + r.income.badDebt + (r.income.legal || 0)),
      financial: sumOf((r) => r.income.financialIncome - r.income.interest),
      tax: sumOf((r) => r.income.tax),
      extraordinary: sumOf((r) => (r.income.reward || 0) + (r.income.compensation || 0) - (r.income.fines || 0)
        - (r.income.slanderPaid || 0) - r.income.emergencyFee),
      net: sumOf((r) => r.income.netIncome),
    },
    emergencies: reps.filter((x) => x.r.cashflow.emergencyLoan > 0).length,
    emergencyFees: sumOf((r) => r.income.emergencyFee),
    scandals: reps.flatMap((x) => (x.r.events?.scandals ?? []).map((sc) => ({ ...sc, period: x.h.period }))),
    fines: sumOf((r) => r.income.fines || 0),
    falseAccusations: reps.filter((x) => x.r.events?.falseAccusationAgainst).length,
    rewards: sumOf((r) => r.income.reward || 0),
    acquisitions: reps.filter((x) => x.r.events?.acquired).map((x) => ({ ...x.r.events.acquired, period: x.h.period })),
    unmet: sumOf((r) => r.operations.unmet),
    demand: sumOf((r) => r.operations.demand),
    carrying: sumOf((r) => r.income.carrying),
    capacityStart: reps[0].r.operations.capacity,
    capacityEnd: last.operations.nextCapacity,
    best: reps.reduce((a, b) => (b.r.stock.change > a.r.stock.change ? b : a)),
    worst: reps.reduce((a, b) => (b.r.stock.change < a.r.stock.change ? b : a)),
    debtToEquity: last.indicators.debtToEquity,
  };
}

function xrayLessons(x) {
  const C = S.view.rules.config;
  const n = S.view.players.length;
  const out = [];
  if (x.roeAvg < C.costOfEquity) {
    out.push(['bad', `Seu lucro rendeu em média ${pct(x.roeAvg)} do patrimônio por período, abaixo do custo de capital de ${pct(C.costOfEquity)}. Por isso o mercado pagou ${x.premium < 0 ? 'menos' : 'pouco mais'} que o valor patrimonial pela sua ação.`]);
  } else {
    out.push(['good', `Seu lucro rendeu em média ${pct(x.roeAvg)} do patrimônio por período, acima do custo de capital de ${pct(C.costOfEquity)}: é isso que faz o mercado pagar um prêmio pela ação.`]);
  }
  if (x.emergencies) out.push(['bad', `Você ficou sem caixa em ${x.emergencies} período(s) e pagou ${money(x.emergencyFees)} de multa no empréstimo emergencial. Use o orçamento e a projeção para planejar empréstimos antes.`]);
  if (x.fines > 0) out.push(['bad', `As práticas ilegais descobertas custaram ${money(x.fines)} em multas, além do tombo na bolsa e da reputação (${x.scandals.map((sc) => sc.label.toLowerCase()).join(', ')}).`]);
  if (x.falseAccusations) out.push(['bad', `Você fez ${x.falseAccusations} denúncia(s) caluniosa(s): pagou indenização e perdeu reputação.`]);
  if (x.rewards) out.push(['good', `Suas denúncias certeiras renderam ${money(x.rewards)} em recompensas.`]);
  if (x.demand > 0 && x.unmet / x.demand > 0.05) out.push(['bad', `Faltou produto para ${int(x.unmet)} clientes (${pct(x.unmet / x.demand, 0)} da sua demanda): vendas perdidas e reputação arranhada. Planeje produção e capacidade.`]);
  if (x.carrying > 0.03 * x.acc.revenue) out.push(['bad', `Estoque parado custou ${money(x.carrying)} em estocagem. Produzir perto da demanda libera caixa.`]);
  if (x.priceGap > 0.05 && x.shareAvg < 1 / n) out.push(['info', `Você cobrou em média ${pct(x.priceGap, 0)} acima do mercado e ficou com ${pct(x.shareAvg, 0)} das vendas: o preço alto afastou clientes.`]);
  if (x.priceGap < -0.05) out.push(['info', `Você cobrou em média ${pct(-x.priceGap, 0)} abaixo do mercado e ficou com ${pct(x.shareAvg, 0)} das vendas. Confira se a margem compensou o volume.`]);
  if (x.issue > 0.3) out.push(['good', `Suas operações com ações (recompra barata ou emissão cara) criaram ${money2(x.issue)} por ação.`]);
  if (x.issue < -0.3) out.push(['bad', `Emitir ou recomprar ações no momento errado custou ${money2(-x.issue)} por ação.`]);
  if (x.acquisitions.length) out.push(['info', `Você comprou ${x.acquisitions.map((a) => `${a.name} (${money(a.price)})`).join(', ')}. Aquisições pesam no caixa agora e rendem ao longo dos períodos.`]);
  if (x.capacityEnd < x.capacityStart * 0.9) out.push(['info', `Sua fábrica encolheu de ${int(x.capacityStart)} para ${int(x.capacityEnd)} un.: o investimento não cobriu a depreciação.`]);
  if (x.revenueGrowth > 0.1) out.push(['good', `Sua receita cresceu ${pct(x.revenueGrowth, 0)} do primeiro ao último período.`]);
  return out.slice(0, 6);
}

function waterfall(x) {
  const C = S.view.rules.config;
  const steps = [
    ['Valor inicial da ação', C.initialPrice, 'base'],
    ['Lucros acumulados por ação', x.eps, 'delta'],
    ['Emissão e recompra de ações', x.issue, 'delta'],
    ['Prêmio (ou desconto) do mercado', x.premium, 'delta'],
    ['Valor final por ação', x.total, 'base'],
  ];
  let run = 0;
  const bars = steps.map(([label, value, kind]) => {
    const from = kind === 'base' ? 0 : run;
    const to = kind === 'base' ? value : run + value;
    run = to;
    return { label, value, kind, from, to };
  });
  const lo = Math.min(0, ...bars.flatMap((b) => [b.from, b.to]));
  const hi = Math.max(...bars.flatMap((b) => [b.from, b.to]));
  const scale = (val) => ((val - lo) / (hi - lo || 1)) * 100;
  return `
    <div class="waterfall">
      ${bars.map((b) => `
        <div class="wf-row ${b.kind}">
          <span class="wf-label">${b.label}</span>
          <span class="wf-track"><span class="wf-bar ${b.kind === 'base' ? 'base' : b.value >= 0 ? 'up' : 'down'}"
            style="left:${scale(Math.min(b.from, b.to))}%;width:${Math.max(0.6, Math.abs(scale(b.to) - scale(b.from)))}%"></span></span>
          <span class="wf-value num ${b.kind === 'delta' ? cls(b.value) : ''}">${b.kind === 'delta' && b.value >= 0.005 ? '+' : ''}${money2(Math.abs(b.value) < 0.005 ? 0 : b.value)}</span>
        </div>`).join('')}
    </div>`;
}

function renderXray(tab) {
  const v = S.view;
  const id = S.selCompany ?? v.me.id;
  const x = xrayData(id);
  const all = v.players.map((p) => ({ p, x: xrayData(p.id) })).sort((a, b) => b.x.tsr - a.x.tsr);
  const avg = (f) => all.reduce((acc, it) => acc + f(it.x), 0) / all.length;
  const rows = [
    ['Receita', 'revenue'], ['(−) Custo dos produtos', 'cogs', -1], ['= Lucro bruto', 'gross', 1, true],
    ['(−) Marketing e P&D', 'growth', -1], ['(−) Administração', 'admin', -1], ['(−) Depreciação', 'depreciation', -1],
    ['(−) Estocagem, calotes e advogados', 'other', -1], ['(±) Resultado financeiro', 'financial', 1],
    ['(−) Impostos', 'tax', -1], ['(±) Multas, indenizações e recompensas', 'extraordinary', 1], ['= Lucro líquido acumulado', 'net', 1, true],
  ];
  const isMe = id === v.me.id;
  tab.innerHTML = `
    <div class="card" style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">
      <label style="margin:0;flex:1 1 220px">Empresa
        <select id="xray-company">${v.players.map((p) => `<option value="${p.id}" ${p.id === id ? 'selected' : ''}>${esc(p.companyName)}${p.id === v.me.id ? ' (você)' : ''}</option>`).join('')}</select>
      </label>
      <p class="muted" style="margin:0;flex:2 1 300px">${v.status === 'finished' ? 'Resultado final da partida.' : `Parcial: até o período ${v.history.at(-1).period}.`} Usa só os dados publicados.</p>
    </div>
    <div class="grid-2" style="margin-top:16px">
      <section class="card">
        <h2>De onde veio a valorização</h2>
        <p class="muted" style="margin-top:0">${esc(companyName(id))}: ${money2(C_initial())} → ${money2(x.total)} por ação
          (cotação ${money2(x.price)} + dividendos ${money2(x.dividends)}) = <b class="${cls(x.tsr)}">${signPct(x.tsr)}</b></p>
        ${waterfall(x)}
        <ul class="xray-notes">
          <li><b>Lucros acumulados:</b> tudo o que a empresa lucrou (ou perdeu) por ação. É o motor do patrimônio.</li>
          <li><b>Emissão e recompra:</b> recomprar abaixo do valor patrimonial ou emitir acima dele cria valor por ação; o contrário destrói.</li>
          <li><b>Prêmio do mercado:</b> quanto a bolsa paga acima (ou abaixo) do patrimônio. Sobe com rentabilidade acima do custo de capital e crescimento; cai com prejuízo, dívida alta e escândalos.</li>
        </ul>
      </section>
      <section class="card">
        <h2>${isMe ? 'Lições da sua gestão' : `Lições da gestão de ${esc(companyName(id))}`}</h2>
        <ul class="lessons">${xrayLessons(x).map(([tone, text]) => `<li class="tone-${tone}">${text}</li>`).join('')}</ul>
        <div class="kv" style="margin-top:12px">
          <span>Melhor período na bolsa</span><span class="num good">P${x.best.h.period}: ${signPct(x.best.r.stock.change)}</span>
          <span>Pior período na bolsa</span><span class="num bad">P${x.worst.h.period}: ${signPct(x.worst.r.stock.change)}</span>
          <span>Rentabilidade média (ROE/período)</span><span class="num ${cls(x.roeAvg - v.rules.config.costOfEquity)}">${pct(x.roeAvg)}</span>
          <span>Preço médio vs. mercado</span><span class="num">${signPct(x.priceGap)}</span>
          <span>Participação média</span><span class="num">${pct(x.shareAvg)}</span>
          <span>Dívida / patrimônio no fim</span><span class="num">${x.debtToEquity == null ? '—' : x.debtToEquity.toFixed(2)}</span>
        </div>
      </section>
    </div>
    <section class="card" style="margin-top:16px">
      <h2>DRE acumulada da partida</h2>
      <div class="table-scroll"><table>
        <thead><tr><th></th><th class="num">${esc(companyName(id))}</th><th class="num">Média do mercado</th></tr></thead>
        <tbody>${rows.map(([label, key, sign = 1, strong]) => `
          <tr class="${strong ? 'strong' : ''}"><td>${label}</td>
            <td class="num ${key === 'net' ? cls(x.acc[key]) : ''}">${money(sign < 0 ? -x.acc[key] : x.acc[key])}</td>
            <td class="num muted">${money((sign < 0 ? -1 : 1) * avg((it) => it.acc[key]))}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>
    <section class="card" style="margin-top:16px">
      <h2>Comparativo de todos os CEOs</h2>
      <div class="table-scroll"><table>
        <thead><tr><th>Empresa</th><th class="num">Lucros/ação</th><th class="num">Emissão/recompra</th><th class="num">Prêmio do mercado</th><th class="num">Dividendos recebidos</th><th class="num">ROE médio</th><th class="num">Valorização</th></tr></thead>
        <tbody>${all.map(({ p, x: it }) => `
          <tr class="${p.id === v.me.id ? 'me' : ''}">
            <td><span class="dot" style="background:${companyColor(p.id)}"></span>${esc(p.companyName)}</td>
            <td class="num ${cls(it.eps)}">${money2(it.eps)}</td>
            <td class="num ${cls(it.issue)}">${money2(it.issue)}</td>
            <td class="num ${cls(it.premium)}">${money2(it.premium)}</td>
            <td class="num">${money2(it.dividends)}</td>
            <td class="num">${pct(it.roeAvg)}</td>
            <td class="num ${cls(it.tsr)}"><b>${signPct(it.tsr)}</b></td>
          </tr>`).join('')}</tbody>
      </table></div>
    </section>`;
  $('#xray-company').addEventListener('change', (e) => { S.selCompany = e.target.value; render(); });
}

const C_initial = () => S.view.rules.config.initialPrice;

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
  for (const k of h.market.cartels ?? []) {
    const names = k.members.map((id) => `<b>${esc(companyName(id))}</b>`).join(', ');
    const partners = k.members.filter((id) => !k.delators.includes(id)).map((id) => `<b>${esc(companyName(id))}</b>`).join(', ');
    out.unshift(k.byDelation
      ? `🗣️ DELAÇÃO PREMIADA: ${k.delators.map((id) => `<b>${esc(companyName(id))}</b>`).join(', ')} entregou os parceiros de cartel (${partners}), que foram multados. O delator ficou imune.`
      : `🚔 CADE desmantela cartel de preços entre ${names}. Todos foram multados.`);
  }
  const acq = h.market.acquisition;
  if (acq?.winnerId) out.unshift(`🏢 <b>${esc(companyName(acq.winnerId))}</b> venceu o leilão de <b>${esc(acq.name)}</b> por ${money(acq.price)} (${acq.bidders} lance${acq.bidders > 1 ? 's' : ''} válido${acq.bidders > 1 ? 's' : ''}).`);
  else if (acq) out.push(`🏚️ Ninguém deu lance válido por <b>${esc(acq.name)}</b>.`);
  for (const [id, r] of reps) {
    for (const sc of (r.events?.scandals ?? []).filter((x) => x.key !== 'cartel')) {
      out.unshift(`🚔 ESCÂNDALO: <b>${esc(companyName(id))}</b> é pega por ${esc(sc.label.toLowerCase())}${sc.reported ? ' após denúncia anônima' : ''}. Multa de ${money(sc.fine)}.`);
    }
    if (r.events?.falseAccusationAgainst) out.unshift(`⚖️ <b>${esc(companyName(id))}</b> acusou <b>${esc(companyName(r.events.falseAccusationAgainst))}</b> sem provas e terá de pagar ${money(v.rules.config.falseReportIndemnity)} de indenização.`);
    else if (r.events?.reportsReceived && !r.events.scandals.length && !r.events.falseAccusers?.length) out.push(`📨 Denúncia contra <b>${esc(companyName(id))}</b> foi arquivada por falta de provas.`);
  }
  if (h.autoSubmitted.length) out.push(`😴 Não enviaram decisões: ${h.autoSubmitted.map((id) => `<b>${esc(companyName(id))}</b>`).join(', ')}.`);
  return out.slice(0, 18).map((x) => `<li>${x}</li>`).join('');
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
      ${v.settings.allowAcquisitions !== false ? `
      <h3>Aquisições</h3>
      <p>A partir do período 2, de vez em quando uma empresa é colocada à venda (fábrica, marca regional, startup, distribuidora…).
      É um <b>leilão fechado</b>: cada CEO dá um lance secreto, o maior acima do mínimo leva e paga o próprio lance no fechamento do
      período. A fábrica entra no imobilizado (capacidade extra já no período seguinte), clientes próprios viram demanda cativa
      (perdendo ${pct(C.customerChurn, 0)} por período) e o valor pago acima da fábrica vira <b>ágio</b> no balanço. Pagar caro demais
      derruba o retorno sobre o patrimônio — e a ação.</p>` : ''}
      ${v.settings.allowIllegal !== false ? `
      <h3>Bastidores: práticas ilegais e denúncias</h3>
      <p>Seis atalhos ilegais dão ganho imediato (sonegar, trabalho informal, descarte ilegal, propaganda enganosa, espionagem e
      maquiagem contábil). Cada um tem uma chance de ser descoberto a cada período, que cresce quanto mais tempo você usa.
      O que você ganhou e não foi punido continua exposto mesmo depois de parar, e no último período há uma
      <b>auditoria de encerramento</b> (+${pct(C.finalAuditRisk, 0)} de risco). Se for pego: multa de ${C.fineMultiplier}× o ganho
      acumulado + ${money(C.fixedFine)} (em dobro para reincidentes), tombo na bolsa, reputação menor, ${C.investigationPeriods}
      períodos sob investigação e um desconto permanente de ${pct(C.governanceDiscount, 0)} no valor da ação por condenação
      (até ${pct(0.15, 0)}).</p>
      <p>Qualquer CEO pode <b>denunciar</b> um concorrente por período (custa ${money(C.reportCost)}). Cada denúncia aumenta em
      ${pct(C.reportDetectionBoost, 0)} a chance de descoberta; se o denunciado for pego, o denunciante recebe ${money(C.reportReward)}.
      As escolhas ilegais e as denúncias são secretas: só os escândalos viram notícia. Mas denunciar uma empresa honesta
      é <b>denúncia caluniosa</b>: o denunciante paga ${money(C.falseReportIndemnity)} de indenização ao denunciado, perde
      reputação e tem o nome publicado. Dica: analise os demonstrativos públicos —
      imposto zerado ou custo unitário baixo demais podem ser pistas.</p>` : ''}
      ${v.settings.allowIllegal !== false ? `
      <h3>Cartel de preços e delação premiada</h3>
      <p>Um CEO pode propor em segredo um <b>preço mínimo</b> a outras empresas. O convite chega no período seguinte; com dois
      ou mais membros, o cartel começa a valer. Ninguém é obrigado a cumprir o preço combinado (os membros veem quem furou),
      mas todos acumulam uma vantagem indevida de ${pct(C.cartelGainShare, 0)} da receita por período. O CADE investiga o grupo
      todo junto (risco crescente a cada período, maior com denúncias contra qualquer membro). Se pegar, <b>todos</b> são
      multados. A qualquer momento, um membro pode <b>delatar</b>: o cartel cai no mesmo fechamento, os parceiros são multados e
      o delator fica imune.</p>` : ''}
      <h3>Acesso e lembretes</h3>
      <p>Cada CEO tem um <b>código pessoal</b> (no rodapé do jogo) que abre a empresa em qualquer aparelho. Copie o seu link de
      acesso e guarde. Para não perder prazos: avise o grupo no WhatsApp, ligue os avisos do navegador ou, no modo diário,
      adicione os prazos à sua agenda.</p>
      <h3>Raio-X do CEO</h3>
      <p>A aba Raio-X mostra de onde veio a valorização de cada empresa (lucros, operações com ações e prêmio do mercado), a DRE
      acumulada e lições sobre a gestão. Ela usa só os dados publicados.</p>
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
