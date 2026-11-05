// Organizm — интерфейс сайта
(function () {
  'use strict';
  const api = window.OrganizmApi.create(window.ORGANIZM_CONFIG || {});
  window.__api = api;
  const MAPS = window.OrganizmApi.MAP_POOL;
  const app = document.getElementById('app');
  let unsub = null, lastRoute = '', refreshTimer = null;

  // =================== утилиты ===================
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
  const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return n + ' ' + (m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c); };
  const fmtDate = (iso, withTime = true) => iso ? new Intl.DateTimeFormat('ru-RU', withTime ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso)) : '—';
  const fmtDay = iso => iso ? new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso)) : '';
  function relTime(iso) {
    const d = (new Date(iso) - Date.now()) / 1000, a = Math.abs(d);
    const v = a < 3600 ? plural(Math.max(1, Math.round(a / 60)), 'минуту', 'минуты', 'минут') : a < 86400 ? plural(Math.round(a / 3600), 'час', 'часа', 'часов') : plural(Math.round(a / 86400), 'день', 'дня', 'дней');
    return d > 0 ? 'через ' + v : v + ' назад';
  }
  const toLocalInput = iso => { if (!iso) return ''; const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
  const fromLocalInput = v => v ? new Date(v).toISOString() : null;
  const go = h => { if (location.hash === h) render(); else location.hash = h; };

  const I = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    prize: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.5 3.2-6 6.5-6s6 2.5 6.5 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2 .7 3.3 2.9 3.5 6"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>',
    steam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="16" cy="8" r="4"/><circle cx="16" cy="8" r="1.4" fill="currentColor"/><circle cx="7.5" cy="16.5" r="3"/><path d="M10.3 15.3L13 11.5M2 13.5l3.2 1.4"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
  };

  function avatar(p, cls = '') {
    if (!p) return `<span class="avatar ph ${cls}">?</span>`;
    if (p.avatar_url) return `<img class="avatar ${cls}" src="${esc(p.avatar_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
    const hue = hash(p.steam_id || p.nickname) % 360;
    return `<span class="avatar ph ${cls}" style="background:hsl(${hue} 35% 26%);color:hsl(${hue} 70% 78%)">${esc((p.nickname || '?').slice(0, 1).toUpperCase())}</span>`;
  }
  function teamLogo(t, cls = '') {
    if (!t) return `<span class="tlogo ${cls}">?</span>`;
    if (t.logo_url) return `<span class="tlogo ${cls}"><img src="${esc(t.logo_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover" onerror="this.remove()"></span>`;
    const hue = hash(t.name) % 360;
    return `<span class="tlogo ${cls}" style="background:hsl(${hue} 30% 22%);color:hsl(${hue} 70% 75%)">${esc((t.tag || t.name).slice(0, 3).toUpperCase())}</span>`;
  }
  function banner(t) {
    if (t.banner_url) return `<img src="${esc(t.banner_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML=window.__genBan('${esc(t.id)}','${esc(t.mode)}')">`;
    return genBan(t.id, t.mode);
  }
  function genBan(id, mode) {
    const h = hash(id) % 360, h2 = (h + 40) % 360;
    return `<div class="gen-ban" style="background:radial-gradient(ellipse at 20% 0%,hsl(${h} 55% 26%),transparent 65%),radial-gradient(ellipse at 100% 100%,hsl(${h2} 50% 18%),transparent 60%),linear-gradient(135deg,#15171a,#0d0e10)">${esc(mode || '')}</div>`;
  }
  window.__genBan = genBan;
  const mapBg = m => { const h = hash(m) % 360; return `linear-gradient(135deg,hsl(${h} 45% 32%),hsl(${(h + 30) % 360} 40% 14%))`; };

  function stageBadge(t) {
    if (t.status === 'pending') return '<span class="badge pend">На модерации</span>';
    if (t.status === 'rejected') return '<span class="badge rej">Отклонён</span>';
    const regOpen = t.stage === 'registration' && (!t.reg_closes_at || new Date(t.reg_closes_at) > new Date());
    if (t.stage === 'registration') return regOpen ? '<span class="badge reg">Регистрация</span>' : '<span class="badge soon">Регистрация закрыта</span>';
    return { closed: '<span class="badge soon">Скоро старт</span>', ongoing: '<span class="badge live">Идёт</span>', finished: '<span class="badge done">Завершён</span>', cancelled: '<span class="badge rej">Отменён</span>' }[t.stage] || '';
  }
  const regOpen = t => t.status === 'published' && t.stage === 'registration' && (!t.reg_closes_at || new Date(t.reg_closes_at) > new Date());
  const boLabel = t => t.bo_default === t.bo_final ? 'Bo' + t.bo_default : `Bo${t.bo_default} · финал Bo${t.bo_final}`;
  function roundName(r, total) {
    const left = total - r;
    if (left === 0) return 'Финал';
    if (left === 1) return 'Полуфинал';
    if (left === 2) return 'Четвертьфинал';
    return '1/' + 2 ** left + ' финала';
  }
  const noVeto = t => (t.map_pool || []).length < 5;
  const AIM_MAPS = ['aim_map', 'aim_redline', 'aim_botz', 'aim_ag_texture2', 'aim_map_usp', 'awp_lego_2', 'awp_india', 'fy_pool_day'];
  const isAim = t => t.mode === '1v1';
  const FORMATS = { single: 'Олимпийская система', double: 'Двойное выбывание', groups: 'Группы + плей-офф' };
  const fmtName = t => FORMATS[t.format || 'single'];
  const groupLetter = n => String.fromCharCode(64 + n);
  // название матча с учётом вида сетки
  function matchName(m, matches) {
    const br = m.bracket || 'upper';
    if (br === 'group') return `Группа ${groupLetter(m.group_no)} · Тур ${m.round}`;
    if (br === 'grand') return 'Гранд-финал';
    const total = Math.max(...matches.filter(x => (x.bracket || 'upper') === br).map(x => x.round));
    if (br === 'lower') return m.round === total ? 'Финал нижней сетки' : `Нижняя сетка · Раунд ${m.round}`;
    if (matches.some(x => x.bracket === 'lower')) return m.round === total ? 'Финал верхней сетки' : m.round === total - 1 ? 'Полуфинал верхней сетки' : `Верхняя сетка · Раунд ${m.round}`;
    return roundName(m.round, total);
  }
  const finalMatch = matches => matches.find(m => m.bracket !== 'group' && !m.next_match_id);
  // живые таймеры: элементы с data-countdown обновляются раз в секунду
  function cdText(iso) {
    let s = Math.round((new Date(iso) - Date.now()) / 1000);
    if (s <= 0) return 'уже началось';
    const d = Math.floor(s / 86400); s %= 86400;
    const h = Math.floor(s / 3600); s %= 3600;
    const mi = Math.floor(s / 60), se = s % 60;
    const p = n => String(n).padStart(2, '0');
    return d ? `${d} д ${p(h)}:${p(mi)}` : h ? `${h}:${p(mi)}:${p(se)}` : `${p(mi)}:${p(se)}`;
  }
  const countdown = iso => `<span class="cd" data-countdown="${esc(iso)}">${cdText(iso)}</span>`;
  setInterval(() => $$('[data-countdown]').forEach(el => { el.textContent = cdText(el.dataset.countdown); }), 1000);
  const setTitle = s => { document.title = s ? `${s} — Organizm` : 'Organizm — турниры по CS2'; };
  const checkinOpen = t => !!t.checkin_minutes && ['registration', 'closed'].includes(t.stage) && Date.now() >= new Date(t.starts_at) - t.checkin_minutes * 6e4;
  const skeleton = (n = 6) => `<div class="tgrid">${Array(n).fill('<div class="tcard sk"><div class="ban"></div><div class="body"><i></i><i></i><i class="s"></i></div></div>').join('')}</div>`;
  async function share(url, title) {
    try { if (navigator.share && matchMedia('(pointer:coarse)').matches) { await navigator.share({ title, url }); return; } } catch (_) { return; }
    try { await navigator.clipboard.writeText(url); toast('Ссылка скопирована'); } catch (_) { toast('Не удалось скопировать: ' + url, 'bad'); }
  }
  // поле картинки: ссылка или загрузка файла
  function imgField(name, label, value, kind) {
    return `<div class="field imgf" data-kind="${kind}"><label class="f">${label}</label>
      <div class="imgrow"><span class="imgprev ${kind}">${value ? `<img src="${esc(value)}" alt="">` : ''}</span>
      <div style="flex:1;min-width:0"><input type="url" name="${name}" value="${esc(value || '')}" placeholder="https://… или загрузите файл">
      <div class="row" style="gap:8px;margin-top:6px"><label class="btn sm">Загрузить файл<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>${value ? '<button type="button" class="btn sm ghost" data-clear>Убрать</button>' : ''}<span class="hint" style="margin:0" data-st></span></div></div></div></div>`;
  }
  function bindImgFields(root) {
    $$('.imgf', root).forEach(box => {
      const inp = $('input[type=url]', box), file = $('input[type=file]', box), prev = $('.imgprev', box), st = $('[data-st]', box);
      const show = v => { prev.innerHTML = v ? `<img src="${esc(v)}" alt="">` : ''; };
      inp.oninput = () => show(inp.value.trim());
      const clr = $('[data-clear]', box); if (clr) clr.onclick = () => { inp.value = ''; show(''); };
      file.onchange = async () => {
        const f = file.files[0]; if (!f) return;
        st.textContent = 'Загружаю…';
        const url = await act(() => api.uploadImage(f, box.dataset.kind));
        st.textContent = '';
        file.value = '';
        if (url) { inp.value = url; show(url); toast('Картинка загружена'); }
      };
    });
  }

  // =================== уведомления и диалоги ===================
  function toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind; el.textContent = text;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), kind === 'bad' ? 6000 : 3200);
  }
  async function act(fn, okMsg) {
    try { const r = await fn(); if (okMsg) toast(okMsg); return r === undefined ? true : r; }
    catch (e) { toast(e.message || String(e), 'bad'); return false; }
  }
  function modal(title, body, { wide = false, onClose } = {}) {
    closeModal(true);
    const bg = document.createElement('div');
    bg.className = 'modal-bg'; bg.id = 'modal';
    bg.innerHTML = `<div class="modal ${wide ? '' : 'sm'}" role="dialog" aria-modal="true"><div class="mh"><h3>${title}</h3><button class="x" data-close aria-label="Закрыть">×</button></div><div class="mb">${body}</div></div>`;
    const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); if (onClose && !bg._silent) onClose(); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    bg.addEventListener('mousedown', e => { if (e.target === bg) close(); });
    bg.querySelector('[data-close]').onclick = close;
    document.addEventListener('keydown', onKey);
    bg._close = close;
    document.body.appendChild(bg);
    const f = bg.querySelector('input,textarea,select'); if (f) setTimeout(() => f.focus(), 30);
    return bg;
  }
  // silent — окно закрывается программой (смена страницы, перерисовка), а не пользователем
  function closeModal(silent) { const m = $('#modal'); if (m) { if (silent) m._silent = true; m._close ? m._close() : m.remove(); } }
  function ask(text, { ok = 'Подтвердить', danger = false } = {}) {
    return new Promise(res => {
      let done = false;
      const m = modal('Подтверждение', `<p style="margin-bottom:18px">${text}</p><div class="row" style="justify-content:flex-end"><button class="btn ghost" data-no>Отмена</button><button class="btn ${danger ? 'danger' : 'pri'}" data-yes>${ok}</button></div>`, { onClose: () => { if (!done) res(false); } });
      m.querySelector('[data-no]').onclick = () => { done = true; res(false); m._close(); };
      m.querySelector('[data-yes]').onclick = () => { done = true; res(true); m._close(); };
    });
  }
  function form(title, fieldsHtml, submitLabel, onSubmit) {
    const m = modal(title, `<form>${fieldsHtml}<div class="row" style="justify-content:flex-end;margin-top:6px"><button type="button" class="btn ghost" data-cancel>Отмена</button><button class="btn pri">${submitLabel}</button></div></form>`);
    const f = m.querySelector('form');
    m.querySelector('[data-cancel]').onclick = () => m._close();
    f.onsubmit = async e => {
      e.preventDefault();
      const btn = f.querySelector('button.pri'); btn.disabled = true;
      const ok = await onSubmit(Object.fromEntries(new FormData(f)), f);
      btn.disabled = false;
      if (ok !== false) m._close();
    };
    return m;
  }

  // =================== шапка ===================
  async function renderHeader(section) {
    const me = api.me;
    $$('nav.main a').forEach(a => a.classList.toggle('on', a.dataset.s === section));
    $('#navAdmin').classList.toggle('hidden', !(me && me.is_admin));
    const ua = $('#userArea');
    if (!me) {
      ua.innerHTML = `<button class="btn steam sm" id="loginBtn">${I.steam}Войти через Steam</button>`;
      $('#loginBtn').onclick = () => api.login();
    } else {
      ua.innerHTML = `<div class="me-btn" id="meBtn" tabindex="0">${avatar(me)}<span class="nm">${esc(me.nickname)}</span>
        <div class="menu" id="meMenu"><a href="#/me">Мой профиль</a><a href="#/">Мои матчи</a><a href="#/rating">Рейтинг</a><a href="#/create">Создать турнир</a>${me.is_admin ? '<a href="#/admin">Модерация</a>' : ''}<hr><button id="logoutBtn">Выйти</button></div></div>`;
      const menu = $('#meMenu');
      $('#meBtn').onclick = e => { e.stopPropagation(); menu.classList.toggle('open'); };
      $('#logoutBtn').onclick = async () => { await api.logout(); toast('Вы вышли'); render(); };
    }
    if (me && me.is_admin) {
      api.listTournaments('pending').then(l => { const c = $('#pendCount'); c.textContent = l.length; c.classList.toggle('hidden', !l.length); }).catch(() => {});
    }
  }
  document.addEventListener('click', () => { const m = $('#meMenu'); if (m) m.classList.remove('open'); $('nav.main').classList.remove('open'); });
  $('#burger').onclick = e => { e.stopPropagation(); $('nav.main').classList.toggle('open'); };

  // =================== главная (каталог) ===================
  const homeState = { q: '', filter: 'actual', mode: '' };
  async function viewHome() {
    app.innerHTML = `
      <section class="hero"><div class="wrap hero-in">
        <div>
          <div class="kicker">Платформа турниров CS2</div>
          <h1>Все турниры по <span>CS2</span> в одном месте</h1>
          <p>Находи турниры от организаторов сообщества, собирай команду и регистрируйся в пару кликов. Вход — через Steam, без паролей и анкет.</p>
          <div class="row"><a class="btn pri lg" href="#/" id="toList">Найти турнир</a><a class="btn lg" href="#/create">${I.plus}Провести свой турнир</a></div>
        </div>
        <div class="stats" id="stats"><div><b>—</b><span>турниров</span></div><div><b>—</b><span>команд</span></div><div><b>—</b><span>игроков</span></div></div>
      </div></section>
      <section class="section dash hidden" id="dash"><div class="wrap" id="dashIn"></div></section>
      <section class="section" id="list"><div class="wrap">
        <div class="filters">
          <div class="search">${I.search}<input type="search" id="q" placeholder="Название турнира или организатор" value="${esc(homeState.q)}"></div>
          <div class="seg" id="fseg">
            <button data-f="actual">Актуальные</button><button data-f="reg">Регистрация</button><button data-f="live">Идут</button><button data-f="past">Прошедшие</button>
          </div>
          <select id="fmode"><option value="">Любой формат</option><option value="5v5">5 на 5</option><option value="2v2">2 на 2</option><option value="1v1">1 на 1</option></select>
        </div>
        <div id="grid">${skeleton()}</div>
      </div></section>`;
    setTitle('');
    $('#toList').onclick = e => { e.preventDefault(); $('#list').scrollIntoView(); };
    if (api.me) drawDashboard();
    $('#fmode').value = homeState.mode;
    api.stats().then(s => { const b = $$('#stats b'); if (b.length) { b[0].textContent = s.tournaments; b[1].textContent = s.teams; b[2].textContent = s.players; } }).catch(() => {});
    let list = [];
    try { list = await api.listTournaments('public'); } catch (e) { $('#grid').innerHTML = `<div class="notice bad">Не удалось загрузить турниры: ${esc(e.message)}</div>`; return; }
    const draw = () => {
      $$('#fseg button').forEach(b => b.classList.toggle('on', b.dataset.f === homeState.filter));
      const q = homeState.q.trim().toLowerCase();
      let l = list.filter(t => (!q || t.title.toLowerCase().includes(q) || (t.organizer_nickname || '').toLowerCase().includes(q)) && (!homeState.mode || t.mode === homeState.mode));
      const f = homeState.filter;
      if (f === 'actual') l = l.filter(t => ['registration', 'closed', 'ongoing'].includes(t.stage));
      if (f === 'reg') l = l.filter(regOpen);
      if (f === 'live') l = l.filter(t => t.stage === 'ongoing');
      if (f === 'past') l = l.filter(t => ['finished', 'cancelled'].includes(t.stage)).reverse();
      if (f === 'actual') l.sort((a, b) => (b.stage === 'ongoing') - (a.stage === 'ongoing') || a.starts_at.localeCompare(b.starts_at));
      $('#grid').innerHTML = l.length ? `<div class="tgrid">${l.map(tcard).join('')}</div>`
        : `<div class="empty"><div class="head">Турниров не найдено</div>Попробуйте другой фильтр — или <a href="#/create" style="color:var(--accent)">создайте свой турнир</a>.</div>`;
    };
    $('#q').oninput = e => { homeState.q = e.target.value; draw(); };
    $('#fmode').onchange = e => { homeState.mode = e.target.value; draw(); };
    $$('#fseg button').forEach(b => b.onclick = () => { homeState.filter = b.dataset.f; draw(); });
    draw();
  }
  function tcard(t) {
    const pct = Math.min(100, Math.round(t.teams_count / t.max_teams * 100));
    return `<a class="tcard" href="#/t/${esc(t.id)}">
      <div class="ban">${banner(t)}<div class="bdg">${stageBadge(t)}</div><span class="badge mode">${esc(t.mode)}</span></div>
      <div class="body">
        <h3>${esc(t.title)}</h3>
        <div class="facts">
          <div>${I.cal}<b>${esc(fmtDate(t.starts_at))}</b></div>
          <div>${I.prize}<b>${esc(t.prize || 'Без призов')}</b></div>
          <div>${I.globe}<b>${esc(t.region)}</b></div>
          <div>${I.users}<b>${esc(isAim(t) && noVeto(t) ? (t.map_pool[0] || 'Карта от организатора') : boLabel(t))}</b></div>
        </div>
        <div class="slots"><div class="lbl"><span>${t.mode === '1v1' ? 'Игроков' : 'Команд'}: <b style="color:var(--text)">${t.teams_count}</b> из ${t.max_teams}</span><span>${t.stage === 'registration' || t.stage === 'closed' ? relTime(t.starts_at) : ''}</span></div><div class="bar"><i style="width:${pct}%"></i></div></div>
      </div>
      <div class="org">${avatar({ avatar_url: t.organizer_avatar, nickname: t.organizer_nickname, steam_id: t.organizer_steam_id }, 'sm')}<span>${esc(t.organizer_nickname || 'Организатор')}</span></div>
    </a>`;
  }

  // «Мои матчи»: приглашения, чек-ин и ближайшие игры
  async function drawDashboard() {
    const d = await api.myDashboard().catch(() => null);
    const box = $('#dashIn'); if (!box || !d) return;
    const items = [];
    for (const i of d.invites) items.push(`<div class="dcard inv">${teamLogo(i.team)}<div class="grow"><div class="kicker">Приглашение в команду</div><b>${esc(i.team.name)}</b><span>${esc(i.tournament.title)} · ${esc(fmtDate(i.tournament.starts_at))}</span></div>
      <div class="row" style="gap:8px"><button class="btn sm pri" data-inv-yes="${esc(i.team_id)}">Принять</button><button class="btn sm ghost" data-inv-no="${esc(i.team_id)}">Отклонить</button></div></div>`);
    for (const c of d.checkins) {
      const t = c.tournament, opensAt = new Date(new Date(t.starts_at) - t.checkin_minutes * 6e4).toISOString();
      let right;
      if (c.team.checked_in_at) right = '<span class="badge reg">✓ Участие подтверждено</span>';
      else if (!checkinOpen(t)) right = `<span class="hint" style="margin:0">Чек-ин через ${countdown(opensAt)}</span>`;
      else right = c.captain ? `<button class="btn sm pri" data-checkin="${esc(c.team.id)}">Подтвердить участие</button>` : '<span class="hint" style="margin:0">Ждём подтверждения капитана</span>';
      items.push(`<div class="dcard ${!c.team.checked_in_at && checkinOpen(t) ? 'hot' : ''}">${teamLogo(c.team)}<div class="grow"><div class="kicker">Чек-ин · старт через ${countdown(t.starts_at)}</div><b><a href="#/t/${esc(t.id)}/teams">${esc(t.title)}</a></b><span>${esc(c.team.name)}</span></div>${right}</div>`);
    }
    for (const m of d.matches.slice(0, 6)) {
      const op = m.mine === m.team_a ? m.B : m.A, my = m.mine === m.team_a ? m.A : m.B;
      const when = m.status === 'live' ? '<span class="badge live">Идёт</span>' : m.scheduled_at ? (new Date(m.scheduled_at) > Date.now() ? `через ${countdown(m.scheduled_at)}` : esc(fmtDate(m.scheduled_at))) : 'время не назначено';
      items.push(`<a class="dcard ${m.status === 'live' ? 'hot' : ''}" href="#/t/${esc(m.tournament_id)}/m/${esc(m.id)}">${teamLogo(my)}<div class="grow"><div class="kicker">${esc(m.tournament ? m.tournament.title : 'Матч')} · Bo${m.best_of}</div><b>${esc(my ? my.name : '')} <span class="vs">vs</span> ${esc(op ? op.name : 'TBD')}</b><span>${when}</span></div>${teamLogo(op)}</a>`);
    }
    if (!items.length) return;
    $('#dash').classList.remove('hidden');
    box.innerHTML = `<div class="sec-head" style="margin-bottom:14px"><div><h2>Мои матчи</h2><div class="sub">Приглашения, чек-ин и ближайшие игры ваших команд</div></div></div><div class="dgrid">${items.join('')}</div>`;
    $$('[data-inv-yes]', box).forEach(b => b.onclick = async () => { if (await act(() => api.respondInvite(b.dataset.invYes, true), 'Вы в команде!')) render(); });
    $$('[data-inv-no]', box).forEach(b => b.onclick = async () => { if (await act(() => api.respondInvite(b.dataset.invNo, false), 'Приглашение отклонено')) render(); });
    $$('[data-checkin]', box).forEach(b => b.onclick = async () => { if (await act(() => api.checkin(b.dataset.checkin), 'Участие подтверждено')) render(); });
  }


  // =================== аим-турниры ===================
  const aimState = { filter: 'actual' };
  async function viewAim() {
    setTitle('Аим-турниры');
    app.innerHTML = `<section class="aim-hero"><div class="wrap">
        <div class="kicker">Дуэли 1 на 1</div>
        <h1>Аим-<span>турниры</span></h1>
        <p>Турниры один на один: чистая стрельба без командной тактики. Можно играть на aim-картах без пиков и банов — организатор просто указывает карту.</p>
        <div class="row"><a class="btn pri lg" href="#/create/aim">${I.plus}Создать аим-турнир</a></div>
      </div></section>
      <section class="section"><div class="wrap">
        <div class="filters"><div class="seg" id="aseg2"><button data-f="actual">Актуальные</button><button data-f="reg">Регистрация</button><button data-f="live">Идут</button><button data-f="past">Прошедшие</button></div></div>
        <div id="agrid">${skeleton(3)}</div>
      </div></section>`;
    let list = [];
    try { list = (await api.listTournaments('public')).filter(isAim); } catch (e) { $('#agrid').innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    const draw = () => {
      $$('#aseg2 button').forEach(b => b.classList.toggle('on', b.dataset.f === aimState.filter));
      let l = list;
      const f = aimState.filter;
      if (f === 'actual') l = l.filter(t => ['registration', 'closed', 'ongoing'].includes(t.stage)).sort((a, b) => (b.stage === 'ongoing') - (a.stage === 'ongoing') || a.starts_at.localeCompare(b.starts_at));
      if (f === 'reg') l = l.filter(regOpen);
      if (f === 'live') l = l.filter(t => t.stage === 'ongoing');
      if (f === 'past') l = l.filter(t => ['finished', 'cancelled'].includes(t.stage)).reverse();
      $('#agrid').innerHTML = l.length ? `<div class="tgrid">${l.map(tcard).join('')}</div>`
        : `<div class="empty"><div class="head">Аим-турниров не найдено</div>Попробуйте другой фильтр — или <a href="#/create/aim" style="color:var(--accent)">проведите свой</a>.</div>`;
    };
    $$('#aseg2 button').forEach(b => b.onclick = () => { aimState.filter = b.dataset.f; draw(); });
    draw();
  }

  // =================== рейтинг ===================
  async function viewRating() {
    setTitle('Рейтинг игроков');
    app.innerHTML = `<div class="wrap section"><div class="sec-head"><div><h2>Рейтинг игроков</h2><div class="sub">По матчам опубликованных турниров: победа — 3 очка, выход в финал — ещё 3, титул — ещё 10</div></div>
      <div class="search" style="max-width:300px">${I.search}<input type="search" id="rq" placeholder="Найти игрока"></div></div><div id="rbox"><div class="loader">Считаю рейтинг…</div></div></div>`;
    const list = await api.leaderboard().catch(e => { $('#rbox').innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return null; });
    if (!list) return;
    const draw = () => {
      const q = $('#rq').value.trim().toLowerCase();
      const rows = list.map((p, i) => ({ ...p, place: i + 1 })).filter(p => !q || p.nickname.toLowerCase().includes(q));
      $('#rbox').innerHTML = !list.length ? '<div class="empty"><div class="head">Рейтинг пуст</div>Он появится после первых сыгранных матчей.</div>'
        : !rows.length ? '<div class="empty">Никого не нашли</div>'
        : `<div class="table-wrap"><table class="rtable"><thead><tr><th>#</th><th>Игрок</th><th>Очки</th><th class="hm">Матчи</th><th>Победы</th><th class="hm">% побед</th><th class="hm">Финалы</th><th>Титулы</th></tr></thead><tbody>
          ${rows.map(p => `<tr class="${api.me && p.user_id === api.me.id ? 'me' : ''} ${p.place <= 3 ? 'top' + p.place : ''}"><td class="pl">${p.place}</td>
            <td><a class="row" style="gap:10px;flex-wrap:nowrap" href="#/u/${esc(p.steam_id)}">${avatar(p, 'sm')}<b>${esc(p.nickname)}</b>${p.faceit_level ? `<span class="lvl l${p.faceit_level}">${p.faceit_level}</span>` : ''}</a></td>
            <td class="pts">${p.points}</td><td class="hm">${p.matches}</td><td>${p.wins}</td><td class="hm">${p.matches ? Math.round(p.wins / p.matches * 100) : 0}%</td><td class="hm">${p.finals}</td><td>${p.titles ? '🏆 ' + p.titles : '—'}</td></tr>`).join('')}
          </tbody></table></div>`;
    };
    $('#rq').oninput = draw;
    draw();
  }

  // =================== страница турнира ===================
  let tCache = null;
  async function viewTournament(id, tab, matchId) {
    const sameT = tCache && tCache.t.id === id;
    if (!sameT) app.innerHTML = '<section class="t-head sk"><div class="wrap in"><i></i><i class="l"></i><i class="s"></i></div></section>';
    let data;
    try { data = await api.getTournament(id); } catch (e) { app.innerHTML = `<div class="wrap section"><div class="notice bad">${esc(e.message)}</div></div>`; return; }
    if (!data) { app.innerHTML = `<div class="wrap section"><div class="empty"><div class="head">Турнир не найден</div>Возможно, он ещё на модерации или был удалён.<div style="margin-top:16px"><a class="btn" href="#/">К списку турниров</a></div></div></div>`; return; }
    tCache = data;
    drawTournament(tab, matchId);
    if (unsub) unsub();
    let pending = null;
    unsub = api.subscribe(id, () => {
      clearTimeout(pending);
      pending = setTimeout(async () => {
        const fresh = await api.getTournament(id).catch(() => null);
        if (!fresh || !location.hash.startsWith('#/t/' + id)) return;
        tCache = fresh;
        const [, , c, d] = location.hash.replace(/^#\/?/, '').split('/');
        if (document.activeElement && document.activeElement.matches('input,textarea,select') && !$('#modal')) return;
        drawTournament(c === 'm' ? (tCache._tab || 'bracket') : (c || 'overview'), c === 'm' ? d : null, true);
      }, 250);
    });
  }

  function ctx() {
    const { t, teams, matches } = tCache;
    const me = api.me;
    const teamById = Object.fromEntries(teams.map(x => [x.id, x]));
    const myTeam = me ? teams.find(x => x.members.some(m => m.user_id === me.id)) : null;
    const canManage = !!me && (me.is_admin || t.organizer_id === me.id);
    return { t, teams, matches, me, teamById, myTeam, canManage, isCaptain: !!myTeam && myTeam.captain_id === me.id };
  }

  function drawTournament(tab, matchId, soft) {
    const c = ctx(), { t, teams, matches, me, myTeam, canManage } = c;
    if (tab !== 'manage' || canManage) tCache._tab = tab; else tab = 'overview';
    const tabs = [['overview', 'Обзор'], ['teams', t.mode === '1v1' ? 'Участники' : 'Команды', teams.length], ['bracket', 'Сетка'], ['matches', 'Матчи'], ['news', 'Анонсы', tCache.announcements.length]];
    if (canManage) tabs.push(['manage', 'Управление']);
    const fm = finalMatch(matches);
    const champion = t.stage === 'finished' && fm && fm.winner_id ? c.teamById[fm.winner_id] : null;
    const scrollY = window.scrollY;
    setTitle(t.title);
    app.innerHTML = `
      <section class="t-head"><div class="bg">${banner(t)}</div><div class="wrap in">
        <div class="t-top">
          <div>
            <div class="row" style="gap:8px">${stageBadge(t)}<span class="badge">${esc(t.mode)}</span><span class="badge">${esc(fmtName(t))}</span>${t.stage === 'registration' && t.reg_closes_at ? `<span class="badge">Регистрация до ${esc(fmtDate(t.reg_closes_at))}</span>` : ''}${t.checkin_minutes ? `<span class="badge">Чек-ин за ${t.checkin_minutes} мин</span>` : ''}<button class="btn sm ghost share" id="shareT" title="Поделиться ссылкой">${I.share}Поделиться</button></div>
            <h1>${esc(t.title)}</h1>
            <div class="org">Организатор: <a href="#/u/${esc(t.organizer_steam_id)}" class="row" style="gap:6px">${avatar({ avatar_url: t.organizer_avatar, nickname: t.organizer_nickname, steam_id: t.organizer_steam_id }, 'sm')}<b style="color:var(--text);font-weight:500">${esc(t.organizer_nickname)}</b></a></div>
            <div class="kfacts">
              <div><span>Старт</span><b>${['registration', 'closed'].includes(t.stage) && new Date(t.starts_at) > Date.now() ? `<span title="${esc(fmtDate(t.starts_at))}">через ${countdown(t.starts_at)}</span>` : esc(fmtDate(t.starts_at))}</b></div>
              <div><span>Призовой фонд</span><b>${esc(t.prize || '—')}</b></div>
              <div><span>${t.mode === '1v1' ? 'Игроки' : 'Команды'}</span><b>${teams.length} / ${t.max_teams}</b></div>
              <div><span>Матчи</span><b>${esc(boLabel(t))}</b></div>
              <div><span>Взнос</span><b>${esc(t.entry_fee || 'Бесплатно')}</b></div>
            </div>
          </div>
          <div class="cta">${ctaHtml(c, champion)}</div>
        </div>
        <nav class="tabs">${tabs.map(([k, l, n]) => `<a href="#/t/${esc(t.id)}/${k}" class="${tab === k ? 'on' : ''}">${l}${n ? `<span class="n">${n}</span>` : ''}</a>`).join('')}</nav>
      </div></section>
      <section class="section" style="padding-top:24px"><div class="wrap" id="tbody"></div></section>`;
    const body = $('#tbody');
    if (t.status !== 'published' && canManage) {
      body.insertAdjacentHTML('beforebegin', '');
      body.innerHTML = t.status === 'pending'
        ? `<div class="notice warn"><div><b>Турнир на модерации.</b> Его видите только вы и администраторы. После одобрения он появится в каталоге и откроется регистрация.</div></div>`
        : `<div class="notice bad"><div><b>Турнир отклонён модератором.</b>${t.moderation_note ? ' Причина: ' + esc(t.moderation_note) + '.' : ''} Исправьте его во вкладке «Управление» — он снова уйдёт на проверку.</div></div>`;
    }
    const holder = document.createElement('div');
    body.appendChild(holder);
    ({ overview: tabOverview, teams: tabTeams, bracket: tabBracket, matches: tabMatches, news: tabNews, manage: tabManage }[tab] || tabOverview)(holder, c);
    bindCta(c);
    if (soft) window.scrollTo(0, scrollY);
    if (matchId) openMatch(matchId); else if ($('#modal') && $('#modal').dataset.match) closeModal(true);
  }

  function ctaHtml(c, champion) {
    const { t, me, myTeam, matches, teamById } = c;
    if (champion) return `<div class="card accent"><div class="kicker">Победитель</div><div class="row" style="margin-top:10px">${teamLogo(champion)}<b class="head" style="font-size:22px">${esc(champion.name)}</b></div></div>`;
    if (myTeam) {
      const my = matches.find(m => m.status !== 'finished' && (m.team_a === myTeam.id || m.team_b === myTeam.id) && m.team_a && m.team_b);
      const cap = myTeam.captain_id === me.id;
      let ci = '';
      if (t.checkin_minutes && ['registration', 'closed'].includes(t.stage)) {
        const opensAt = new Date(new Date(t.starts_at) - t.checkin_minutes * 6e4).toISOString();
        ci = myTeam.checked_in_at ? '<div class="ci ok">✓ Участие подтверждено</div>'
          : !checkinOpen(t) ? `<div class="ci">Чек-ин откроется через ${countdown(opensAt)}</div>`
          : cap ? `<button class="btn pri block" data-checkin="${esc(myTeam.id)}" style="margin-bottom:8px">Подтвердить участие</button><div class="ci warn">Без чек-ина ${t.mode === '1v1' ? 'вы не попадёте' : 'команда не попадёт'} в сетку</div>`
          : '<div class="ci warn">Чек-ин открыт — капитан должен подтвердить участие</div>';
      }
      return `<div class="card accent"><div class="kicker">${t.mode === '1v1' ? 'Вы участвуете' : 'Ваша команда'}</div>
        <div class="row" style="margin:10px 0 12px">${teamLogo(myTeam)}<div><b class="head" style="font-size:19px">${esc(myTeam.name)}</b><div class="sub" style="margin:0">${cap ? 'Вы капитан' : 'Вы игрок'} · ${plural(myTeam.members.length, 'игрок', 'игрока', 'игроков')}</div></div></div>
        ${ci}
        ${my ? `<a class="btn pri block" href="#/t/${esc(t.id)}/m/${esc(my.id)}">Ваш матч: vs ${esc((teamById[my.team_a === myTeam.id ? my.team_b : my.team_a] || {}).name)}</a>`
             : `<a class="btn block" href="#/t/${esc(t.id)}/teams">Открыть ${t.mode === '1v1' ? 'участников' : 'команду'}</a>`}</div>`;
    }
    const myInv = me ? (tCache.invites || []).filter(i => i.user_id === me.id) : [];
    if (myInv.length && regOpen(t)) {
      return `<div class="card accent"><div class="kicker">Вас приглашают</div>${myInv.map(i => { const tm = teamById[i.team_id]; return tm ? `<div class="row" style="margin:10px 0">${teamLogo(tm, 'sm')}<b style="flex:1">${esc(tm.name)}</b><button class="btn sm pri" data-inv-yes="${esc(tm.id)}">Принять</button><button class="btn sm ghost" data-inv-no="${esc(tm.id)}">✕</button></div>` : ''; }).join('')}</div>`;
    }
    if (regOpen(t)) {
      const full = c.teams.length >= t.max_teams;
      const agent = me && (tCache.agents || []).find(a => a.user_id === me.id);
      const faBtn = t.mode === '1v1' || !me ? '' : agent
        ? `<div class="ci ok" style="margin-top:10px">Вы в списке свободных агентов — капитаны могут вас пригласить</div><button class="btn sm ghost block" data-fa-off>Убрать себя из списка</button>`
        : `<button class="btn block ghost" data-fa-on style="margin-top:8px">${I.users}Ищу команду</button>`;
      if (!me) return `<div class="card"><b>Регистрация открыта</b><p class="sub" style="margin:4px 0 12px">Войдите через Steam, чтобы ${t.mode === '1v1' ? 'участвовать' : 'создать команду или вступить в неё'}.</p><button class="btn steam block" data-login>${I.steam}Войти через Steam</button></div>`;
      if (full) return `<div class="card"><b>Мест нет</b><p class="sub" style="margin-top:4px">Все слоты заняты. Можно вступить в команду, где есть место.</p>${t.mode === '1v1' ? '' : '<button class="btn block" data-join-code style="margin-top:12px">Вступить по коду</button>'}${faBtn}</div>`;
      if (t.mode === '1v1') return `<div class="card"><b>Регистрация открыта</b><p class="sub" style="margin:4px 0 12px">Свободно мест: ${t.max_teams - c.teams.length}</p><button class="btn pri block" data-solo>Участвовать</button></div>`;
      return `<div class="card"><b>Регистрация открыта</b><p class="sub" style="margin:4px 0 12px">Свободно мест: ${t.max_teams - c.teams.length}</p>
        <button class="btn pri block" data-create-team>${I.plus}Зарегистрировать команду</button>
        <button class="btn block" data-join-code style="margin-top:8px">Вступить по коду</button>
        ${faBtn}
        <a class="hint" href="#/t/${esc(t.id)}/teams" style="display:block;text-align:center;margin-top:10px">или выберите открытую команду →</a></div>`;
    }
    if (t.stage === 'ongoing') return `<div class="card"><b>Турнир идёт</b><p class="sub" style="margin:4px 0 12px">Следите за сеткой и результатами в реальном времени.</p><a class="btn pri block" href="#/t/${esc(t.id)}/bracket">Открыть сетку</a></div>`;
    return '';
  }
  function bindCta(c) {
    const { t } = c;
    $$('[data-login]').forEach(b => b.onclick = () => api.login());
    $$('[data-create-team]').forEach(b => b.onclick = () => createTeamDialog(t));
    $$('[data-join-code]').forEach(b => b.onclick = () => joinCodeDialog(t));
    $$('[data-solo]').forEach(b => b.onclick = async () => { if (await act(() => api.createTeam(t.id, { name: api.me.nickname, open: true }), 'Вы зарегистрированы!')) refreshT(); });
    $$('.cta [data-checkin]').forEach(b => b.onclick = async () => { b.disabled = true; if (await act(() => api.checkin(b.dataset.checkin), 'Участие подтверждено')) refreshT(); else b.disabled = false; });
    $$('.cta [data-inv-yes]').forEach(b => b.onclick = async () => { if (await act(() => api.respondInvite(b.dataset.invYes, true), 'Вы в команде!')) refreshT(); });
    $$('.cta [data-inv-no]').forEach(b => b.onclick = async () => { if (await act(() => api.respondInvite(b.dataset.invNo, false), 'Приглашение отклонено')) refreshT(); });
    $$('[data-fa-on]').forEach(b => b.onclick = () => form('Ищу команду', `<p class="sub" style="margin-bottom:14px">Вы появитесь в списке свободных агентов на вкладке «Команды». Капитаны смогут пригласить вас, а приглашение придёт на главную страницу.</p>
      <div class="field"><label class="f">Пара слов о себе</label><input type="text" name="note" maxlength="140" placeholder="Роль, уровень, когда можете играть"></div>`, 'Встать в список',
      async v => { if (!await act(() => api.setFreeAgent(t.id, v.note.trim()), 'Вы в списке свободных агентов')) return false; refreshT(); }));
    $$('[data-fa-off]').forEach(b => b.onclick = async () => { if (await act(() => api.removeFreeAgent(t.id), 'Вы убраны из списка')) refreshT(); });
    const sh = $('#shareT'); if (sh) sh.onclick = () => share(location.href.split('#')[0] + '#/t/' + t.id, t.title);
  }
  const refreshT = async () => { if (!tCache) return; const fresh = await api.getTournament(tCache.t.id); if (fresh) { tCache = fresh; const [, , c, d] = location.hash.replace(/^#\/?/, '').split('/'); drawTournament(c === 'm' ? (tCache._tab || 'bracket') : (c || 'overview'), c === 'm' ? d : null, true); } };

  function createTeamDialog(t) {
    const m = form('Регистрация команды', `
      <div class="grid2"><div class="field"><label class="f">Название команды</label><input type="text" name="name" required minlength="2" maxlength="32"></div>
      <div class="field"><label class="f">Тег (до 6 символов)</label><input type="text" name="tag" maxlength="6" placeholder="NAVI"></div></div>
      ${imgField('logo', 'Логотип (необязательно)', '', 'logo')}
      <div class="field"><label class="chk"><input type="checkbox" name="open" checked><span><b>Открытая команда</b><br><span class="hint" style="margin:0">Любой игрок сможет вступить сам. Если выключить — только по коду, который вы раздадите.</span></span></label></div>`,
    'Создать команду', async v => {
      const r = await act(() => api.createTeam(t.id, { name: v.name, tag: v.tag, logo: v.logo, open: !!v.open }));
      if (!r) return false;
      toast('Команда создана! Код для приглашения: ' + r.join_code);
      go(`#/t/${t.id}/teams`); refreshT();
    });
    bindImgFields(m);
  }
  function joinCodeDialog(t) {
    form('Вступить в команду по коду', `<div class="field"><label class="f">Код команды</label><input type="text" name="code" required placeholder="Например, 7F3A9C1B" style="text-transform:uppercase;letter-spacing:.1em"><div class="hint">Код выдаёт капитан команды.</div></div>`,
      'Вступить', async v => { const ok = await act(() => api.joinByCode(t.id, v.code), 'Вы в команде!'); if (!ok) return false; refreshT(); });
  }

  // ---------- вкладка «Обзор» ----------
  function tabOverview(el, c) {
    const { t } = c;
    el.innerHTML = `<div class="two">
      <div class="card">
        <div class="box-title">О турнире</div>
        <div class="pre">${t.description ? esc(t.description) : '<span class="sub">Организатор пока не добавил описание.</span>'}</div>
        ${t.rules ? `<div class="box-title" style="margin-top:24px">Правила</div><div class="pre">${esc(t.rules)}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="card"><div class="box-title">Детали</div><div class="kv">
          <span>Начало</span><b>${esc(fmtDate(t.starts_at))}</b>
          ${t.reg_closes_at ? `<span>Регистрация до</span><b>${esc(fmtDate(t.reg_closes_at))}</b>` : ''}
          <span>Формат</span><b>${esc(t.mode)}, ${esc(fmtName(t).toLowerCase())}</b>
          ${t.format === 'groups' ? `<span>Группы</span><b>${plural(t.group_count, 'группа', 'группы', 'групп')}, из каждой выходят ${t.group_advance}</b>` : ''}
          ${t.checkin_minutes ? `<span>Чек-ин</span><b>за ${t.checkin_minutes} мин до старта</b>` : ''}
          ${t.team_size > 1 ? `<span>Состав</span><b>${t.team_size} игроков${t.max_subs ? ` + до ${t.max_subs} зап.` : ''}</b>` : ''}
          <span>Матчи</span><b>Bo${t.bo_default}, полуфинал Bo${t.bo_semifinal}, финал Bo${t.bo_final}</b>
          <span>Регион</span><b>${esc(t.region)}</b>
          <span>Призы</span><b>${esc(t.prize || '—')}</b>
          <span>Взнос</span><b>${esc(t.entry_fee || 'Бесплатно')}</b>
        </div>${t.contact_url ? `<a class="btn block" style="margin-top:16px" href="${esc(t.contact_url)}" target="_blank" rel="noopener">Связь с организатором ${I.ext}</a>` : ''}</div>
        ${noVeto(t) ? `<div class="card"><div class="box-title">Карта</div>${t.map_pool[0] ? `<div class="maps"><span class="map-tag">${esc(t.map_pool[0])}</span></div><div class="hint">Все матчи на этой карте, без пиков и банов.</div>` : '<div class="hint" style="margin:0">Без пиков и банов — карту назначает организатор.</div>'}</div>`
          : `<div class="card"><div class="box-title">Пул карт</div><div class="maps">${t.map_pool.map(m => `<span class="map-tag">${esc(m)}</span>`).join('')}</div></div>`}
      </div></div>`;
  }

  // ---------- вкладка «Команды» ----------
  async function tabTeams(el, c) {
    const { t, teams, me, myTeam, canManage } = c;
    const agents = tCache.agents || [], invites = tCache.invites || [];
    if (!teams.length && !agents.length) { el.innerHTML = `<div class="empty"><div class="head">Пока никого</div>${regOpen(t) ? 'Станьте первыми — регистрация открыта.' : 'Регистрация ещё не началась или уже закрыта.'}</div>`; return; }
    let contacts = {};
    const ciStage = t.checkin_minutes && ['registration', 'closed'].includes(t.stage);
    const draw = () => {
      const canJoin = me && !myTeam && regOpen(t);
      const sorted = [...teams].sort((a, b) => (b === myTeam) - (a === myTeam) || (a.seed || 999) - (b.seed || 999));
      const capTeam = myTeam && myTeam.captain_id === me.id && t.team_size > 1 && regOpen(t) && myTeam.members.length < t.team_size + t.max_subs ? myTeam : null;
      const ciCount = teams.filter(x => x.checked_in_at).length;
      const agentHtml = !agents.length || t.mode === '1v1' ? '' : `<div class="sec-head" style="margin:30px 0 12px"><div><h2 style="font-size:22px">Свободные агенты <span class="sub" style="font-size:15px">${agents.length}</span></h2><div class="sub">Игроки ищут команду${capTeam ? ' — пригласите их в свою' : ''}</div></div></div>
        <div class="agents">${agents.map(a => {
          const invited = myTeam && invites.some(i => i.team_id === myTeam.id && i.user_id === a.user_id);
          const ct = contacts[a.user_id];
          return `<div class="agent">${avatar(a)}<div class="grow"><div class="an"><a href="#/u/${esc(a.steam_id)}"><b>${esc(a.nickname)}</b></a>${a.faceit_level ? `<span class="lvl l${a.faceit_level}">${a.faceit_level}</span>` : ''}${a.premier_rating ? `<span class="hint" style="margin:0">Premier ${a.premier_rating}</span>` : ''}</div>
            ${a.note ? `<div class="note">${esc(a.note)}</div>` : ''}${ct && (ct.discord || ct.telegram) ? `<div class="hint" style="margin:2px 0 0">${ct.discord ? 'Discord: ' + esc(ct.discord) : ''}${ct.discord && ct.telegram ? ' · ' : ''}${ct.telegram ? 'Telegram: ' + esc(ct.telegram) : ''}</div>` : ''}</div>
            ${me && a.user_id === me.id ? '<span class="badge">это вы</span>' : invited ? `<button class="btn sm ghost" data-uninv="${esc(myTeam.id)}|${esc(a.user_id)}">Отозвать</button>` : capTeam ? `<button class="btn sm pri" data-inv="${esc(a.user_id)}">Пригласить</button>` : ''}</div>`;
        }).join('')}</div>`;
      el.innerHTML = `${ciStage ? `<div class="notice ${checkinOpen(t) ? 'warn' : ''}" style="margin-bottom:16px"><div><b>Чек-ин ${checkinOpen(t) ? 'открыт' : 'за ' + t.checkin_minutes + ' мин до старта'}.</b> Подтвердили участие: ${ciCount} из ${teams.length}. В сетку попадут только команды с чек-ином.</div></div>` : ''}
        ${teams.length ? '' : '<div class="empty" style="padding:30px"><div class="head">Команд пока нет</div></div>'}<div class="teams">${sorted.map(tm => {
        const mine = tm === myTeam, cap = me && tm.captain_id === me.id, full = tm.members.length >= t.team_size + t.max_subs;
        const ctl = cap || canManage;
        const members = tm.members.map(m => {
          const ct = contacts[m.user_id];
          return `<li>${avatar(m, 'sm')}<a class="nm" href="#/u/${esc(m.steam_id)}">${esc(m.nickname)}</a>
            ${m.faceit_level ? `<span class="lvl l${m.faceit_level}" title="FACEIT ${m.faceit_level}">${m.faceit_level}</span>` : ''}
            ${t.team_size > 1 ? `<span class="role ${m.role === 'captain' ? 'cap' : ''}">${{ captain: 'Капитан', player: 'Игрок', sub: 'Запас' }[m.role]}</span>` : ''}
            ${ctl && m.role !== 'captain' && t.team_size > 1 ? `<button class="btn sm ghost" data-cap="${esc(tm.id)}|${esc(m.user_id)}" title="Сделать капитаном">★</button><button class="btn sm ghost danger" data-kick="${esc(tm.id)}|${esc(m.user_id)}" title="Исключить">✕</button>` : ''}</li>
            ${ct && (ct.discord || ct.telegram) ? `<li style="padding-top:0;padding-left:50px;font-size:12px;color:var(--muted)">${ct.discord ? 'Discord: ' + esc(ct.discord) : ''}${ct.discord && ct.telegram ? ' · ' : ''}${ct.telegram ? 'Telegram: ' + esc(ct.telegram) : ''}</li>` : ''}`;
        }).join('');
        let foot = '';
        if (cap && t.team_size > 1) foot += `<span class="hint" style="margin:0">Код:</span><span class="code" data-code="${esc(tm.id)}">••••••••</span><button class="btn sm" data-show-code="${esc(tm.id)}">Показать</button><button class="btn sm" data-edit="${esc(tm.id)}">Изменить</button>`;
        if (mine && !cap) foot += `<button class="btn sm danger" data-leave="${esc(tm.id)}">Покинуть команду</button>`;
        if (cap && regOpen(t)) foot += `<button class="btn sm danger" data-disband="${esc(tm.id)}">${t.team_size > 1 ? 'Распустить' : 'Отменить участие'}</button>`;
        if (canManage && !cap) foot += `<button class="btn sm danger" data-remove="${esc(tm.id)}">Удалить из турнира</button>`;
        if (canJoin && !full) foot += tm.is_open ? `<button class="btn sm pri" data-join="${esc(tm.id)}">Вступить</button>` : `<button class="btn sm" data-join-closed="${esc(tm.id)}">${I.lock}Вступить по коду</button>`;
        if (ciStage && canManage) foot += `<button class="btn sm ${tm.checked_in_at ? 'ghost' : 'ok'}" data-ci-set="${esc(tm.id)}|${tm.checked_in_at ? 0 : 1}">${tm.checked_in_at ? 'Снять чек-ин' : 'Отметить чек-ин'}</button>`;
        else if (ciStage && cap && !tm.checked_in_at && checkinOpen(t)) foot += `<button class="btn sm ok" data-ci="${esc(tm.id)}">Подтвердить участие</button>`;
        const pend = invites.filter(i => i.team_id === tm.id && (cap || canManage));
        const pendHtml = pend.length ? `<div class="pend">Приглашены: ${pend.map(i => { const a = agents.find(x => x.user_id === i.user_id); return `<span>${esc(me && i.user_id === me.id ? 'вы' : a ? a.nickname : 'игрок')}<button class="x" data-uninv="${esc(tm.id)}|${esc(i.user_id)}" title="Отозвать">×</button></span>`; }).join('')}</div>` : '';
        const ciBadge = t.checkin_minutes ? (tm.checked_in_at ? '<span class="badge reg" title="Участие подтверждено">✓ чек-ин</span>' : ciStage ? '<span class="badge" title="Ещё не подтвердили участие">нет чек-ина</span>' : '') : '';
        return `<div class="team ${mine ? 'mine' : ''}"><div class="th">${teamLogo(tm)}<div style="flex:1;min-width:0"><h3>${esc(tm.name)}</h3>
          <div class="meta">${tm.seed ? `Посев #${tm.seed} · ` : ''}${t.team_size > 1 ? `${tm.members.length} / ${t.team_size + t.max_subs}` : ''}${t.team_size > 1 ? (tm.is_open ? ' · открытая' : ' · по коду') : ''}</div></div>${ciBadge}${tm.tag ? `<span class="badge">${esc(tm.tag)}</span>` : ''}</div>
          <ul>${members}</ul>${pendHtml}${foot ? `<div class="tf">${foot}</div>` : ''}</div>`;
      }).join('')}</div>${agentHtml}`;
      bind();
    };
    const bind = () => {
      const [, id] = [0, t.id];
      $$('[data-join]', el).forEach(b => b.onclick = async () => { if (await act(() => api.joinTeam(b.dataset.join), 'Вы в команде!')) refreshT(); });
      $$('[data-join-closed]', el).forEach(b => b.onclick = () => form('Вступить по коду', `<div class="field"><label class="f">Код команды</label><input type="text" name="code" required style="text-transform:uppercase;letter-spacing:.1em"></div>`, 'Вступить', async v => { if (!await act(() => api.joinTeam(b.dataset.joinClosed, v.code), 'Вы в команде!')) return false; refreshT(); }));
      $$('[data-show-code]', el).forEach(b => b.onclick = async () => {
        const code = await act(() => api.teamCode(b.dataset.showCode)); if (!code) return;
        $(`[data-code="${b.dataset.showCode}"]`, el).textContent = code;
        b.textContent = 'Копировать'; b.onclick = () => { navigator.clipboard.writeText(code).then(() => toast('Код скопирован')); };
      });
      $$('[data-edit]', el).forEach(b => b.onclick = () => editTeamDialog(teams.find(x => x.id === b.dataset.edit)));
      $$('[data-leave]', el).forEach(b => b.onclick = async () => { if (await ask('Покинуть команду?', { ok: 'Покинуть', danger: true }) && await act(() => api.leaveTeam(b.dataset.leave), 'Вы покинули команду')) refreshT(); });
      $$('[data-disband]', el).forEach(b => b.onclick = async () => { if (await ask('Распустить команду? Все игроки выйдут из неё.', { ok: 'Распустить', danger: true }) && await act(() => api.disbandTeam(b.dataset.disband), 'Готово')) refreshT(); });
      $$('[data-remove]', el).forEach(b => b.onclick = async () => { if (await ask('Удалить команду из турнира?', { ok: 'Удалить', danger: true }) && await act(() => api.disbandTeam(b.dataset.remove), 'Команда удалена')) refreshT(); });
      $$('[data-kick]', el).forEach(b => b.onclick = async () => { const [tm, u] = b.dataset.kick.split('|'); if (await ask('Исключить игрока из команды?', { ok: 'Исключить', danger: true }) && await act(() => api.kick(tm, u), 'Игрок исключён')) refreshT(); });
      $$('[data-cap]', el).forEach(b => b.onclick = async () => { const [tm, u] = b.dataset.cap.split('|'); if (await ask('Передать капитанство этому игроку?') && await act(() => api.makeCaptain(tm, u), 'Капитан изменён')) refreshT(); });
      $$('[data-inv]', el).forEach(b => b.onclick = async () => { b.disabled = true; if (await act(() => api.invitePlayer(myTeam.id, b.dataset.inv), 'Приглашение отправлено')) refreshT(); else b.disabled = false; });
      $$('[data-uninv]', el).forEach(b => b.onclick = async () => { const [tm, u] = b.dataset.uninv.split('|'); if (await act(() => api.cancelInvite(tm, u), 'Приглашение отозвано')) refreshT(); });
      $$('[data-ci]', el).forEach(b => b.onclick = async () => { if (await act(() => api.checkin(b.dataset.ci), 'Участие подтверждено')) refreshT(); });
      $$('[data-ci-set]', el).forEach(b => b.onclick = async () => { const [tm, v] = b.dataset.ciSet.split('|'); if (await act(() => api.setCheckin(tm, v === '1'), v === '1' ? 'Чек-ин отмечен' : 'Чек-ин снят')) refreshT(); });
    };
    draw();
    if (me) { contacts = await api.contactsFor([...teams.flatMap(x => x.members.map(m => m.user_id)), ...agents.map(a => a.user_id)]).catch(() => ({})); if (Object.keys(contacts).length) draw(); }
  }
  function editTeamDialog(tm) {
    const md = form('Команда', `
      <div class="grid2"><div class="field"><label class="f">Название</label><input type="text" name="name" value="${esc(tm.name)}" required minlength="2" maxlength="32"></div>
      <div class="field"><label class="f">Тег</label><input type="text" name="tag" value="${esc(tm.tag || '')}" maxlength="6"></div></div>
      ${imgField('logo_url', 'Логотип', tm.logo_url, 'logo')}
      <div class="field"><label class="chk"><input type="checkbox" name="is_open" ${tm.is_open ? 'checked' : ''}><span>Открытая команда — вступить может любой</span></label></div>
      <div class="field"><label class="chk"><input type="checkbox" name="new_code"><span>Выпустить новый код (старый перестанет работать)</span></label></div>`,
    'Сохранить', async v => { const ok = await act(() => api.updateTeam(tm.id, { name: v.name, tag: v.tag, logo_url: v.logo_url, is_open: !!v.is_open, new_code: !!v.new_code }), 'Сохранено'); if (!ok) return false; refreshT(); });
    bindImgFields(md);
  }

  // ---------- вкладка «Сетка» ----------
  function tabBracket(el, c) {
    const { t, matches, teamById, myTeam } = c;
    if (!matches.length) { el.innerHTML = `<div class="empty"><div class="head">Сетки пока нет</div>${t.format === 'groups' ? 'Группы появятся, когда организатор закроет регистрацию и распределит команды.' : 'Она появится, когда организатор закроет регистрацию и сформирует пары.'}</div>`; return; }
    const by = br => matches.filter(m => (m.bracket || 'upper') === br);
    const upper = by('upper'), lower = by('lower'), grand = by('grand'), groups = by('group');
    const dbl = lower.length > 0;
    const cols = (list, title, lowerBr) => {
      const total = Math.max(...list.map(m => m.round)), out = [];
      for (let r = 1; r <= total; r++) {
        const rm = list.filter(m => m.round === r).sort((a, b) => a.position - b.position);
        const straight = lowerBr && r % 2 === 1 && r < total;
        out.push(`<div class="bround ${straight ? 'st' : ''}"><div class="rt">${title(r, total)}<small>Bo${rm[0] ? rm[0].best_of : ''}</small></div><div class="bcol">${rm.map(m => `<div class="bslot">${bmatch(m, teamById, myTeam, t)}</div>`).join('')}</div></div>`);
      }
      return `<div class="bracket-scroll"><div class="bracket">${out.join('')}</div></div>`;
    };
    let html = '';
    if (groups.length) {
      const st = window.OrganizmApi.groupStandings(groups, c.teams);
      const gnums = [...new Set(groups.map(m => m.group_no))].sort((a, b) => a - b);
      html += `<div class="groups">${gnums.map(g => {
        const rows = st.filter(r => r.group_no === g), gm = groups.filter(m => m.group_no === g).sort((a, b) => a.round - b.round || a.position - b.position);
        const left = gm.filter(m => m.status !== 'finished').length;
        return `<div class="card group"><div class="gh"><h3>Группа ${groupLetter(g)}</h3><span class="hint" style="margin:0">${left ? `осталось ${plural(left, 'матч', 'матча', 'матчей')}` : 'все матчи сыграны'}</span></div>
          <table class="gtable"><thead><tr><th>#</th><th>Команда</th><th title="Сыграно">И</th><th title="Победы">В</th><th title="Поражения">П</th><th title="Разница счёта">±</th></tr></thead><tbody>
          ${rows.map(r => { const tm = teamById[r.team_id]; return `<tr class="${r.place <= t.group_advance ? 'adv' : ''} ${myTeam && myTeam.id === r.team_id ? 'me' : ''}"><td>${r.place}</td><td><span class="row" style="gap:8px;flex-wrap:nowrap">${teamLogo(tm, 'sm')}<b>${esc(tm ? tm.name : '?')}</b></span></td><td>${r.played}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.diff > 0 ? '+' : ''}${r.diff}</td></tr>`; }).join('')}
          </tbody></table>
          <div class="gmatches">${gm.map(m => { const a = teamById[m.team_a], b = teamById[m.team_b], fin = m.status === 'finished';
            return `<div class="gm ${m.status === 'live' ? 'live' : ''}" data-gm="${esc(m.id)}"><span class="r">Тур ${m.round}</span><span class="tn ${fin && m.winner_id === m.team_a ? 'w' : ''}">${esc(a ? a.name : 'TBD')}</span><span class="s">${fin ? `${m.score_a}:${m.score_b}` : m.status === 'live' ? '<span style="color:#ff8587">●</span>' : 'vs'}</span><span class="tn r2 ${fin && m.winner_id === m.team_b ? 'w' : ''}">${esc(b ? b.name : 'TBD')}</span></div>`; }).join('')}</div></div>`;
      }).join('')}</div>
      <div class="hint">Из каждой группы в плей-офф выходят ${plural(t.group_advance, 'команда', 'команды', 'команд')} (выделены). Места: победы, затем разница счёта.</div>`;
      html += `<h3 class="bsec">Плей-офф</h3>`;
      html += upper.length ? cols(upper, roundName) : `<div class="empty" style="padding:28px">Плей-офф сформируется после группового этапа.</div>`;
    } else if (dbl) {
      html += `<h3 class="bsec">Верхняя сетка</h3>` + cols(upper, (r, n) => r === n ? 'Финал' : r === n - 1 ? 'Полуфинал' : 'Раунд ' + r);
      html += `<h3 class="bsec">Нижняя сетка <span class="hint" style="margin:0;text-transform:none;letter-spacing:0">второй шанс для проигравших</span></h3>` + cols(lower, (r, n) => r === n ? 'Финал' : 'Раунд ' + r, true);
      if (grand.length) html += `<h3 class="bsec">Гранд-финал</h3><div style="max-width:300px">${bmatch(grand[0], teamById, myTeam, t)}</div>`;
    } else {
      html += cols(upper, roundName);
    }
    el.innerHTML = html + `<div class="hint">Нажмите на матч, чтобы открыть детали, пики и баны.</div>`;
    $$('.bm:not(.void)', el).forEach(b => b.onclick = () => go(`#/t/${t.id}/m/${b.dataset.m}`));
    $$('[data-gm]', el).forEach(b => b.onclick = () => go(`#/t/${t.id}/m/${b.dataset.gm}`));
  }
  function bmatch(m, teamById, myTeam, t) {
    const row = (id, sc) => {
      const tm = teamById[id];
      if (!tm) return `<div class="bt e"><span class="seed"></span><span class="nm">${m.is_bye ? '—' : 'TBD'}</span><span class="sc"></span></div>`;
      const cls = m.winner_id ? (m.winner_id === id ? 'w' : 'l') : '';
      return `<div class="bt ${cls}"><span class="seed">${tm.seed || ''}</span>${teamLogo(tm, 'sm')}<span class="nm">${esc(tm.name)}</span><span class="sc">${m.is_bye ? '' : sc ?? ''}</span></div>`;
    };
    const mine = myTeam && (m.team_a === myTeam.id || m.team_b === myTeam.id);
    const meta = m.is_bye ? 'проход без игры' : m.status === 'live' ? '<span style="color:#ff8587">● идёт</span>' : m.status === 'finished' ? 'завершён' : m.scheduled_at ? esc(fmtDate(m.scheduled_at)) : 'время не назначено';
    const isVoid = m.is_bye && !m.team_a && !m.team_b;
    return `<div class="bm ${m.status === 'live' ? 'live' : ''} ${mine ? 'mine' : ''} ${isVoid ? 'void' : m.is_bye ? 'bye' : ''}" data-m="${esc(m.id)}">${row(m.team_a, m.score_a)}${row(m.team_b, m.score_b)}<div class="bmeta"><span>${meta}</span><span>${m.veto && m.veto.decider ? esc(m.veto.decider) : ''}</span></div></div>`;
  }

  // ---------- вкладка «Матчи» ----------
  function tabMatches(el, c) {
    const { t, matches, teamById, myTeam } = c;
    const real = matches.filter(m => !m.is_bye);
    if (!real.length) { el.innerHTML = `<div class="empty"><div class="head">Матчей пока нет</div>Они появятся после формирования сетки.</div>`; return; }
    let html = '';
    if (myTeam) {
      const mine = real.filter(m => m.team_a === myTeam.id || m.team_b === myTeam.id);
      if (mine.length) html += `<div class="rgroup" style="color:var(--accent)">Матчи вашей команды</div><div class="mlist">${mine.map(m => mrow(m, teamById, matches)).join('')}</div>`;
    }
    // сначала идущие и ближайшие стадии, сыгранные — ниже
    const ORD = { group: 0, upper: 1, lower: 2, grand: 3 };
    const groups = new Map();
    [...real].sort((a, b) => ORD[a.bracket || 'upper'] - ORD[b.bracket || 'upper'] || a.round - b.round || (a.group_no || 0) - (b.group_no || 0) || a.position - b.position)
      .forEach(m => { const k = m.bracket === 'group' ? 'Групповой этап · Тур ' + m.round : matchName(m, matches); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); });
    const entries = [...groups.entries()];
    const active = entries.filter(([, l]) => l.some(m => m.status !== 'finished')), done = entries.filter(([, l]) => l.every(m => m.status === 'finished')).reverse();
    for (const [k, l] of [...active, ...done]) html += `<div class="rgroup">${esc(k)}</div><div class="mlist">${l.map(m => mrow(m, teamById, matches)).join('')}</div>`;
    el.innerHTML = html;
    $$('.mrow', el).forEach(r => r.onclick = () => go(`#/t/${t.id}/m/${r.dataset.m}`));
  }
  function mrow(m, teamById, matches) {
    const a = teamById[m.team_a], b = teamById[m.team_b];
    const label = m.bracket === 'group' ? `<div class="ml">Группа ${groupLetter(m.group_no)}</div>` : '';
    const st = m.status === 'live' ? '<span class="badge live">Идёт</span>' : m.status === 'finished' ? '<span class="badge done">Сыгран</span>' : m.veto && m.veto.log && m.veto.log.length && !m.veto.decider ? '<span class="badge soon">Пики/баны</span>' : '<span class="badge">Ожидает</span>';
    return `<div class="mrow" data-m="${esc(m.id)}"><div class="when">${label}${m.scheduled_at ? esc(fmtDay(m.scheduled_at)) + '<br>' + esc(new Date(m.scheduled_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })) : 'время не назначено'}</div>
      <div class="tm r"><span>${a ? esc(a.name) : 'TBD'}</span>${teamLogo(a, 'sm')}</div>
      <div class="score">${m.status === 'finished' ? `${m.score_a}:${m.score_b}` : '<span style="color:var(--dim);font-size:14px">Bo' + m.best_of + '</span>'}</div>
      <div class="tm">${teamLogo(b, 'sm')}<span>${b ? esc(b.name) : 'TBD'}</span></div>
      <div class="st">${st}</div></div>`;
  }

  // ---------- окно матча: пики и баны, результат ----------
  function openMatch(mid) {
    const c = ctx(), { t, matches, teamById, me, canManage } = c;
    const m = matches.find(x => x.id === mid);
    if (!m) return;
    const A = teamById[m.team_a], B = teamById[m.team_b];
    const seq = window.OrganizmApi.vetoSequence(m.best_of, t.map_pool.length);
    const log = (m.veto && m.veto.log) || [];
    const step = log.length, done = step >= seq.length || !!(m.veto && m.veto.decider);
    const turnSide = step % 2 === 0 ? 'A' : 'B', turnTeam = turnSide === 'A' ? A : B;
    const myTurn = !done && A && B && m.status !== 'finished' && me && turnTeam && turnTeam.captain_id === me.id;
    const stateOf = map => { const l = log.find(x => x.map === map); if (l) return l; if (m.veto && m.veto.decider === map) return { action: 'decider' }; return null; };
    const sideName = s => { const tm = (s === 'A' ? A : B) || {}; return esc(tm.name || ''); };
    const sideTag = s => { const tm = (s === 'A' ? A : B) || {}; return esc(tm.tag || tm.name || ''); };
    const tiles = t.map_pool.map(map => {
      const s = stateOf(map);
      const label = !s ? (myTurn ? (seq[step] === 'ban' ? 'Забанить' : 'Выбрать') : '') : s.action === 'decider' ? 'Решающая' : `${s.action === 'ban' ? 'Бан' : 'Пик'} · ${sideTag(s.side)}`;
      const cls = s ? (s.action === 'ban' ? 'ban' : s.action === 'pick' ? 'pick' : 'dec') : '';
      return myTurn && !s ? `<button class="vmap" data-map="${esc(map)}" style="--mapbg:${mapBg(map)}"><span class="ma">${label}</span><span class="mn">${esc(map)}</span></button>`
        : `<div class="vmap ${cls}" style="--mapbg:${mapBg(map)}"><span class="ma">${label}</span><span class="mn">${esc(map)}</span></div>`;
    }).join('');
    const picks = log.filter(l => l.action === 'pick').map(l => l.map).concat(m.veto && m.veto.decider ? [m.veto.decider] : []);
    let turn = '';
    if (!A || !B) turn = '<div class="turn">Пики и баны откроются, когда определятся обе команды.</div>';
    else if (m.status === 'finished' && !done) turn = '';
    else if (done) turn = `<div class="turn">Пики и баны завершены. Карты матча: <b>${picks.map(esc).join(', ')}</b></div>`;
    else turn = `<div class="turn ${myTurn ? 'me' : ''}">${myTurn ? `<b>Ваш ход:</b> ${seq[step] === 'ban' ? 'забаньте карту' : 'выберите карту'}.` : `Ход команды <b>${esc(turnTeam.name)}</b> — ${seq[step] === 'ban' ? 'бан' : 'пик'} (шаг ${step + 1} из ${seq.length}). Действует капитан.`}</div>`;

    const opts = (sel) => `<option value="">— пусто —</option>` + c.teams.map(x => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    const manage = canManage ? `<div class="form-sec" style="padding-bottom:0"><h3>Управление матчем</h3>
      <div class="grid2">
        <div class="field"><label class="f">Счёт ${esc(A ? A.name : 'A')}</label><input type="number" min="0" id="sa" value="${m.score_a ?? ''}"></div>
        <div class="field"><label class="f">Счёт ${esc(B ? B.name : 'B')}</label><input type="number" min="0" id="sb" value="${m.score_b ?? ''}"></div>
      </div>
      <div class="hint" style="margin:-8px 0 12px">Для Bo1 — счёт по раундам (13:9), для Bo3/Bo5 — по картам (2:1). Победитель сам пройдёт дальше.</div>
      <div class="row" style="margin-bottom:18px"><button class="btn pri" id="saveRes" ${A && B ? '' : 'disabled'}>Сохранить результат</button>${m.winner_id && !m.is_bye ? '<button class="btn danger" id="resetRes">Сбросить результат</button>' : ''}</div>
      <div class="grid3">
        <div class="field"><label class="f">Время матча</label><input type="datetime-local" id="mtime" value="${toLocalInput(m.scheduled_at)}"></div>
        <div class="field"><label class="f">Формат</label><select id="mbo">${[1, 3, 5].map(b => `<option value="${b}" ${b === m.best_of ? 'selected' : ''}>Bo${b}</option>`).join('')}</select></div>
        <div class="field"><label class="f">Статус</label><select id="mst" ${m.winner_id ? 'disabled' : ''}><option value="pending" ${m.status === 'pending' ? 'selected' : ''}>Ожидает</option><option value="live" ${m.status === 'live' ? 'selected' : ''}>Идёт</option>${m.winner_id ? '<option selected>Сыгран</option>' : ''}</select></div>
      </div>
      <div class="grid2"><div class="field"><label class="f">Команда A</label><select id="mta">${opts(m.team_a)}</select></div><div class="field"><label class="f">Команда B</label><select id="mtb">${opts(m.team_b)}</select></div></div>
      <div class="row"><button class="btn" id="saveMatch">Сохранить матч</button>${log.length ? '<button class="btn danger" id="resetVeto">Сбросить пики/баны</button>' : ''}</div></div>` : '';

    const win = id => m.winner_id && m.winner_id === id ? 'w' : '';
    const md = modal(`${esc(matchName(m, matches))} · Bo${m.best_of}`, `
      <div class="versus">
        <div class="side ${win(m.team_a)}">${teamLogo(A)}<b>${A ? esc(A.name) : 'TBD'}</b></div>
        <div class="mid"><div class="big">${m.status === 'finished' && !m.is_bye ? `${m.score_a}:${m.score_b}` : 'VS'}</div>
          <div class="hint">${m.is_bye ? 'Проход без игры' : m.status === 'live' ? '<span style="color:#ff8587">● Матч идёт</span>' : m.scheduled_at ? esc(fmtDate(m.scheduled_at)) + ' · ' + relTime(m.scheduled_at) : 'Время не назначено'}</div></div>
        <div class="side ${win(m.team_b)}">${teamLogo(B)}<b>${B ? esc(B.name) : 'TBD'}</b></div>
      </div>
      ${m.is_bye ? '' : noVeto(t) ? `<div class="box-title">Карта</div><div class="turn">${t.map_pool[0] ? `Матч играется на <b>${esc(t.map_pool[0])}</b> — без пиков и банов.` : 'Без пиков и банов — карту назначает организатор.'}</div>` : `<div class="box-title">Пики и баны</div>${turn}<div class="veto">${tiles}</div>
      ${log.length ? `<div class="vlog">${log.map((l, i) => `<div>${i + 1}. <b>${sideName(l.side)}</b> ${l.action === 'ban' ? 'банит' : 'выбирает'} ${esc(l.map)}</div>`).join('')}${m.veto.decider ? `<div>Решающая карта: <b>${esc(m.veto.decider)}</b></div>` : ''}</div>` : ''}`}
      ${manage}`, { wide: true, onClose: () => { if (location.hash.includes('/m/')) history.replaceState(null, '', `#/t/${t.id}/${tCache._tab || 'bracket'}`); } });
    md.dataset.match = mid;
    $$('[data-map]', md).forEach(b => b.onclick = async () => {
      $$('[data-map]', md).forEach(x => x.disabled = true);
      if (await act(() => api.vetoAction(mid, b.dataset.map))) await refreshT(); else $$('[data-map]', md).forEach(x => x.disabled = false);
    });
    if (canManage) {
      const sr = $('#saveRes', md); if (sr) sr.onclick = async () => { if (await act(() => api.reportResult(mid, Number($('#sa', md).value), Number($('#sb', md).value)), 'Результат сохранён')) refreshT(); };
      const rr = $('#resetRes', md); if (rr) rr.onclick = async () => { if (await ask('Сбросить результат? Команда будет убрана из следующих раундов.', { ok: 'Сбросить', danger: true }) && await act(() => api.resetResult(mid), 'Результат сброшен')) refreshT(); };
      $('#saveMatch', md).onclick = async () => {
        const p = { scheduled_at: fromLocalInput($('#mtime', md).value) || '', best_of: Number($('#mbo', md).value), team_a: $('#mta', md).value, team_b: $('#mtb', md).value };
        if (!m.winner_id) p.status = $('#mst', md).value;
        if (await act(() => api.updateMatch(mid, p), 'Матч обновлён')) refreshT();
      };
      const rv = $('#resetVeto', md); if (rv) rv.onclick = async () => { if (await ask('Сбросить все пики и баны этого матча?', { ok: 'Сбросить', danger: true }) && await act(() => api.resetVeto(mid), 'Пики и баны сброшены')) refreshT(); };
    }
  }

  // ---------- вкладка «Анонсы» ----------
  function tabNews(el, c) {
    const { t, canManage } = c, list = tCache.announcements;
    el.innerHTML = `<div style="max-width:760px">
      ${canManage ? `<div class="card" style="margin-bottom:16px"><div class="field"><label class="f">Новый анонс</label><textarea id="annText" maxlength="2000" placeholder="Например: полуфиналы стартуют в 21:00, сервер — connect …"></textarea></div><button class="btn pri" id="annAdd">Опубликовать</button></div>` : ''}
      ${list.length ? `<div class="list">${list.map(a => `<div class="ann"><div class="when"><span>${esc(fmtDate(a.created_at))}</span>${canManage ? `<button class="btn sm ghost danger" data-del="${esc(a.id)}">Удалить</button>` : ''}</div><div class="pre">${esc(a.body)}</div></div>`).join('')}</div>`
        : '<div class="empty"><div class="head">Анонсов нет</div>Здесь организатор публикует новости турнира.</div>'}</div>`;
    const add = $('#annAdd', el);
    if (add) add.onclick = async () => { const v = $('#annText', el).value.trim(); if (!v) return toast('Введите текст анонса', 'bad'); if (await act(() => api.addAnnouncement(t.id, v), 'Анонс опубликован')) refreshT(); };
    $$('[data-del]', el).forEach(b => b.onclick = async () => { if (await ask('Удалить анонс?', { ok: 'Удалить', danger: true }) && await act(() => api.deleteAnnouncement(b.dataset.del), 'Удалено')) refreshT(); });
  }

  // ---------- вкладка «Управление» ----------
  function tabManage(el, c) {
    const { t, teams, matches } = c;
    let order = [...teams].sort((a, b) => (a.seed || 999) - (b.seed || 999) || a.created_at.localeCompare(b.created_at)).map(x => x.id);
    const pool = teams.filter(x => x.checked_in_at).length;
    const groupM = matches.filter(m => m.bracket === 'group'), groupLeft = groupM.filter(m => m.status !== 'finished').length;
    const stages = [['registration', 'Регистрация'], ['closed', 'Регистрация закрыта'], ['ongoing', 'Идёт'], ['finished', 'Завершён'], ['cancelled', 'Отменён']];
    el.innerHTML = `<div class="two">
      <div class="card form-card" id="editBox"></div>
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="card"><div class="box-title">Стадия турнира</div>
          <div class="side-menu">${stages.map(([k, l]) => `<button class="btn sm ${t.stage === k ? 'pri' : 'ghost'}" style="justify-content:flex-start" data-stage="${k}">${l}</button>`).join('')}</div>
          <div class="hint">Регистрация закрывается сама в указанное время. «Идёт» включается автоматически при создании сетки, «Завершён» — после финала.</div></div>
        <div class="card"><div class="box-title">${t.format === 'groups' ? 'Группы и плей-офф' : 'Сетка'} <span class="badge" style="margin-left:6px">${esc(fmtName(t))}</span></div>
          ${teams.length < 2 ? '<div class="hint" style="margin:0">Нужно минимум 2 команды.</div>' : `
          ${t.checkin_minutes ? `<div class="notice ${pool < teams.length ? 'warn' : ''}" style="margin-bottom:10px"><div>Чек-ин прошли <b>${pool} из ${teams.length}</b>. В ${t.format === 'groups' ? 'группы' : 'сетку'} попадут только они.</div></div>` : ''}
          <div class="hint" style="margin:0 0 10px">${t.format === 'groups' ? 'Порядок посева: команды раскладываются по группам «змейкой», чтобы сильные не попали в одну группу.' : 'Порядок посева: №1 — сильнейшая. Сильные команды разводятся по сетке, лишние места превращаются в проходы.'}</div>
          <div class="order" id="order"></div>
          <div class="row" style="margin-top:12px"><button class="btn pri sm" id="genSeed">${t.format === 'groups' ? 'Сформировать группы' : 'Сформировать по порядку'}</button><button class="btn sm" id="genRand">Случайный посев</button></div>
          ${matches.length ? `<div class="hint">${t.format === 'groups' ? 'Группы' : 'Сетка'} уже есть — повторное формирование удалит все результаты.</div>` : ''}
          ${t.format === 'groups' && groupM.length ? `<div class="form-sec" style="padding:14px 0 0;margin-top:14px"><b>Плей-офф</b><div class="hint" style="margin:4px 0 10px">${groupLeft ? `Сыграйте ещё ${plural(groupLeft, 'матч', 'матча', 'матчей')} групп, чтобы сформировать плей-офф.` : `Группы сыграны. В плей-офф выйдут ${plural(t.group_advance * new Set(groupM.map(m => m.group_no)).size, 'команда', 'команды', 'команд')}: первые места против вторых из соседних групп.`}</div>
            <button class="btn ${groupLeft ? '' : 'pri'} sm" id="genPO" ${groupLeft ? 'disabled' : ''}>${matches.some(m => m.bracket === 'upper') ? 'Пересоздать плей-офф' : 'Сформировать плей-офф'}</button></div>` : ''}`}
        </div>
        <div class="card"><div class="box-title">Опасная зона</div><button class="btn danger block" id="delT">Удалить турнир</button></div>
      </div></div>`;
    tournamentForm($('#editBox', el), t, async p => { if (await act(() => api.updateTournament(t.id, p), 'Изменения сохранены')) refreshT(); }, 'Сохранить изменения');
    const drawOrder = () => {
      const box = $('#order', el); if (!box) return;
      box.innerHTML = order.map((id, i) => { const tm = teams.find(x => x.id === id); return `<div class="li"><span class="num">${i + 1}</span>${teamLogo(tm, 'sm')}<span class="grow"><b>${esc(tm.name)}</b></span><button class="btn sm ghost" data-up="${i}" ${i ? '' : 'disabled'}>▲</button><button class="btn sm ghost" data-down="${i}" ${i < order.length - 1 ? '' : 'disabled'}>▼</button></div>`; }).join('');
      $$('[data-up]', box).forEach(b => b.onclick = () => { const i = +b.dataset.up; [order[i - 1], order[i]] = [order[i], order[i - 1]]; drawOrder(); });
      $$('[data-down]', box).forEach(b => b.onclick = () => { const i = +b.dataset.down; [order[i + 1], order[i]] = [order[i], order[i + 1]]; drawOrder(); });
    };
    drawOrder();
    const gen = async shuffle => {
      if (matches.length && !await ask('Пересоздать сетку? Все матчи и результаты будут удалены.', { ok: 'Пересоздать', danger: true })) return;
      if (await act(() => api.generateBracket(t.id, shuffle ? null : order, shuffle), 'Сетка сформирована')) { await refreshT(); go(`#/t/${t.id}/bracket`); }
    };
    const gs = $('#genSeed', el); if (gs) gs.onclick = () => gen(false);
    const gr = $('#genRand', el); if (gr) gr.onclick = () => gen(true);
    const po = $('#genPO', el); if (po) po.onclick = async () => {
      if (matches.some(m => m.bracket === 'upper') && !await ask('Пересоздать плей-офф? Его результаты будут удалены.', { ok: 'Пересоздать', danger: true })) return;
      if (await act(() => api.generatePlayoff(t.id), 'Плей-офф сформирован')) { await refreshT(); go(`#/t/${t.id}/bracket`); }
    };
    $$('[data-stage]', el).forEach(b => b.onclick = async () => { if (await act(() => api.setStage(t.id, b.dataset.stage), 'Стадия изменена')) refreshT(); });
    $('#delT', el).onclick = async () => { if (await ask(`Удалить турнир «${esc(t.title)}» навсегда?`, { ok: 'Удалить', danger: true }) && await act(() => api.deleteTournament(t.id), 'Турнир удалён')) go('#/'); };
  }

  // ---------- форма турнира (создание и редактирование) ----------
  function tournamentForm(box, t, onSubmit, submitLabel) {
    t = { ...(t && t.id ? {} : { mode: '5v5', max_teams: 16, max_subs: 1, region: 'RU / СНГ', map_pool: MAPS.slice(0, 7), bo_default: 1, bo_semifinal: 3, bo_final: 3, entry_fee: 'Бесплатно', format: 'single', group_count: 2, group_advance: 2, checkin_minutes: null }), ...(t || {}) };
    const fmt = t.format || 'single';
    const noPick = t.mode === '1v1' && t.map_pool.length < 5;
    const aimMap = noPick ? (t.map_pool[0] || '') : '';
    const pool = Array.from(new Set([...MAPS, ...(noPick ? [] : t.map_pool)]));
    const checked = noPick ? MAPS.slice(0, 7) : t.map_pool;
    const bo = (name, v) => `<select name="${name}">${[1, 3, 5].map(b => `<option value="${b}" ${b === v ? 'selected' : ''}>Bo${b}</option>`).join('')}</select>`;
    box.innerHTML = `<form novalidate>
      <div class="form-sec" style="padding-top:0"><h3>Основное</h3>
        <div class="field"><label class="f">Название *</label><input type="text" name="title" maxlength="80" required value="${esc(t.title || '')}" placeholder="Например, Organizm Winter Cup"></div>
        <div class="grid2">
          <div class="field"><label class="f">Начало турнира *</label><input type="datetime-local" name="starts_at" required value="${toLocalInput(t.starts_at)}"></div>
          <div class="field"><label class="f">Регистрация до</label><input type="datetime-local" name="reg_closes_at" value="${toLocalInput(t.reg_closes_at)}"><div class="hint">Пусто — пока не закроете вручную.</div></div>
        </div>
        <div class="field"><label class="f">Чек-ин перед стартом</label><select name="checkin_minutes">${[['', 'Без чек-ина'], [15, 'За 15 минут'], [30, 'За 30 минут'], [60, 'За 1 час'], [120, 'За 2 часа']].map(([v, l]) => `<option value="${v}" ${String(v) === String(t.checkin_minutes ?? '') ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <div class="hint">Капитаны подтверждают участие на сайте. В сетку попадут только подтвердившие — неявки не испортят турнир.</div></div>
        <div class="field"><label class="f">Описание</label><textarea name="description" maxlength="4000" placeholder="Для кого турнир, расписание, трансляция…">${esc(t.description || '')}</textarea></div>
        <div class="field"><label class="f">Правила</label><textarea name="rules" maxlength="8000" placeholder="Античит, опоздания, споры…">${esc(t.rules || '')}</textarea></div>
      </div>
      <div class="form-sec"><h3>Формат</h3>
        <div class="field"><label class="f">Режим</label><div class="seg" id="modeSeg">${['5v5', '2v2', '1v1'].map(m => `<button type="button" data-mode="${m}" class="${t.mode === m ? 'on' : ''}">${m}</button>`).join('')}</div><input type="hidden" name="mode" value="${esc(t.mode)}"></div>
        <div class="field"><label class="f">Система</label><div class="fmts" id="fmtSeg">${[['single', 'Олимпийская', 'Проиграл — выбыл. Быстро и просто.'], ['double', 'Двойное выбывание', 'Второй шанс в нижней сетке, гранд-финал.'], ['groups', 'Группы + плей-офф', 'Круговой турнир в группах, лучшие — в плей-офф.']]
          .map(([k, l, d]) => `<button type="button" data-fmt="${k}" class="${fmt === k ? 'on' : ''}"><b>${l}</b><span>${d}</span></button>`).join('')}</div><input type="hidden" name="format" value="${fmt}"></div>
        <div class="grid2" id="grpBox">
          <div class="field"><label class="f">Количество групп</label><select name="group_count">${[1, 2, 3, 4, 6, 8].map(n => `<option ${n === t.group_count ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          <div class="field"><label class="f">Выходят из группы</label><select name="group_advance">${[1, 2, 3, 4].map(n => `<option ${n === t.group_advance ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        </div>
        <div class="grid3">
          <div class="field"><label class="f">Максимум участников</label><select name="max_teams">${[4, 8, 16, 32, 64, 128].map(n => `<option ${n === t.max_teams ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          <div class="field" id="subsBox"><label class="f">Запасных в команде</label><select name="max_subs">${[0, 1, 2, 3].map(n => `<option ${n === t.max_subs ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          <div class="field"><label class="f">Регион</label><input type="text" name="region" maxlength="40" value="${esc(t.region || '')}"></div>
        </div>
        <div class="grid3">
          <div class="field"><label class="f">Обычные матчи</label>${bo('bo_default', t.bo_default)}</div>
          <div class="field"><label class="f">Полуфинал</label>${bo('bo_semifinal', t.bo_semifinal)}</div>
          <div class="field"><label class="f">Финал</label>${bo('bo_final', t.bo_final)}</div>
        </div>
        <div class="field" id="pickBox"><label class="f">Выбор карты</label><div class="seg" id="pickSeg"><button type="button" data-pick="veto" class="${noPick ? '' : 'on'}">Пики и баны</button><button type="button" data-pick="none" class="${noPick ? 'on' : ''}">Без выбора карт</button></div>
          <input type="hidden" name="pick" value="${noPick ? 'none' : 'veto'}"></div>
        <div class="field" id="aimBox"><label class="f">Карта (необязательно)</label><input type="text" name="aim_map" maxlength="32" value="${esc(aimMap)}" placeholder="aim_map, aim_redline, aim_botz…" list="aimMaps">
          <datalist id="aimMaps">${AIM_MAPS.map(m => `<option value="${m}">`).join('')}</datalist>
          <div class="hint">Все матчи играются на этой карте, пиков и банов нет. Пусто — карту назначает организатор.</div></div>
        <div class="field" id="poolBox"><label class="f">Пул карт (5–10)</label><div class="pool">${pool.map(m => `<label><input type="checkbox" name="map" value="${esc(m)}" ${checked.includes(m) ? 'checked' : ''}>${esc(m)}</label>`).join('')}</div></div>
      </div>
      <div class="form-sec"><h3>Призы и ссылки</h3>
        <div class="grid2">
          <div class="field"><label class="f">Призовой фонд</label><input type="text" name="prize" maxlength="120" value="${esc(t.prize || '')}" placeholder="30 000 ₽ / скины / медали"></div>
          <div class="field"><label class="f">Взнос</label><input type="text" name="entry_fee" maxlength="60" value="${esc(t.entry_fee || '')}" placeholder="Бесплатно"></div>
          <div class="field"><label class="f">Связь (Discord / Telegram)</label><input type="url" name="contact_url" value="${esc(t.contact_url || '')}" placeholder="https://discord.gg/…"></div>
        </div>
        ${imgField('banner_url', 'Обложка (лучше 1600×600, обрежется до 8:3)', t.banner_url, 'banner')}
      </div>
      <div class="row" style="padding-top:18px"><button class="btn pri lg">${submitLabel}</button></div>
    </form>`;
    const f = $('form', box);
    const syncMode = () => {
      const m = f.mode.value, solo = m === '1v1', none = solo && f.pick.value === 'none';
      $('#subsBox', box).classList.toggle('hidden', solo);
      $('#pickBox', box).classList.toggle('hidden', !solo);
      $('#aimBox', box).classList.toggle('hidden', !none);
      $('#poolBox', box).classList.toggle('hidden', none);
    };
    $$('#pickSeg button', box).forEach(b => b.onclick = () => { f.pick.value = b.dataset.pick; $$('#pickSeg button', box).forEach(x => x.classList.toggle('on', x === b)); syncMode(); });
    $$('#modeSeg button', box).forEach(b => b.onclick = () => { f.mode.value = b.dataset.mode; $$('#modeSeg button', box).forEach(x => x.classList.toggle('on', x === b)); syncMode(); });
    syncMode();
    const syncFmt = () => $('#grpBox', box).classList.toggle('hidden', f.format.value !== 'groups');
    $$('#fmtSeg button', box).forEach(b => b.onclick = () => { f.format.value = b.dataset.fmt; $$('#fmtSeg button', box).forEach(x => x.classList.toggle('on', x === b)); syncFmt(); });
    syncFmt();
    bindImgFields(box);
    f.onsubmit = async e => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f));
      const noMaps = v.mode === '1v1' && v.pick === 'none';
      const maps = noMaps ? (v.aim_map.trim() ? [v.aim_map.trim()] : []) : $$('input[name=map]:checked', f).map(x => x.value);
      if (v.title.trim().length < 3) return toast('Название — минимум 3 символа', 'bad');
      if (!v.starts_at) return toast('Укажите дату начала', 'bad');
      if (!noMaps && (maps.length < 5 || maps.length > 10)) return toast('Выберите от 5 до 10 карт', 'bad');
      const btn = $('button.pri', f); btn.disabled = true;
      await onSubmit({
        title: v.title.trim(), description: v.description, rules: v.rules, mode: v.mode,
        starts_at: fromLocalInput(v.starts_at), reg_closes_at: fromLocalInput(v.reg_closes_at) || '',
        max_teams: Number(v.max_teams), max_subs: Number(v.max_subs ?? 0), region: v.region,
        bo_default: Number(v.bo_default), bo_semifinal: Number(v.bo_semifinal), bo_final: Number(v.bo_final),
        map_pool: maps, prize: v.prize, entry_fee: v.entry_fee, banner_url: v.banner_url, contact_url: v.contact_url,
        format: v.format, group_count: Number(v.group_count), group_advance: Number(v.group_advance), checkin_minutes: v.checkin_minutes ? Number(v.checkin_minutes) : '',
      });
      btn.disabled = false;
    };
  }

  // =================== создание турнира ===================
  function viewCreate(aim) {
    const me = api.me;
    if (!me) {
      app.innerHTML = `<div class="wrap section"><div class="empty" style="max-width:560px;margin:0 auto"><div class="head">Создать турнир</div><p style="margin-bottom:18px">Чтобы провести турнир, войдите через Steam. Это нужно, чтобы игроки знали, кто организатор.</p><button class="btn steam lg" id="lg">${I.steam}Войти через Steam</button></div></div>`;
      $('#lg').onclick = () => api.login(); return;
    }
    app.innerHTML = `<div class="wrap section"><div class="sec-head"><div><h2>${aim ? 'Новый аим-турнир' : 'Новый турнир'}</h2><div class="sub">${me.is_admin ? 'Вы администратор — турнир опубликуется сразу.' : 'После отправки турнир проверит модератор, обычно это быстро. Потом откроется регистрация.'}</div></div></div>
      <div class="card form-card" id="cf"></div></div>`;
    tournamentForm($('#cf'), aim ? { mode: '1v1', max_subs: 0, map_pool: ['aim_map'], bo_default: 1, bo_semifinal: 1, bo_final: 3, title: '' } : null, async p => {
      const id = await act(() => api.createTournament(p));
      if (id) { toast(me.is_admin ? 'Турнир опубликован' : 'Турнир отправлен на модерацию'); go('#/t/' + id); }
    }, me.is_admin ? 'Опубликовать турнир' : 'Отправить на модерацию');
  }

  // =================== профиль ===================
  async function viewMe() {
    const me = api.me;
    if (!me) { app.innerHTML = `<div class="wrap section"><div class="empty"><div class="head">Профиль</div><p style="margin-bottom:16px">Войдите через Steam, чтобы увидеть профиль.</p><button class="btn steam" id="lg">${I.steam}Войти через Steam</button></div></div>`; $('#lg').onclick = () => api.login(); return; }
    app.innerHTML = '<div class="loader">Загружаю профиль…</div>';
    const [prof, contacts] = await Promise.all([api.getProfile(me.steam_id), api.myContacts()]);
    const mine = await api.listTournaments('mine').catch(() => []);
    app.innerHTML = `<div class="wrap">
      <div class="profile-head">${avatar(me, 'lg')}<div><div class="kicker">Мой профиль</div><h1>${esc(me.nickname)}</h1><div class="sub">Ник и аватар берутся из Steam и обновляются при каждом входе · <a href="${esc(me.profile_url || '#')}" target="_blank" rel="noopener" style="color:var(--accent)">профиль Steam ${I.ext}</a></div></div></div>
      ${statTiles(prof && prof.stats)}
      <div class="two" style="margin-top:20px">
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="card"><div class="box-title">Последние матчи</div>${historyHtml(prof && prof.history)}</div>
          <div class="card"><div class="box-title">Мои турниры (организатор)</div>${mine.length ? `<div class="list">${mine.map(t => `<a class="li" href="#/t/${esc(t.id)}"><span class="grow"><b>${esc(t.title)}</b><span>${esc(fmtDate(t.starts_at))} · ${t.teams_count} / ${t.max_teams}</span></span>${stageBadge(t)}</a>`).join('')}</div>` : '<div class="hint" style="margin:0">Вы ещё не проводили турниров. <a href="#/create" style="color:var(--accent)">Создать первый</a></div>'}</div>
          <div class="card"><div class="box-title">Мои команды</div>${teamsList(prof ? prof.teams : [])}</div>
        </div>
        <div class="card"><div class="box-title">Данные для организаторов</div>
          <form id="pf">
            <div class="field"><label class="f">Discord</label><input type="text" name="discord" maxlength="64" value="${esc(contacts.discord || '')}" placeholder="nickname"></div>
            <div class="field"><label class="f">Telegram</label><input type="text" name="telegram" maxlength="64" value="${esc(contacts.telegram || '')}" placeholder="@nickname"></div>
            <div class="hint" style="margin:-8px 0 14px">Контакты видят только ваши сокомандники и организаторы турниров, где вы играете.</div>
            <div class="field"><label class="f">Профиль FACEIT</label><input type="url" name="faceit_url" value="${esc(me.faceit_url || '')}" placeholder="https://www.faceit.com/ru/players/…"></div>
            <div class="grid2"><div class="field"><label class="f">Уровень FACEIT</label><select name="faceit_level"><option value="">—</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<option ${n === me.faceit_level ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
            <div class="field"><label class="f">Рейтинг Premier</label><input type="number" name="premier_rating" min="0" max="50000" value="${me.premier_rating ?? ''}"></div></div>
            <div class="field"><label class="f">О себе</label><textarea name="bio" maxlength="300" style="min-height:70px">${esc(me.bio || '')}</textarea></div>
            <button class="btn pri block">Сохранить</button>
          </form></div>
      </div></div>`;
    $('#pf').onsubmit = async e => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target));
      if (await act(() => api.updateProfile(v), 'Профиль сохранён')) renderHeader('me');
    };
  }
  function teamsList(list) {
    if (!list.length) return '<div class="hint" style="margin:0">Вы пока не состоите ни в одной команде. <a href="#/" style="color:var(--accent)">Найти турнир</a></div>';
    return `<div class="list">${list.sort((a, b) => b.tournament.starts_at.localeCompare(a.tournament.starts_at)).map(x => `<a class="li" href="#/t/${esc(x.tournament.id)}/teams">${teamLogo(x.team, 'sm')}<span class="grow"><b>${esc(x.team.name)}</b><span>${esc(x.tournament.title)} · ${esc(fmtDate(x.tournament.starts_at))}</span></span><span class="role ${x.role === 'captain' ? 'cap' : ''}">${{ captain: 'Капитан', player: 'Игрок', sub: 'Запас' }[x.role]}</span></a>`).join('')}</div>`;
  }
  function statTiles(s) {
    s = s || { points: 0, matches: 0, wins: 0, finals: 0, titles: 0, tournaments: 0 };
    return `<div class="ptiles">
      <div><b>${s.points}</b><span>очков рейтинга</span></div>
      <div><b>${s.tournaments}</b><span>турниров</span></div>
      <div><b>${s.matches}</b><span>матчей</span></div>
      <div><b>${s.matches ? Math.round(s.wins / s.matches * 100) : 0}%</b><span>побед (${s.wins})</span></div>
      <div><b>${s.finals}</b><span>финалов</span></div>
      <div class="${s.titles ? 'gold' : ''}"><b>${s.titles}</b><span>титулов</span></div></div>`;
  }
  function historyHtml(list) {
    if (!list || !list.length) return '<div class="hint" style="margin:0">Сыгранных матчей пока нет.</div>';
    return `<div class="hist">${list.map(m => {
      const my = m.mine === m.team_a ? m.A : m.B, op = m.mine === m.team_a ? m.B : m.A;
      const win = m.winner_id === m.mine, ms = m.mine === m.team_a ? m.score_a : m.score_b, os = m.mine === m.team_a ? m.score_b : m.score_a;
      return `<a class="hrow" href="#/t/${esc(m.tournament_id)}/m/${esc(m.id)}"><span class="res ${win ? 'w' : 'l'}">${win ? 'W' : 'L'}</span>
        <span class="grow"><b>${esc(my ? my.name : '')} <span class="vs">vs</span> ${esc(op ? op.name : '?')}</b><span>${esc(m.tournament ? m.tournament.title : '')}${m.bracket === 'group' ? ' · группы' : m.bracket === 'grand' || !m.next_match_id ? ' · финал' : ''}</span></span>
        <span class="sc">${ms}:${os}</span></a>`;
    }).join('')}</div>`;
  }
  async function viewProfile(steamId) {
    if (api.me && api.me.steam_id === steamId) return viewMe();
    app.innerHTML = '<div class="loader">Загружаю профиль…</div>';
    const prof = await api.getProfile(steamId).catch(() => null);
    if (!prof) { app.innerHTML = `<div class="wrap section"><div class="empty"><div class="head">Игрок не найден</div></div></div>`; return; }
    const p = prof.profile;
    setTitle(p.nickname);
    app.innerHTML = `<div class="wrap">
      <div class="profile-head">${avatar(p, 'lg')}<div><div class="row" style="gap:8px">${p.is_admin ? '<span class="badge soon">Администратор</span>' : ''}${p.country ? `<span class="badge">${esc(p.country)}</span>` : ''}</div><h1>${esc(p.nickname)}</h1>
        <div class="row" style="margin-top:8px"><a class="btn sm" href="${esc(p.profile_url || 'https://steamcommunity.com/profiles/' + p.steam_id)}" target="_blank" rel="noopener">${I.steam}Steam</a>${p.faceit_url ? `<a class="btn sm" href="${esc(p.faceit_url)}" target="_blank" rel="noopener">FACEIT ${I.ext}</a>` : ''}
        ${p.faceit_level ? `<span class="row" style="gap:6px;font-size:14px"><span class="lvl l${p.faceit_level}">${p.faceit_level}</span>FACEIT</span>` : ''}${p.premier_rating ? `<span class="badge">Premier ${p.premier_rating}</span>` : ''}</div></div></div>
      ${p.bio ? `<p class="pre" style="max-width:640px;color:var(--muted)">${esc(p.bio)}</p>` : ''}
      ${statTiles(prof.stats)}
      <div class="two" style="margin-top:22px;padding-bottom:20px">
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="card"><div class="box-title">Последние матчи</div>${historyHtml(prof.history)}</div>
          <div class="card"><div class="box-title">Команды и турниры</div>${prof.teams.length ? teamsList(prof.teams) : '<div class="hint" style="margin:0">Пока не участвовал в турнирах.</div>'}</div>
        </div>
        <div class="card"><div class="box-title">Проводит турниры</div>${prof.organized.length ? `<div class="list">${prof.organized.map(t => `<a class="li" href="#/t/${esc(t.id)}"><span class="grow"><b>${esc(t.title)}</b><span>${esc(fmtDate(t.starts_at))}</span></span>${stageBadge(t)}</a>`).join('')}</div>` : '<div class="hint" style="margin:0">Нет турниров.</div>'}</div>
      </div></div>`;
  }

  // =================== модерация ===================
  async function viewAdmin(sub = 'queue') {
    const me = api.me;
    if (!me || !me.is_admin) { app.innerHTML = `<div class="wrap section"><div class="empty"><div class="head">Только для администраторов</div></div></div>`; return; }
    app.innerHTML = `<div class="wrap section"><div class="sec-head"><div><h2>Модерация</h2><div class="sub">Проверка турниров и управление игроками</div></div>
      <div class="seg" id="aseg"><button data-a="queue">Очередь</button><button data-a="all">Все турниры</button><button data-a="users">Игроки</button></div></div><div id="abody"><div class="loader"></div></div></div>`;
    $$('#aseg button').forEach(b => { b.classList.toggle('on', b.dataset.a === sub); b.onclick = () => go('#/admin/' + b.dataset.a); });
    const box = $('#abody');
    if (sub === 'users') return adminUsers(box);
    const list = await api.listTournaments(sub === 'queue' ? 'pending' : 'all');
    if (!list.length) { box.innerHTML = `<div class="empty"><div class="head">${sub === 'queue' ? 'Очередь пуста' : 'Турниров нет'}</div>${sub === 'queue' ? 'Все турниры проверены.' : ''}</div>`; return; }
    box.innerHTML = `<div class="list">${list.map(t => `<div class="li" style="align-items:flex-start;flex-wrap:wrap">
      <div class="grow" style="min-width:260px"><a href="#/t/${esc(t.id)}"><b style="font-size:16px">${esc(t.title)}</b></a>
        <span>${esc(t.mode)} · ${esc(fmtDate(t.starts_at))} · до ${t.max_teams} · приз: ${esc(t.prize || '—')} · организатор: <a href="#/u/${esc(t.organizer_steam_id)}" style="color:var(--text)">${esc(t.organizer_nickname)}</a></span>
        ${t.description ? `<div class="hint pre" style="max-height:66px;overflow:hidden">${esc(t.description)}</div>` : ''}
        ${t.moderation_note ? `<div class="hint">Комментарий: ${esc(t.moderation_note)}</div>` : ''}</div>
      <div class="row" style="gap:8px">${stageBadge(t)}
        ${t.status !== 'published' ? `<button class="btn sm ok" data-ok="${esc(t.id)}">Одобрить</button>` : ''}
        ${t.status !== 'rejected' ? `<button class="btn sm danger" data-no="${esc(t.id)}">Отклонить</button>` : ''}</div></div>`).join('')}</div>`;
    $$('[data-ok]', box).forEach(b => b.onclick = async () => { if (await act(() => api.moderate(b.dataset.ok, 'published'), 'Турнир опубликован')) { viewAdmin(sub); renderHeader('admin'); } });
    $$('[data-no]', box).forEach(b => b.onclick = () => form('Отклонить турнир', `<div class="field"><label class="f">Причина (увидит организатор)</label><textarea name="note" maxlength="300" placeholder="Например: укажите призовой фонд и правила"></textarea></div>`, 'Отклонить',
      async v => { if (!await act(() => api.moderate(b.dataset.no, 'rejected', v.note), 'Турнир отклонён')) return false; viewAdmin(sub); renderHeader('admin'); }));
  }
  async function adminUsers(box) {
    box.innerHTML = `<div class="card" style="margin-bottom:16px"><div class="row"><input type="search" id="uq" placeholder="Ник или SteamID64" style="flex:1;min-width:200px"><button class="btn" id="uqb">Найти</button></div>
      <div class="hint">Назначить администратора можно игроку, который хотя бы раз входил на сайт.</div></div><div id="ulist"></div>`;
    const load = async () => {
      const list = await api.searchProfiles($('#uq').value.trim()).catch(e => { toast(e.message, 'bad'); return []; });
      $('#ulist').innerHTML = list.length ? `<div class="list">${list.map(p => `<div class="li">${avatar(p)}<span class="grow"><a href="#/u/${esc(p.steam_id)}"><b>${esc(p.nickname)}</b></a><span>${esc(p.steam_id)}${p.is_admin ? ' · администратор' : ''}${p.is_banned ? ' · <span style="color:var(--bad)">заблокирован</span>' : ''}</span></span>
        ${p.id !== api.me.id ? `<button class="btn sm" data-adm="${esc(p.steam_id)}|${p.is_admin ? 0 : 1}">${p.is_admin ? 'Снять админа' : 'Сделать админом'}</button><button class="btn sm ${p.is_banned ? '' : 'danger'}" data-ban="${esc(p.id)}|${p.is_banned ? 0 : 1}">${p.is_banned ? 'Разблокировать' : 'Заблокировать'}</button>` : '<span class="hint" style="margin:0">это вы</span>'}</div>`).join('')}</div>` : '<div class="empty">Никого не нашли</div>';
      $$('[data-adm]').forEach(b => b.onclick = async () => { const [s, v] = b.dataset.adm.split('|'); if (await act(() => api.setAdmin(s, v === '1'), 'Готово')) load(); });
      $$('[data-ban]').forEach(b => b.onclick = async () => { const [u, v] = b.dataset.ban.split('|'); if (v === '1' && !await ask('Заблокировать игрока? Он не сможет создавать турниры и вступать в команды.', { ok: 'Заблокировать', danger: true })) return; if (await act(() => api.setBanned(u, v === '1'), 'Готово')) load(); });
    };
    $('#uqb').onclick = load; $('#uq').onkeydown = e => { if (e.key === 'Enter') load(); };
    load();
  }

  // =================== роутер ===================
  async function render() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const [a, b, c, d] = parts;
    const key = a === 't' ? 't/' + b : parts.join('/');
    if (unsub && key !== lastRoute) { unsub(); unsub = null; }
    if (!(a === 't' && c === 'm') && $('#modal')) closeModal(true);
    const switching = key !== lastRoute;
    lastRoute = key;
    if (a !== 't') tCache = null;
    renderHeader(a === 't' || !a ? 'home' : a);
    if (switching) window.scrollTo(0, 0);
    try {
      if (!a) return await viewHome();
      if (a === 't' && b) {
        if (tCache && tCache.t.id === b && !switching) return drawTournament(c === 'm' ? (tCache._tab || 'bracket') : (c || 'overview'), c === 'm' ? d : null, true);
        return await viewTournament(b, c === 'm' ? 'bracket' : (c || 'overview'), c === 'm' ? d : null);
      }
      if (a === 'create') { setTitle(b === 'aim' ? 'Новый аим-турнир' : 'Новый турнир'); return viewCreate(b === 'aim'); }
      if (a === 'aim') return await viewAim();
      if (a === 'rating') return await viewRating();
      if (a === 'me') { setTitle('Мой профиль'); return await viewMe(); }
      if (a === 'admin') setTitle('Модерация');
      if (a === 'u' && b) return await viewProfile(b);
      if (a === 'admin') return await viewAdmin(b || 'queue');
      app.innerHTML = `<div class="wrap section"><div class="empty"><div class="head">Страница не найдена</div><a class="btn" href="#/" style="margin-top:14px">На главную</a></div></div>`;
    } catch (e) {
      console.error(e);
      app.innerHTML = `<div class="wrap section"><div class="notice bad">Ошибка: ${esc(e.message)}</div></div>`;
    }
  }

  // =================== запуск ===================
  (async () => {
    if (api.demo) {
      const bar = $('#demoBar');
      bar.classList.remove('hidden');
      bar.innerHTML = `<b>Демо-режим.</b> Сайт ещё не подключён к базе — данные примерные и хранятся только в вашем браузере. Вход через Steam здесь имитируется. <a href="#" id="demoReset" style="text-decoration:underline">Сбросить демо</a>`;
      $('#demoReset').onclick = e => { e.preventDefault(); api.reset(); };
    }
    const r = await api.init().catch(e => ({ error: e.message }));
    if (r && r.error) toast(r.error, 'bad');
    if (r && r.ok) toast(r.ok);
    window.addEventListener('hashchange', render);
    await render();
    // регистрация закрывается по времени, «через N дней» устаревает — изредка перерисовываем каталог
    setInterval(() => { if (!location.hash || location.hash === '#/') { if (!document.activeElement || !document.activeElement.matches('input')) render(); } }, 120000);
  })();
})();
