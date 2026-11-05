// Слой данных Organizm: Supabase (боевой режим) или демо-данные в браузере.
(function () {
  'use strict';

  // ---------- общие правила (те же, что в базе) ----------
  function vetoSequence(bo, pool) {
    if (bo === 1) return Array(pool - 1).fill('ban');
    if (bo === 3) { const bans = pool - 3; return [...Array(Math.min(2, bans)).fill('ban'), 'pick', 'pick', ...Array(Math.max(bans - 2, 0)).fill('ban')]; }
    return [...Array(Math.max(pool - 5, 0)).fill('ban'), 'pick', 'pick', 'pick', 'pick'];
  }
  function seedOrder(size) {
    let o = [1, 2];
    while (o.length < size) { const len = o.length * 2 + 1; o = o.flatMap(s => [s, len - s]); }
    return o;
  }
  // таблица группы: победы, разница счёта, посев
  function groupStandings(matches, teams) {
    const seed = Object.fromEntries(teams.map(t => [t.id, t.seed || 999]));
    const rows = {};
    for (const m of matches.filter(x => x.bracket === 'group')) {
      for (const id of [m.team_a, m.team_b]) if (id && !rows[id]) rows[id] = { group_no: m.group_no, team_id: id, played: 0, wins: 0, losses: 0, diff: 0 };
      if (m.status !== 'finished' || !m.winner_id) continue;
      for (const [id, my, op] of [[m.team_a, m.score_a, m.score_b], [m.team_b, m.score_b, m.score_a]]) {
        const r = rows[id]; r.played++;
        if (m.winner_id === id) r.wins++; else r.losses++;
        r.diff += (my ?? 0) - (op ?? 0);
      }
    }
    const out = Object.values(rows);
    const groups = [...new Set(out.map(r => r.group_no))];
    for (const g of groups) {
      out.filter(r => r.group_no === g).sort((a, b) => b.wins - a.wins || b.diff - a.diff || seed[a.team_id] - seed[b.team_id]).forEach((r, i) => r.place = i + 1);
    }
    return out.sort((a, b) => a.group_no - b.group_no || a.place - b.place);
  }
  const MAP_POOL = ['Mirage', 'Inferno', 'Nuke', 'Ancient', 'Anubis', 'Dust2', 'Train', 'Overpass', 'Vertigo'];
  const cleanErr = m => String(m || 'Ошибка').replace(/^(ERROR:\s*)/, '').replace(/\s*\(SQLSTATE.*$/, '');

  // уменьшить картинку перед загрузкой (логотип — квадрат до 512, обложка — до 1600×600)
  async function shrinkImage(file, kind) {
    if (!/^image\//.test(file.type)) throw new Error('Нужна картинка: PNG, JPG, WEBP или GIF');
    if (file.size > 15 * 1024 * 1024) throw new Error('Файл больше 15 МБ');
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Не удалось открыть картинку')); i.src = url; });
      const maxW = kind === 'banner' ? 1600 : 512, maxH = kind === 'banner' ? 600 : 512;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (kind === 'banner') {
        // обложка: обрезаем по центру до 8:3
        const ratio = 8 / 3; let sx = 0, sy = 0, sw = w, sh = h;
        if (w / h > ratio) { sw = h * ratio; sx = (w - sw) / 2; } else { sh = w / ratio; sy = (h - sh) / 2; }
        const cw = Math.max(8, Math.min(maxW, Math.round(sw))), ch = Math.max(3, Math.round(cw / ratio));
        const c = Object.assign(document.createElement('canvas'), { width: cw, height: ch });
        c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
        return await new Promise(r => c.toBlob(r, 'image/webp', 0.88));
      }
      const k = Math.min(1, maxW / w, maxH / h);
      const c = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) });
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return await new Promise(r => c.toBlob(r, 'image/webp', 0.9));
    } finally { URL.revokeObjectURL(url); }
  }
  async function shrink(file, kind) { const b = await shrinkImage(file, kind); if (!b) throw new Error('Не удалось обработать картинку'); return b; }

  // =====================================================================
  //  SUPABASE
  // =====================================================================
  function supaApi(cfg) {
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'organizm-auth' },
    });
    const TEAM_COLS = 'id,tournament_id,name,tag,logo_url,captain_id,is_open,seed,created_at,checked_in_at';
    const PUB_PROFILE = 'id,steam_id,nickname,avatar_url,profile_url,country,faceit_url,faceit_level,premier_rating,bio,is_admin,created_at';
    const MINI_PROFILE = 'id,steam_id,nickname,avatar_url,faceit_level,premier_rating,country';
    const unwrap = ({ data, error }) => { if (error) throw new Error(cleanErr(error.message)); return data; };
    const rpc = async (fn, args) => unwrap(await sb.rpc(fn, args));
    let me = null;

    async function loadMe() {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return (me = null);
      const { data } = await sb.from('profiles').select(PUB_PROFILE + ',is_banned').eq('id', session.user.id).maybeSingle();
      return (me = data || null);
    }

    async function handleSteamReturn() {
      const q = new URLSearchParams(location.search);
      if (!q.get('openid.mode')) return null;
      const params = {};
      for (const [k, v] of q) if (k.startsWith('openid.')) params[k] = v;
      const back = sessionStorage.getItem('organizm_back') || '#/';
      sessionStorage.removeItem('organizm_back');
      history.replaceState(null, '', location.pathname + back);
      if (params['openid.mode'] !== 'id_res') return { error: 'Вход через Steam отменён' };
      const { data, error } = await sb.functions.invoke('steam-auth', { body: { params } });
      if (error) {
        let msg = error.message;
        try { const b = await error.context.json(); if (b && b.error) msg = b.error; } catch (_) {}
        return { error: 'Не удалось войти: ' + msg };
      }
      if (data && data.error) return { error: 'Не удалось войти: ' + data.error };
      await sb.auth.setSession(data.session);
      return { ok: 'Вы вошли как ' + (data.profile && data.profile.nickname) };
    }

    function shapeTeams(teams, members) {
      return teams.map(t => ({
        ...t,
        members: members.filter(m => m.team_id === t.id)
          .map(m => ({ ...m.profile, user_id: m.user_id, role: m.role, joined_at: m.joined_at }))
          .sort((a, b) => (a.role === 'captain' ? -1 : b.role === 'captain' ? 1 : 0) || (a.role === 'sub') - (b.role === 'sub') || a.joined_at.localeCompare(b.joined_at)),
      }));
    }
    async function teamsByIds(ids) {
      ids = [...new Set(ids.filter(Boolean))];
      if (!ids.length) return {};
      const rows = unwrap(await sb.from('teams').select(TEAM_COLS).in('id', ids));
      return Object.fromEntries(rows.map(t => [t.id, t]));
    }

    const api = {
      demo: false,
      get me() { return me; },
      async init() {
        const r = await handleSteamReturn();
        await loadMe();
        sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') me = null; });
        return r;
      },
      login() {
        sessionStorage.setItem('organizm_back', location.hash || '#/');
        const returnTo = location.origin + location.pathname + '?steam_return=1';
        const p = new URLSearchParams({
          'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'checkid_setup',
          'openid.return_to': returnTo, 'openid.realm': location.origin + '/',
          'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
          'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
        });
        location.href = 'https://steamcommunity.com/openid/login?' + p;
      },
      async logout() { await sb.auth.signOut(); me = null; },
      refreshMe: loadMe,

      async listTournaments(scope = 'public') {
        let q = sb.from('tournament_cards').select('*').order('starts_at', { ascending: true }).limit(300);
        if (scope === 'public') q = q.eq('status', 'published');
        else if (scope === 'pending') q = q.eq('status', 'pending');
        else if (scope === 'mine') q = q.eq('organizer_id', me && me.id);
        return unwrap(await q);
      },
      async getTournament(id) {
        const [t, teams, members, matches, ann, agents, invites] = await Promise.all([
          sb.from('tournament_cards').select('*').eq('id', id).maybeSingle(),
          sb.from('teams').select(TEAM_COLS).eq('tournament_id', id).order('created_at'),
          sb.from('team_members').select(`team_id,user_id,role,joined_at,profile:profiles(${MINI_PROFILE})`).eq('tournament_id', id),
          sb.from('matches').select('*').eq('tournament_id', id).order('round').order('position'),
          sb.from('announcements').select('*').eq('tournament_id', id).order('created_at', { ascending: false }),
          sb.from('free_agents').select(`user_id,note,created_at,profile:profiles(${MINI_PROFILE})`).eq('tournament_id', id).order('created_at'),
          sb.from('team_invites').select('team_id,user_id,created_at').eq('tournament_id', id),
        ]);
        const tour = unwrap(t);
        if (!tour) return null;
        const tms = unwrap(teams);
        return {
          t: tour, teams: shapeTeams(tms, unwrap(members)), matches: unwrap(matches), announcements: unwrap(ann),
          agents: unwrap(agents).map(a => ({ ...a.profile, user_id: a.user_id, note: a.note, created_at: a.created_at })),
          invites: unwrap(invites),
        };
      },
      async contactsFor(userIds) {
        if (!userIds.length) return {};
        const rows = unwrap(await sb.from('profile_contacts').select('*').in('user_id', userIds));
        return Object.fromEntries(rows.map(r => [r.user_id, r]));
      },
      createTournament: p => rpc('create_tournament', { p }),
      updateTournament: (id, p) => rpc('update_tournament', { t: id, p }),
      setStage: (id, stage) => rpc('set_stage', { t: id, new_stage: stage }),
      moderate: (id, status, note) => rpc('moderate_tournament', { t: id, new_status: status, note: note || null }),
      deleteTournament: id => rpc('delete_tournament', { t: id }),

      createTeam: (tid, x) => rpc('create_team', { t: tid, team_name: x.name, team_tag: x.tag || null, logo: x.logo || null, open: x.open }),
      joinTeam: (team, code) => rpc('join_team', { team, code: code || null }),
      joinByCode: (tid, code) => rpc('join_by_code', { t: tid, code }),
      teamCode: team => rpc('get_team_code', { team }),
      updateTeam: (team, p) => rpc('update_team', { team, p }),
      leaveTeam: team => rpc('leave_team', { team }),
      kick: (team, member) => rpc('kick_member', { team, member }),
      makeCaptain: (team, member) => rpc('transfer_captain', { team, member }),
      disbandTeam: team => rpc('disband_team', { team }),
      checkin: team => rpc('checkin', { team }),
      setCheckin: (team, value) => rpc('set_checkin', { team, value }),
      setFreeAgent: (tid, note) => rpc('set_free_agent', { t: tid, note: note || null }),
      removeFreeAgent: tid => rpc('remove_free_agent', { t: tid }),
      invitePlayer: (team, member) => rpc('invite_player', { team, member }),
      cancelInvite: (team, member) => rpc('cancel_invite', { team, member }),
      respondInvite: (team, accept) => rpc('respond_invite', { team, accept }),

      generateBracket: (tid, seeds, shuffle) => rpc('generate_bracket', { t: tid, seeds: seeds || null, shuffle: !!shuffle }),
      generatePlayoff: tid => rpc('generate_playoff', { t: tid }),
      updateMatch: (mid, p) => rpc('update_match', { mid, p }),
      reportResult: (mid, a, b) => rpc('report_result', { mid, sa: a, sb: b }),
      resetResult: mid => rpc('reset_result', { mid }),
      vetoAction: (mid, map) => rpc('veto_action', { mid, map_name: map }),
      resetVeto: mid => rpc('reset_veto', { mid }),
      addAnnouncement: (tid, body) => rpc('add_announcement', { t: tid, text_body: body }),
      deleteAnnouncement: id => rpc('delete_announcement', { aid: id }),

      async uploadImage(file, kind) {
        if (!me) throw new Error('Войдите через Steam');
        const blob = await shrink(file, kind);
        if (blob.size > 2 * 1024 * 1024) throw new Error('Картинка слишком большая даже после сжатия');
        const path = `${me.id}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.webp`;
        const { error } = await sb.storage.from('media').upload(path, blob, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
        if (error) throw new Error('Не удалось загрузить: ' + error.message);
        return sb.storage.from('media').getPublicUrl(path).data.publicUrl;
      },

      async getProfile(steamId) {
        const p = unwrap(await sb.from('profiles').select(PUB_PROFILE).eq('steam_id', steamId).maybeSingle());
        if (!p) return null;
        const [teams, organized, stats] = await Promise.all([
          sb.from('team_members').select('role,team_id,team:teams(id,name,tag,logo_url),tournament:tournaments(id,title,starts_at,stage,status,mode,format)').eq('user_id', p.id),
          sb.from('tournament_cards').select('*').eq('organizer_id', p.id).order('starts_at', { ascending: false }),
          sb.from('player_stats').select('*').eq('user_id', p.id).maybeSingle(),
        ]);
        const tlist = unwrap(teams).filter(x => x.tournament);
        const ids = tlist.map(x => x.team_id);
        let history = [];
        if (ids.length) {
          const list = ids.join(',');
          const ms = unwrap(await sb.from('matches').select('*').or(`team_a.in.(${list}),team_b.in.(${list})`).eq('status', 'finished').eq('is_bye', false).order('updated_at', { ascending: false }).limit(30));
          const tm = await teamsByIds(ms.flatMap(m => [m.team_a, m.team_b]));
          const tt = Object.fromEntries(tlist.map(x => [x.tournament.id, x.tournament]));
          history = ms.map(m => ({ ...m, A: tm[m.team_a], B: tm[m.team_b], mine: ids.includes(m.team_a) ? m.team_a : m.team_b, tournament: tt[m.tournament_id] }));
        }
        return { profile: p, teams: tlist, organized: unwrap(organized), stats: unwrap(stats), history };
      },
      async myContacts() { return me ? (unwrap(await sb.from('profile_contacts').select('*').eq('user_id', me.id).maybeSingle()) || {}) : {}; },
      async updateProfile(p) { await rpc('update_profile', { p }); await loadMe(); },
      async leaderboard() {
        return unwrap(await sb.from('player_stats').select('*').gt('matches', 0).order('points', { ascending: false }).order('wins', { ascending: false }).limit(200));
      },
      // ближайшие матчи, чек-ин и приглашения текущего игрока
      async myDashboard() {
        if (!me) return null;
        const [mem, inv] = await Promise.all([
          sb.from('team_members').select('team_id,role,tournament:tournaments(id,title,stage,starts_at,checkin_minutes,mode,format,status)').eq('user_id', me.id),
          sb.from('team_invites').select('team_id,created_at,team:teams(id,name,tag,logo_url),tournament:tournaments(id,title,starts_at,mode)').eq('user_id', me.id),
        ]);
        const active = unwrap(mem).filter(x => x.tournament && x.tournament.status === 'published' && ['registration', 'closed', 'ongoing'].includes(x.tournament.stage));
        const ids = active.map(x => x.team_id);
        let matches = [], myTeams = {};
        if (ids.length) {
          const list = ids.join(',');
          const ms = unwrap(await sb.from('matches').select('*').or(`team_a.in.(${list}),team_b.in.(${list})`).neq('status', 'finished').order('scheduled_at', { ascending: true, nullsFirst: false }));
          const tm = await teamsByIds([...ids, ...ms.flatMap(m => [m.team_a, m.team_b])]);
          myTeams = tm;
          const tt = Object.fromEntries(active.map(x => [x.tournament.id, x.tournament]));
          matches = ms.filter(m => m.team_a && m.team_b).map(m => ({ ...m, A: tm[m.team_a], B: tm[m.team_b], mine: ids.includes(m.team_a) ? m.team_a : m.team_b, tournament: tt[m.tournament_id] }));
        }
        const checkins = active.filter(x => x.tournament.checkin_minutes && ['registration', 'closed'].includes(x.tournament.stage) && myTeams[x.team_id])
          .map(x => ({ team: myTeams[x.team_id], tournament: x.tournament, captain: myTeams[x.team_id].captain_id === me.id }));
        return { matches, checkins, invites: unwrap(inv).filter(i => i.team && i.tournament) };
      },

      async searchProfiles(q) {
        let qb = sb.from('profiles').select(PUB_PROFILE + ',is_banned').order('last_login_at', { ascending: false, nullsFirst: false }).limit(30);
        if (q) qb = /^\d{17}$/.test(q) ? qb.eq('steam_id', q) : qb.ilike('nickname', `%${q.replace(/[%_]/g, '')}%`);
        return unwrap(await qb);
      },
      setAdmin: (steamId, v) => rpc('set_admin', { target_steam_id: steamId, value: v }),
      setBanned: (userId, v) => rpc('set_banned', { target: userId, value: v }),
      async stats() {
        const [t, teams, players] = await Promise.all([
          sb.from('tournaments').select('id', { count: 'exact', head: true }).eq('status', 'published'),
          sb.from('teams').select('id', { count: 'exact', head: true }),
          sb.from('profiles').select('id', { count: 'exact', head: true }),
        ]);
        return { tournaments: t.count || 0, teams: teams.count || 0, players: players.count || 0 };
      },
      subscribe(tid, cb) {
        const ch = sb.channel('t-' + tid);
        for (const tbl of ['matches', 'teams', 'team_members', 'announcements', 'free_agents', 'team_invites']) {
          ch.on('postgres_changes', { event: '*', schema: 'public', table: tbl, filter: `tournament_id=eq.${tid}` }, cb);
        }
        ch.on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${tid}` }, cb);
        ch.subscribe();
        return () => sb.removeChannel(ch);
      },
    };
    return api;
  }

  // =====================================================================
  //  ДЕМО: те же функции, данные хранятся в браузере
  // =====================================================================
  function demoApi() {
    const KEY = 'organizm_demo_v3';
    let db;
    try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { db = null; }
    const listeners = new Set();
    const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    const code = () => Math.random().toString(36).slice(2, 10).toUpperCase();
    const delay = v => new Promise(r => setTimeout(() => r(v), 100));
    const fail = m => { throw new Error(m); };
    const now = () => new Date().toISOString();
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (_) {} listeners.forEach(f => f()); };
    const me = () => db.session ? db.profiles.find(p => p.id === db.session) : null;
    const needMe = () => { const m = me() || fail('Войдите через Steam'); if (m.is_banned) fail('Аккаунт заблокирован администрацией'); return m; };
    const T = id => db.tournaments.find(t => t.id === id) || fail('Турнир не найден');
    const team = id => db.teams.find(x => x.id === id) || fail('Команда не найдена');
    const canManage = t => { const m = me(); return !!m && (m.is_admin || t.organizer_id === m.id); };
    const needManage = t => { needMe(); canManage(t) || fail('Недостаточно прав: это может только организатор турнира'); };
    const visible = t => t.status === 'published' || canManage(t);
    const card = t => {
      const o = db.profiles.find(p => p.id === t.organizer_id) || {};
      return { ...t, organizer_nickname: o.nickname, organizer_avatar: o.avatar_url, organizer_steam_id: o.steam_id, teams_count: db.teams.filter(x => x.tournament_id === t.id).length };
    };
    const needReg = t => {
      t.status === 'published' || fail('Турнир ещё не прошёл модерацию');
      (t.stage === 'registration' && (!t.reg_closes_at || new Date(t.reg_closes_at) > new Date())) || fail('Регистрация на турнир закрыта');
    };
    const M = id => db.matches.find(m => m.id === id);

    // ---------- движок сеток (повторяет логику базы) ----------
    function put(mid, slot, teamId) { const m = M(mid); if (slot === 'a') m.team_a = teamId; else m.team_b = teamId; }
    function slotDead(m, slot) {
      if ((slot === 'a' ? m.team_a : m.team_b)) return false;
      let f = db.matches.find(x => x.next_match_id === m.id && x.next_slot === slot);
      if (f) return f.is_bye && !f.winner_id;
      f = db.matches.find(x => x.loser_match_id === m.id && x.loser_slot === slot);
      if (f) return f.is_bye;
      return true;
    }
    function advance(m) {
      if (!m.winner_id) return;
      if (m.next_match_id) put(m.next_match_id, m.next_slot, m.winner_id);
      if (!m.is_bye && m.loser_match_id) put(m.loser_match_id, m.loser_slot, m.winner_id === m.team_a ? m.team_b : m.team_a);
      if (!m.next_match_id && m.bracket !== 'group') T(m.tournament_id).stage = 'finished';
    }
    const ORDER = { upper: 1, lower: 2, grand: 3 };
    function resolve(tid) {
      let changed = true;
      while (changed) {
        changed = false;
        const list = db.matches.filter(m => m.tournament_id === tid && m.bracket !== 'group' && m.status !== 'finished' && !m.winner_id)
          .sort((a, b) => ORDER[a.bracket] - ORDER[b.bracket] || a.round - b.round || a.position - b.position);
        for (const m of list) {
          if (m.status === 'finished') continue;
          const da = slotDead(m, 'a'), dbb = slotDead(m, 'b');
          if ((m.team_a && dbb) || (m.team_b && da)) { Object.assign(m, { winner_id: m.team_a || m.team_b, status: 'finished', is_bye: true }); advance(m); changed = true; }
          else if (da && dbb) { Object.assign(m, { status: 'finished', is_bye: true }); changed = true; }
        }
      }
    }
    function removeFrom(mid, slot) {
      const nx = M(mid); if (!nx) return;
      if (nx.winner_id) unwind(nx);
      if (slot === 'a') nx.team_a = null; else nx.team_b = null;
      Object.assign(nx, { score_a: null, score_b: null, winner_id: null, status: 'pending', is_bye: false, veto: { log: [] } });
    }
    function unwind(m) {
      if (!m.winner_id) return;
      if (m.next_match_id) removeFrom(m.next_match_id, m.next_slot);
      if (!m.is_bye && m.loser_match_id) removeFrom(m.loser_match_id, m.loser_slot);
      if (!m.next_match_id && m.bracket !== 'group') { const t = T(m.tournament_id); if (t.stage === 'finished') t.stage = 'ongoing'; }
    }
    const blank = (t, bracket, round, position, best_of, a = null, b = null, group_no = null) => ({
      id: uid(), tournament_id: t.id, bracket, group_no, round, position, team_a: a, team_b: b, score_a: null, score_b: null, winner_id: null,
      best_of, scheduled_at: null, status: 'pending', is_bye: false, veto: { log: [] }, next_match_id: null, next_slot: null, loser_match_id: null, loser_slot: null,
    });
    function buildElim(t, ids, dbl) {
      const n = ids.length; let size = 2, k = 1;
      while (size < n) { size *= 2; k++; }
      if (size < 4) dbl = false;
      const ord = seedOrder(size), L = [];
      const find = (br, r, p) => L.find(x => x.bracket === br && x.round === r && x.position === p);
      for (let r = 1; r <= k; r++) {
        const bo = r === k ? (dbl ? t.bo_semifinal : t.bo_final) : (r === k - 1 && !dbl ? t.bo_semifinal : t.bo_default);
        for (let p = 1; p <= size >> r; p++) {
          const a = r === 1 ? ord[p * 2 - 2] : 0, b = r === 1 ? ord[p * 2 - 1] : 0;
          L.push(blank(t, 'upper', r, p, bo, r === 1 && a <= n ? ids[a - 1] : null, r === 1 && b <= n ? ids[b - 1] : null));
        }
      }
      for (const m of L) { const nx = find('upper', m.round + 1, Math.ceil(m.position / 2)); if (nx) { m.next_match_id = nx.id; m.next_slot = m.position % 2 ? 'a' : 'b'; } }
      if (dbl) {
        const lr = 2 * (k - 1);
        for (let r = 1; r <= lr; r++) { const j = (r + 1) >> 1; for (let p = 1; p <= size >> (j + 1); p++) L.push(blank(t, 'lower', r, p, r === lr ? t.bo_semifinal : t.bo_default)); }
        const gf = blank(t, 'grand', 1, 1, t.bo_final); L.push(gf);
        for (const m of L.filter(x => x.bracket === 'upper')) {
          if (m.round === 1) { const l = find('lower', 1, Math.ceil(m.position / 2)); m.loser_match_id = l.id; m.loser_slot = m.position % 2 ? 'a' : 'b'; }
          else { const j = m.round - 1, lcnt = size >> (j + 1); const l = find('lower', 2 * j, j % 2 ? lcnt + 1 - m.position : m.position); m.loser_match_id = l.id; m.loser_slot = 'b'; }
          if (m.round === k) { m.next_match_id = gf.id; m.next_slot = 'a'; }
        }
        for (const m of L.filter(x => x.bracket === 'lower')) {
          if (m.round === lr) { m.next_match_id = gf.id; m.next_slot = 'b'; continue; }
          const nx = m.round % 2 ? find('lower', m.round + 1, m.position) : find('lower', m.round + 1, Math.ceil(m.position / 2));
          m.next_match_id = nx.id; m.next_slot = m.round % 2 ? 'a' : (m.position % 2 ? 'a' : 'b');
        }
      }
      db.matches.push(...L);
    }
    function buildGroups(t, ids) {
      const n = ids.length, g = Math.max(1, Math.min(t.group_count, Math.floor(n / 2)));
      for (let gi = 1; gi <= g; gi++) {
        let arr = ids.filter((_, i) => (Math.floor(i / g) % 2 === 0 ? (i % g) + 1 : g - (i % g)) === gi);
        if (arr.length % 2) arr.push(null);
        const m = arr.length;
        for (let r = 1; r < m; r++) {
          let pos = 0;
          for (let i = 0; i < m / 2; i++) { const x = arr[i], y = arr[m - 1 - i]; if (x && y) db.matches.push(blank(t, 'group', r, ++pos, t.bo_default, x, y, gi)); }
          arr = [arr[0], arr[m - 1], ...arr.slice(1, m - 1)];
        }
      }
    }
    function report(m, a, b) {
      (m.team_a && m.team_b) || fail('В матче ещё нет обеих команд');
      (a >= 0 && b >= 0 && a !== b) || fail('Укажите счёт без ничьей');
      const w = a > b ? m.team_a : m.team_b, prev = m.winner_id;
      if (prev && prev !== w) unwind(m);
      Object.assign(m, { score_a: a, score_b: b, winner_id: w, status: 'finished', is_bye: false });
      if (prev !== w) advance(m);
      resolve(m.tournament_id);
    }
    function joinTeamCore(tm, u) {
      const t = T(tm.tournament_id); needReg(t);
      db.members.some(z => z.tournament_id === t.id && z.user_id === u.id) && fail('Вы уже состоите в команде этого турнира');
      const cnt = db.members.filter(z => z.team_id === tm.id).length;
      cnt >= t.team_size + t.max_subs && fail('В команде нет свободных мест');
      db.members.push({ team_id: tm.id, tournament_id: t.id, user_id: u.id, role: cnt >= t.team_size ? 'sub' : 'player', joined_at: now() });
      db.agents = db.agents.filter(a => !(a.tournament_id === t.id && a.user_id === u.id));
      db.invites = db.invites.filter(i => !(i.tournament_id === t.id && i.user_id === u.id));
    }
    function rebalance(tm) {
      const t = T(tm.tournament_id);
      const ms = db.members.filter(m => m.team_id === tm.id).sort((a, b) => a.joined_at.localeCompare(b.joined_at));
      let i = 0;
      for (const m of ms) m.role = m.user_id === tm.captain_id ? 'captain' : ++i <= t.team_size - 1 ? 'player' : 'sub';
    }
    function applyT(t, p) {
      const keys = ['title', 'description', 'rules', 'prize', 'entry_fee', 'region', 'banner_url', 'contact_url', 'starts_at', 'reg_closes_at', 'max_teams', 'max_subs', 'bo_default', 'bo_semifinal', 'bo_final', 'map_pool', 'mode', 'format', 'group_count', 'group_advance', 'checkin_minutes'];
      if (p.mode && p.mode !== t.mode && db.teams.some(x => x.tournament_id === t.id)) fail('Режим нельзя менять, когда уже есть команды');
      if (p.format && p.format !== t.format && db.matches.some(m => m.tournament_id === t.id)) fail('Формат сетки нельзя менять, когда сетка уже создана');
      const newMode = p.mode || t.mode;
      if (p.map_pool && (p.map_pool.length < 5 || p.map_pool.length > 10) && !(newMode === '1v1' && p.map_pool.length <= 1)) fail('В пуле должно быть от 5 до 10 карт');
      if (newMode !== '1v1' && (p.map_pool || t.map_pool || []).length < 5) fail('Без выбора карт можно провести только турнир 1 на 1 — выберите от 5 до 10 карт');
      for (const k of keys) if (k in p) t[k] = p[k] === '' ? null : p[k];
      t.team_size = t.mode === '5v5' ? 5 : t.mode === '2v2' ? 2 : 1;
      if (t.mode === '1v1') t.max_subs = 0;
      ['max_teams', 'max_subs', 'bo_default', 'bo_semifinal', 'bo_final', 'group_count', 'group_advance'].forEach(k => t[k] = Number(t[k]));
      if (t.checkin_minutes != null) t.checkin_minutes = Number(t.checkin_minutes);
      if (db.teams.filter(x => x.tournament_id === t.id).length > t.max_teams) fail('Команд уже больше, чем новый лимит');
    }
    const prof = id => { const p = db.profiles.find(x => x.id === id) || {}; const { is_banned, ...rest } = p; return rest; };
    function playerStats() {
      const vis = new Set(db.tournaments.filter(t => t.status === 'published').map(t => t.id));
      const agg = {};
      for (const m of db.matches) {
        if (!vis.has(m.tournament_id) || m.status !== 'finished' || m.is_bye || !m.winner_id) continue;
        const fin = !m.next_match_id && m.bracket !== 'group';
        for (const tid of [m.team_a, m.team_b]) for (const mem of db.members.filter(x => x.team_id === tid)) {
          const a = agg[mem.user_id] || (agg[mem.user_id] = { matches: 0, wins: 0, finals: 0, titles: 0 });
          a.matches++; if (m.winner_id === tid) a.wins++; if (fin) { a.finals++; if (m.winner_id === tid) a.titles++; }
        }
      }
      return db.profiles.map(p => {
        const a = agg[p.id] || { matches: 0, wins: 0, finals: 0, titles: 0 };
        return { user_id: p.id, steam_id: p.steam_id, nickname: p.nickname, avatar_url: p.avatar_url, country: p.country, faceit_level: p.faceit_level,
          tournaments: db.members.filter(x => x.user_id === p.id && vis.has(x.tournament_id)).length, ...a, points: a.wins * 3 + a.finals * 3 + a.titles * 10 };
      });
    }
    function withTeams(ms, myIds) {
      const tm = id => db.teams.find(x => x.id === id);
      return ms.map(m => ({ ...m, A: tm(m.team_a), B: tm(m.team_b), mine: myIds.includes(m.team_a) ? m.team_a : m.team_b, tournament: db.tournaments.find(t => t.id === m.tournament_id) }));
    }

    if (!db || db.v !== 3) { db = seed(); try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (_) {} }

    const api = {
      demo: true,
      get me() { const m = me(); return m ? { ...m } : null; },
      async init() { return null; },
      login() { db.session = 'me'; save(); location.reload(); },
      async logout() { db.session = null; save(); },
      async refreshMe() { return me(); },
      reset() { localStorage.removeItem(KEY); location.reload(); },

      async listTournaments(scope = 'public') {
        const m = me();
        let list = db.tournaments;
        if (scope === 'public') list = list.filter(t => t.status === 'published');
        else if (scope === 'pending') list = list.filter(t => t.status === 'pending');
        else if (scope === 'mine') list = list.filter(t => m && t.organizer_id === m.id);
        return delay(list.map(card).sort((a, b) => a.starts_at.localeCompare(b.starts_at)));
      },
      async getTournament(id) {
        const t = db.tournaments.find(x => x.id === id);
        if (!t || !visible(t)) return delay(null);
        const teams = db.teams.filter(x => x.tournament_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(tm => {
          const { join_code, ...pub } = tm;
          return { ...pub, members: db.members.filter(m => m.team_id === tm.id).map(m => ({ ...prof(m.user_id), user_id: m.user_id, role: m.role, joined_at: m.joined_at }))
            .sort((a, b) => (a.role === 'captain' ? -1 : b.role === 'captain' ? 1 : 0) || (a.role === 'sub') - (b.role === 'sub') || a.joined_at.localeCompare(b.joined_at)) };
        });
        const u = me();
        return delay(JSON.parse(JSON.stringify({
          t: card(t), teams,
          matches: db.matches.filter(m => m.tournament_id === id).sort((a, b) => a.round - b.round || a.position - b.position),
          announcements: db.announcements.filter(a => a.tournament_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at)),
          agents: db.agents.filter(a => a.tournament_id === id).map(a => ({ ...prof(a.user_id), user_id: a.user_id, note: a.note, created_at: a.created_at })),
          invites: db.invites.filter(i => i.tournament_id === id && u && (i.user_id === u.id || canManage(t) || (db.teams.find(x => x.id === i.team_id) || {}).captain_id === u.id)),
        })));
      },
      async contactsFor(ids) { return me() ? Object.fromEntries(ids.filter(i => db.contacts[i]).map(i => [i, { user_id: i, ...db.contacts[i] }])) : {}; },
      async createTournament(p) {
        const m = needMe();
        if (!m.is_admin && db.tournaments.filter(t => t.organizer_id === m.id && t.status === 'pending').length >= 3) fail('У вас уже 3 турнира на модерации — дождитесь проверки');
        p.starts_at || fail('Укажите дату начала');
        const t = { id: uid(), organizer_id: m.id, status: m.is_admin ? 'published' : 'pending', stage: 'registration', mode: '5v5', team_size: 5, max_subs: 1, max_teams: 16, region: 'RU / СНГ', description: '', rules: '', map_pool: MAP_POOL.slice(0, 7), bo_default: 1, bo_semifinal: 3, bo_final: 3, format: 'single', group_count: 2, group_advance: 2, checkin_minutes: null, created_at: now() };
        applyT(t, p); db.tournaments.push(t); save(); return delay(t.id);
      },
      async updateTournament(id, p) { const t = T(id); needManage(t); applyT(t, p); if (!me().is_admin && t.status === 'rejected') { t.status = 'pending'; t.moderation_note = null; } save(); },
      async setStage(id, s) { const t = T(id); needManage(t); t.stage = s; save(); },
      async moderate(id, status, note) { needMe().is_admin || fail('Только для администраторов'); const t = T(id); t.status = status; t.moderation_note = note || null; save(); },
      async deleteTournament(id) {
        const t = T(id); needManage(t);
        if (!me().is_admin && db.teams.some(x => x.tournament_id === id)) fail('В турнире уже есть команды. Отмените турнир (стадия «Отменён») или обратитесь к администратору');
        db.tournaments = db.tournaments.filter(x => x.id !== id); save();
      },

      async createTeam(tid, x) {
        const m = needMe(), t = T(tid); needReg(t);
        db.members.some(z => z.tournament_id === tid && z.user_id === m.id) && fail('Вы уже состоите в команде этого турнира');
        db.teams.filter(z => z.tournament_id === tid).length >= t.max_teams && fail('Все места в турнире заняты');
        (x.name || '').trim().length >= 2 || fail('Название — минимум 2 символа');
        db.teams.some(z => z.tournament_id === tid && z.name.toLowerCase() === x.name.trim().toLowerCase()) && fail('Команда с таким названием уже есть');
        const tm = { id: uid(), tournament_id: tid, name: x.name.trim(), tag: (x.tag || '').toUpperCase() || null, logo_url: x.logo || null, captain_id: m.id, is_open: x.open !== false || t.team_size === 1, seed: null, created_at: now(), checked_in_at: null, join_code: code() };
        db.teams.push(tm);
        db.members.push({ team_id: tm.id, tournament_id: tid, user_id: m.id, role: 'captain', joined_at: now() });
        db.agents = db.agents.filter(a => !(a.tournament_id === tid && a.user_id === m.id));
        db.invites = db.invites.filter(i => !(i.tournament_id === tid && i.user_id === m.id));
        save(); return delay({ team_id: tm.id, join_code: tm.join_code });
      },
      async joinTeam(teamId, c) {
        const u = needMe(), tm = team(teamId); needReg(T(tm.tournament_id));
        if (!tm.is_open && (c || '').trim().toUpperCase() !== tm.join_code) fail('Неверный код команды');
        joinTeamCore(tm, u); save();
      },
      async joinByCode(tid, c) {
        const tm = db.teams.find(x => x.tournament_id === tid && x.join_code === (c || '').trim().toUpperCase()) || fail('Команда с таким кодом не найдена');
        await api.joinTeam(tm.id, c); return tm.id;
      },
      async teamCode(teamId) { const tm = team(teamId); (tm.captain_id === needMe().id || canManage(T(tm.tournament_id))) || fail('Код видит только капитан'); return tm.join_code; },
      async updateTeam(teamId, p) {
        const tm = team(teamId); (tm.captain_id === needMe().id || canManage(T(tm.tournament_id))) || fail('Менять команду может только капитан');
        if (p.name !== undefined) tm.name = p.name.trim() || tm.name;
        if (p.tag !== undefined) tm.tag = (p.tag || '').toUpperCase() || null;
        if (p.logo_url !== undefined) tm.logo_url = p.logo_url || null;
        if (p.is_open !== undefined) tm.is_open = p.is_open;
        if (p.new_code) tm.join_code = code();
        save();
      },
      async leaveTeam(teamId) {
        const m = needMe(), tm = team(teamId);
        ['registration', 'closed'].includes(T(tm.tournament_id).stage) || fail('Турнир уже идёт — выйти из команды можно только через организатора');
        if (tm.captain_id === m.id) {
          const heir = db.members.filter(z => z.team_id === teamId && z.user_id !== m.id).sort((a, b) => a.joined_at.localeCompare(b.joined_at))[0];
          if (!heir) { db.teams = db.teams.filter(x => x.id !== teamId); db.members = db.members.filter(z => z.team_id !== teamId); save(); return; }
          tm.captain_id = heir.user_id;
        }
        db.members = db.members.filter(z => !(z.team_id === teamId && z.user_id === m.id)); rebalance(tm); save();
      },
      async kick(teamId, member) {
        const tm = team(teamId); (tm.captain_id === needMe().id || canManage(T(tm.tournament_id))) || fail('Исключать игроков может только капитан');
        member === tm.captain_id && fail('Капитана нельзя исключить — сначала передайте капитанство');
        db.members = db.members.filter(z => !(z.team_id === teamId && z.user_id === member)); rebalance(tm); save();
      },
      async makeCaptain(teamId, member) {
        const tm = team(teamId); (tm.captain_id === needMe().id || canManage(T(tm.tournament_id))) || fail('Передать капитанство может только капитан');
        tm.captain_id = member; rebalance(tm); save();
      },
      async disbandTeam(teamId) {
        const tm = db.teams.find(x => x.id === teamId); if (!tm) return;
        const t = T(tm.tournament_id);
        if (!canManage(t)) { tm.captain_id === needMe().id || fail('Распустить команду может только капитан'); t.stage === 'registration' || fail('Регистрация закрыта — распустить команду может только организатор'); }
        db.teams = db.teams.filter(x => x.id !== teamId); db.members = db.members.filter(z => z.team_id !== teamId); db.invites = db.invites.filter(i => i.team_id !== teamId);
        db.matches.forEach(mm => { if (mm.team_a === teamId) mm.team_a = null; if (mm.team_b === teamId) mm.team_b = null; });
        save();
      },
      async checkin(teamId) {
        const u = needMe(), tm = team(teamId), t = T(tm.tournament_id);
        tm.captain_id === u.id || fail('Подтверждает участие капитан команды');
        t.checkin_minutes || fail('В этом турнире нет чек-ина');
        ['registration', 'closed'].includes(t.stage) || fail('Турнир уже начался');
        Date.now() >= new Date(t.starts_at) - t.checkin_minutes * 6e4 || fail(`Чек-ин откроется за ${t.checkin_minutes} мин. до начала`);
        tm.checked_in_at = tm.checked_in_at || now(); save();
      },
      async setCheckin(teamId, v) { const tm = team(teamId); needManage(T(tm.tournament_id)); tm.checked_in_at = v ? (tm.checked_in_at || now()) : null; save(); },
      async setFreeAgent(tid, note) {
        const u = needMe(), t = T(tid); needReg(t);
        db.members.some(z => z.tournament_id === tid && z.user_id === u.id) && fail('Вы уже в команде этого турнира');
        const a = db.agents.find(x => x.tournament_id === tid && x.user_id === u.id);
        if (a) a.note = note || null; else db.agents.push({ tournament_id: tid, user_id: u.id, note: note || null, created_at: now() });
        save();
      },
      async removeFreeAgent(tid) { const u = needMe(); db.agents = db.agents.filter(a => !(a.tournament_id === tid && a.user_id === u.id)); save(); },
      async invitePlayer(teamId, member) {
        const u = needMe(), tm = team(teamId), t = T(tm.tournament_id);
        tm.captain_id === u.id || fail('Приглашать может только капитан');
        needReg(t);
        db.members.some(z => z.tournament_id === t.id && z.user_id === member) && fail('Игрок уже в команде этого турнира');
        db.members.filter(z => z.team_id === teamId).length >= t.team_size + t.max_subs && fail('В команде нет свободных мест');
        if (!db.invites.some(i => i.team_id === teamId && i.user_id === member)) db.invites.push({ team_id: teamId, tournament_id: t.id, user_id: member, created_at: now() });
        save();
      },
      async cancelInvite(teamId, member) {
        const tm = team(teamId); (tm.captain_id === needMe().id || canManage(T(tm.tournament_id))) || fail('Отменить приглашение может только капитан');
        db.invites = db.invites.filter(i => !(i.team_id === teamId && i.user_id === member)); save();
      },
      async respondInvite(teamId, accept) {
        const u = needMe();
        db.invites.some(i => i.team_id === teamId && i.user_id === u.id) || fail('Приглашение не найдено или уже отозвано');
        if (accept) joinTeamCore(team(teamId), u); else db.invites = db.invites.filter(i => !(i.team_id === teamId && i.user_id === u.id));
        save();
      },

      async generateBracket(tid, seeds, shuffle) {
        const t = T(tid); needManage(t);
        const pool = db.teams.filter(x => x.tournament_id === tid && (!t.checkin_minutes || x.checked_in_at)).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(x => x.id);
        let ids = pool.slice();
        if (seeds && seeds.length) ids = [...seeds.filter(s => pool.includes(s)), ...pool.filter(i => !seeds.includes(i))];
        else if (shuffle) ids.sort(() => Math.random() - .5);
        ids.length >= 2 || fail(t.checkin_minutes ? 'Для сетки нужно минимум 2 команды, прошедшие чек-ин' : 'Для сетки нужно минимум 2 команды');
        if (t.format === 'groups' && ids.length < 3) fail('Для группового этапа нужно минимум 3 команды');
        db.matches = db.matches.filter(m => m.tournament_id !== tid);
        db.teams.filter(x => x.tournament_id === tid).forEach(x => { x.seed = ids.indexOf(x.id) + 1 || null; });
        if (t.format === 'groups') buildGroups(t, ids); else { buildElim(t, ids, t.format === 'double'); resolve(tid); }
        if (['registration', 'closed'].includes(t.stage)) t.stage = 'ongoing';
        save();
      },
      async generatePlayoff(tid) {
        const t = T(tid); needManage(t);
        t.format === 'groups' || fail('Плей-офф из групп есть только в формате «Группы + плей-офф»');
        const gm = db.matches.filter(m => m.tournament_id === tid && m.bracket === 'group');
        gm.length || fail('Сначала сформируйте группы');
        gm.every(m => m.status === 'finished') || fail('Ещё не все матчи групп сыграны');
        const st = groupStandings(gm, db.teams.filter(x => x.tournament_id === tid)).filter(r => r.place <= t.group_advance).sort((a, b) => a.place - b.place || a.group_no - b.group_no);
        st.length >= 2 || fail('В плей-офф выходит меньше двух команд');
        db.matches = db.matches.filter(m => m.tournament_id !== tid || m.bracket === 'group');
        buildElim(t, st.map(r => r.team_id), false); resolve(tid); t.stage = 'ongoing'; save();
      },
      async updateMatch(mid, p) {
        const m = M(mid); needManage(T(m.tournament_id));
        for (const k of ['team_a', 'team_b', 'scheduled_at', 'best_of']) if (k in p) m[k] = p[k] === '' ? null : p[k];
        if (p.status && !m.winner_id) m.status = p.status;
        m.best_of = Number(m.best_of); save();
      },
      async reportResult(mid, a, b) { const m = M(mid); needManage(T(m.tournament_id)); report(m, a, b); save(); },
      async resetResult(mid) {
        const m = M(mid); needManage(T(m.tournament_id));
        m.is_bye && fail('Проход без игры нельзя сбросить — пересоздайте сетку');
        unwind(m); Object.assign(m, { score_a: null, score_b: null, winner_id: null, status: 'pending' }); save();
      },
      async vetoAction(mid, map) {
        const u = needMe(), m = M(mid), t = T(m.tournament_id);
        (m.team_a && m.team_b) || fail('В матче ещё нет обеих команд');
        m.status !== 'finished' || fail('Матч уже сыгран');
        t.map_pool.length >= 2 || fail('В этом турнире нет пиков и банов — карту назначает организатор');
        const seq = vetoSequence(m.best_of, t.map_pool.length), step = m.veto.log.length;
        step < seq.length || fail('Пики и баны уже завершены');
        const side = step % 2 === 0 ? 'A' : 'B';
        team(side === 'A' ? m.team_a : m.team_b).captain_id === u.id || fail('Сейчас ход капитана другой команды');
        const used = m.veto.log.map(l => l.map);
        (t.map_pool.includes(map) && !used.includes(map)) || fail('Эта карта недоступна');
        m.veto.log.push({ side, action: seq[step], map, at: now() });
        if (step + 1 === seq.length) m.veto.decider = t.map_pool.find(x => ![...used, map].includes(x));
        save(); return m.veto;
      },
      async resetVeto(mid) { const m = M(mid); needManage(T(m.tournament_id)); m.veto = { log: [] }; save(); },
      async addAnnouncement(tid, body) { const t = T(tid); needManage(t); db.announcements.push({ id: uid(), tournament_id: tid, author_id: me().id, body: body.trim(), created_at: now() }); save(); },
      async deleteAnnouncement(id) { const a = db.announcements.find(x => x.id === id); needManage(T(a.tournament_id)); db.announcements = db.announcements.filter(x => x.id !== id); save(); },

      async uploadImage(file, kind) {
        needMe();
        const blob = await shrink(file, kind);
        return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
      },

      async getProfile(steamId) {
        const p = db.profiles.find(x => x.steam_id === steamId); if (!p) return null;
        const teams = db.members.filter(m => m.user_id === p.id).map(m => {
          const tm = db.teams.find(x => x.id === m.team_id), t = db.tournaments.find(x => x.id === m.tournament_id);
          return { role: m.role, team_id: m.team_id, team: tm, tournament: t && visible(t) ? t : null };
        }).filter(x => x.tournament);
        const ids = teams.map(x => x.team_id);
        const history = withTeams(db.matches.filter(m => (ids.includes(m.team_a) || ids.includes(m.team_b)) && m.status === 'finished' && !m.is_bye), ids).reverse().slice(0, 30);
        return delay({ profile: prof(p.id), teams, organized: db.tournaments.filter(t => t.organizer_id === p.id && visible(t)).map(card), stats: playerStats().find(s => s.user_id === p.id), history });
      },
      async myContacts() { const m = me(); return m ? (db.contacts[m.id] || {}) : {}; },
      async updateProfile(p) {
        const m = needMe();
        for (const k of ['faceit_url', 'faceit_level', 'premier_rating', 'bio']) if (k in p) m[k] = p[k] === '' ? null : p[k];
        db.contacts[m.id] = { ...(db.contacts[m.id] || {}), discord: p.discord || null, telegram: p.telegram || null };
        save();
      },
      async leaderboard() { return delay(playerStats().filter(s => s.matches > 0).sort((a, b) => b.points - a.points || b.wins - a.wins)); },
      async myDashboard() {
        const u = me(); if (!u) return null;
        const mem = db.members.filter(m => m.user_id === u.id).map(m => ({ ...m, t: db.tournaments.find(t => t.id === m.tournament_id) }))
          .filter(x => x.t && x.t.status === 'published' && ['registration', 'closed', 'ongoing'].includes(x.t.stage));
        const ids = mem.map(x => x.team_id);
        const matches = withTeams(db.matches.filter(m => (ids.includes(m.team_a) || ids.includes(m.team_b)) && m.status !== 'finished' && m.team_a && m.team_b), ids)
          .sort((a, b) => (a.scheduled_at || '9').localeCompare(b.scheduled_at || '9'));
        const checkins = mem.filter(x => x.t.checkin_minutes && ['registration', 'closed'].includes(x.t.stage))
          .map(x => { const tm = db.teams.find(y => y.id === x.team_id); return { team: tm, tournament: x.t, captain: tm.captain_id === u.id }; });
        const invites = db.invites.filter(i => i.user_id === u.id).map(i => ({ ...i, team: db.teams.find(x => x.id === i.team_id), tournament: db.tournaments.find(t => t.id === i.tournament_id) })).filter(i => i.team && i.tournament);
        return delay(JSON.parse(JSON.stringify({ matches, checkins, invites })));
      },
      async searchProfiles(q) {
        q = (q || '').toLowerCase();
        return delay(db.profiles.filter(p => !q || p.nickname.toLowerCase().includes(q) || p.steam_id === q).slice(0, 30));
      },
      async setAdmin(steamId, v) { needMe().is_admin || fail('Только для администраторов'); const p = db.profiles.find(x => x.steam_id === steamId) || fail('Игрок с таким Steam ID ещё не входил на сайт'); p.is_admin = v; save(); },
      async setBanned(userId, v) { needMe().is_admin || fail('Только для администраторов'); db.profiles.find(x => x.id === userId).is_banned = v; save(); },
      async stats() { return { tournaments: db.tournaments.filter(t => t.status === 'published').length, teams: db.teams.length, players: db.profiles.length }; },
      subscribe(tid, cb) { listeners.add(cb); return () => listeners.delete(cb); },
    };
    return api;

    // ---------- демонстрационные данные ----------
    function seed() {
      const t0 = Date.now(), day = 864e5, iso = ms => new Date(ms).toISOString();
      const nicks = ['Rush3r', 'kvant', 'SaNeK', 'b1ade', 'Mor1arty', 'fl1ckz', 'ZeRo_', 'Hellraiser', 'nek0', 'Krypto', 'vortex', 'Snapy', 'Tr1ckster', 'Gh0st', 'Ra1den', 'Bulat', 'Arch1e', 'D1ma', 'KOT', 'shadoW', 'Lynx', 'Jinx', 'Pulse', 'Wolfie',
        'aZ1z', 'Nomad', 'Vint', 'Sk1f', 'Bober', 'Frosty', 'Hydra', 'Rocket', 'k1nG', 'TaToo', 'Zver', 'Echo', 'Blaze', 'Oxide', 'Rapid', 'Venom', 'S1ren', 'Q-Ball', 'Tesla', 'Grom', 'Yeti', 'Orion', 'Marlin', 'Spike', 'Tundra', 'Comet', 'Flint', 'Ranger', 'Viper', 'Pixel', 'Storm', 'Neon', 'Raven', 'Cobra', 'Hawk', 'Bison'];
      const profiles = [{ id: 'me', steam_id: '76561198000000000', nickname: 'Вы (демо)', avatar_url: null, profile_url: 'https://steamcommunity.com/', country: 'RU', faceit_level: 8, premier_rating: 17400, faceit_url: null, bio: 'Демо-аккаунт: у него права администратора, чтобы показать все функции.', is_admin: true, is_banned: false, created_at: iso(t0 - 30 * day) }];
      nicks.forEach((n, i) => profiles.push({ id: 'p' + i, steam_id: '765611980' + String(10000000 + i * 7919).padStart(8, '0'), nickname: n, avatar_url: null, profile_url: 'https://steamcommunity.com/', country: 'RU', faceit_level: 1 + (i * 7) % 10, premier_rating: 8000 + (i * 1373) % 17000, faceit_url: null, bio: null, is_admin: false, is_banned: false, created_at: iso(t0 - (60 - i) * day) }));
      db = { v: 3, session: null, profiles, tournaments: [], teams: [], members: [], matches: [], announcements: [], agents: [], invites: [], contacts: { me: { discord: 'demo_player', telegram: '@demo' }, p40: { discord: 'orion_awp', telegram: null }, p41: { discord: 'marlin#7', telegram: '@marlin' } } };
      let pi = 0, ti = 0;
      const nextP = () => profiles[1 + (pi++ % 40)].id;
      const RULES = '1. Матчи играются на серверах организатора, античит обязателен.\n2. Опоздание более 15 минут — техническое поражение.\n3. Пики и баны проходят на сайте до начала матча.\n4. Споры решает главный судья, его решение окончательное.';
      const mkT = o => { const t = { id: 't' + (++ti), description: '', rules: RULES, prize: null, entry_fee: 'Бесплатно', region: 'RU / СНГ', banner_url: null, contact_url: 'https://t.me/', map_pool: MAP_POOL.slice(0, 7), bo_default: 1, bo_semifinal: 3, bo_final: 3, team_size: 5, max_subs: 1, mode: '5v5', status: 'published', stage: 'registration', created_at: iso(t0 - 10 * day), organizer_id: 'p0', reg_closes_at: null, format: 'single', group_count: 2, group_advance: 2, checkin_minutes: null, ...o }; db.tournaments.push(t); return t; };
      let tmi = 0;
      const mkTeam = (t, name, tag, size, captain) => {
        const tm = { id: 'tm' + (++tmi), tournament_id: t.id, name, tag, logo_url: null, captain_id: captain || nextP(), is_open: tmi % 3 !== 0, seed: null, created_at: iso(t0 - (40 - tmi) * 36e5), checked_in_at: null, join_code: 'DEMO' + (1000 + tmi) };
        db.teams.push(tm);
        db.members.push({ team_id: tm.id, tournament_id: t.id, user_id: tm.captain_id, role: 'captain', joined_at: tm.created_at });
        for (let i = 1; i < size; i++) db.members.push({ team_id: tm.id, tournament_id: t.id, user_id: nextP(), role: i < t.team_size ? 'player' : 'sub', joined_at: iso(new Date(tm.created_at).getTime() + i * 6e4) });
        return tm;
      };
      const seedAll = (t, list) => { list.forEach((x, i) => x.seed = i + 1); return list.map(x => x.id); };
      const playUntil = (t, count, pick) => {
        for (let i = 0; i < count; i++) {
          const m = db.matches.filter(x => x.tournament_id === t.id && x.status !== 'finished' && x.team_a && x.team_b)
            .sort((a, b) => (a.bracket === 'group' ? 0 : ORDER[a.bracket]) - (b.bracket === 'group' ? 0 : ORDER[b.bracket]) || a.round - b.round || a.position - b.position)[0];
          if (!m) return;
          const aWins = pick ? pick(m) : team(m.team_a).seed < team(m.team_b).seed;
          const lose = 3 + ((m.round * 5 + m.position * 3) % 10);
          if (m.best_of > 1) report(m, aWins ? 2 : 1, aWins ? 1 : 2); else report(m, aWins ? 13 : lose, aWins ? lose : 13);
          m.veto = { log: [], decider: MAP_POOL[(m.round + m.position) % 7] };
        }
      };
      const TEAMS = [['Северные Волки', 'NWV'], ['Red Fox', 'RFX'], ['Iron Squad', 'IRN'], ['Ночной Дозор', 'NDZ'], ['Pixel Gang', 'PXL'], ['Сибирь', 'SIB'], ['Mad Hatters', 'MAD'], ['Кибер Барсы', 'KBR'], ['Echo Five', 'EC5'], ['Тайга', 'TGA'], ['Volt', 'VLT'], ['Гроза', 'GRZ']];

      // 1. регистрация открыта, есть свободные агенты
      const t1 = mkT({ title: 'Organizm Winter Cup', starts_at: iso(t0 + 9 * day), reg_closes_at: iso(t0 + 8 * day), prize: '30 000 ₽', max_teams: 16, format: 'double',
        description: 'Главный зимний турнир сообщества. Двойное выбывание: проигравшие получают второй шанс в нижней сетке. Гранд-финал — Bo3 с трансляцией.' });
      for (let i = 0; i < 9; i++) mkTeam(t1, TEAMS[i][0], TEAMS[i][1], 4 + (i % 3));
      db.agents.push({ tournament_id: t1.id, user_id: 'p40', note: 'AWP, 9 lvl FACEIT, играю по вечерам', created_at: iso(t0 - 5 * 36e5) });
      db.agents.push({ tournament_id: t1.id, user_id: 'p41', note: 'Рифлер / IGL, есть микрофон', created_at: iso(t0 - 3 * 36e5) });
      db.agents.push({ tournament_id: t1.id, user_id: 'p42', note: null, created_at: iso(t0 - 36e5) });

      // 2. идёт: олимпийская, полуфинал с пиками/банами, демо-пользователь — капитан
      const t2 = mkT({ title: 'Night Clash #12', starts_at: iso(t0 - 2 * 36e5), stage: 'ongoing', prize: '10 000 ₽', max_teams: 8, description: 'Вечерний кубок за один вечер: восемь команд, четвертьфиналы в Bo1, плей-офф в Bo3.' });
      const t2teams = TEAMS.slice(0, 8).map((x, i) => mkTeam(t2, x[0], x[1], 5, i === 0 ? 'me' : null));
      buildElim(t2, seedAll(t2, t2teams), false);
      playUntil(t2, 4);
      const semi = db.matches.find(m => m.tournament_id === t2.id && m.round === 2 && m.position === 1);
      semi.status = 'live';
      semi.veto = { log: [{ side: 'A', action: 'ban', map: 'Train', at: iso(t0 - 3e5) }, { side: 'B', action: 'ban', map: 'Anubis', at: iso(t0 - 2e5) }] };
      db.matches.filter(m => m.tournament_id === t2.id).forEach(m => { m.scheduled_at = iso(t0 - 2 * 36e5 + (m.round - 1) * 5400e3 + m.position * 6e5); });
      db.announcements.push({ id: 'a1', tournament_id: t2.id, author_id: 'p0', body: 'Четвертьфиналы сыграны! Полуфиналы стартуют в 21:00, капитаны — проведите пики и баны на сайте.', created_at: iso(t0 - 36e5) });

      // 3. двойная сетка в процессе
      const t3 = mkT({ title: 'Major Qualifier', starts_at: iso(t0 - day), stage: 'ongoing', prize: 'Слот на LAN-финал', max_teams: 8, format: 'double', organizer_id: 'p3',
        description: 'Отборочный турнир по системе двойного выбывания. Проигравшие в верхней сетке получают второй шанс в нижней.' });
      const t3teams = ['Phoenix', 'Ледокол', 'Spectre', 'Буран', 'Atlas', 'Квазар'].map((n, i) => mkTeam(t3, n, null, 5));
      buildElim(t3, seedAll(t3, t3teams), true);
      playUntil(t3, 6, m => (m.round + m.position) % 3 !== 0);

      // 4. группы + плей-офф: группы сыграны частично
      const t4 = mkT({ title: 'Лига выходного дня', starts_at: iso(t0 - 2 * day), stage: 'ongoing', prize: '15 000 ₽', max_teams: 8, format: 'groups', group_count: 2, group_advance: 2, organizer_id: 'p7',
        description: 'Две группы по четыре команды, круговой турнир Bo1. Две лучшие команды из каждой группы выходят в плей-офф.' });
      const t4teams = ['Вихрь', 'Nova', 'Арктика', 'Cerberus', 'Мираж', 'Titan', 'Скиф', 'Orbit'].map(n => mkTeam(t4, n, null, 5));
      buildGroups(t4, seedAll(t4, t4teams));
      playUntil(t4, 9, m => (m.round * 7 + m.position * 3 + m.group_no) % 4 !== 0);

      // 5. 1v1 завершён
      const t5 = mkT({ title: 'Aim Kings 1v1', mode: '1v1', team_size: 1, max_subs: 0, starts_at: iso(t0 - 6 * day), stage: 'finished', prize: 'Нож из коллекции', max_teams: 8, map_pool: ['Mirage', 'Dust2', 'Inferno', 'Nuke', 'Ancient'], organizer_id: 'p7' });
      const solo = [];
      for (let i = 0; i < 8; i++) { const cap = nextP(); solo.push(mkTeam(t5, profiles.find(p => p.id === cap).nickname, null, 1, cap)); }
      buildElim(t5, seedAll(t5, solo), false);
      playUntil(t5, 7, m => (m.round + m.position) % 2 === 1);

      // аим-турнир 1 на 1 без выбора карт
      const ta = mkT({ title: 'Aim Duel Cup', mode: '1v1', team_size: 1, max_subs: 0, starts_at: iso(t0 + 3 * day), max_teams: 16, map_pool: ['aim_map'], bo_default: 1, bo_semifinal: 1, bo_final: 3, organizer_id: 'p5', prize: '5 000 ₽',
        description: 'Дуэли 1 на 1 на aim_map. Пиков и банов нет — все матчи играются на одной карте до 16 убийств.' });
      for (let i = 0; i < 6; i++) { const cap = nextP(); mkTeam(ta, profiles.find(p => p.id === cap).nickname, null, 1, cap); }

      // 6. скоро старт, открыт чек-ин, демо-пользователь — капитан
      const t6 = mkT({ title: 'Кубок новичков', starts_at: iso(t0 + 25 * 6e4), checkin_minutes: 30, max_teams: 8, organizer_id: 'me', prize: 'Медали и роли в Discord', description: 'Для игроков до 10 уровня FACEIT. Чек-ин за 30 минут до старта — команды без чек-ина в сетку не попадут.' });
      mkTeam(t6, 'Тестовые Ястребы', 'HWK', 4, 'me');
      const v1 = mkTeam(t6, TEAMS[10][0], TEAMS[10][1], 5); v1.checked_in_at = iso(t0 - 6e4);
      mkTeam(t6, TEAMS[11][0], TEAMS[11][1], 5);
      db.invites.push({ team_id: db.teams.find(x => x.tournament_id === t1.id && x.name === 'Северные Волки').id, tournament_id: t1.id, user_id: 'me', created_at: iso(t0 - 6e5) });

      mkT({ title: 'Пятничный микс', status: 'pending', starts_at: iso(t0 + 4 * day), prize: '2 000 ₽', max_teams: 8, organizer_id: 'p5', description: 'Собираем команды из одиночек и играем вечером в пятницу.' });
      return db;
    }
  }

  window.OrganizmApi = {
    create(cfg) {
      const forceDemo = new URLSearchParams(location.search).has('demo');
      const ready = cfg && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase && !forceDemo;
      return ready ? supaApi(cfg) : demoApi();
    },
    vetoSequence, groupStandings, MAP_POOL,
  };
})();
