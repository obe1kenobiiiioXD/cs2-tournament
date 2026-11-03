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
  const MAP_POOL = ['Mirage', 'Inferno', 'Nuke', 'Ancient', 'Anubis', 'Dust2', 'Train', 'Overpass', 'Vertigo'];
  const cleanErr = m => String(m || 'Ошибка').replace(/^(ERROR:\s*)/, '').replace(/\s*\(SQLSTATE.*$/, '');

  // =====================================================================
  //  SUPABASE
  // =====================================================================
  function supaApi(cfg) {
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'organizm-auth' },
    });
    const TEAM_COLS = 'id,tournament_id,name,tag,logo_url,captain_id,is_open,seed,created_at';
    const PUB_PROFILE = 'id,steam_id,nickname,avatar_url,profile_url,country,faceit_url,faceit_level,premier_rating,bio,is_admin,created_at';
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

    return {
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
        const [t, teams, members, matches, ann] = await Promise.all([
          sb.from('tournament_cards').select('*').eq('id', id).maybeSingle(),
          sb.from('teams').select(TEAM_COLS).eq('tournament_id', id).order('created_at'),
          sb.from('team_members').select('team_id,user_id,role,joined_at,profile:profiles(id,steam_id,nickname,avatar_url,faceit_level,premier_rating,country)').eq('tournament_id', id),
          sb.from('matches').select('*').eq('tournament_id', id).order('round').order('position'),
          sb.from('announcements').select('*').eq('tournament_id', id).order('created_at', { ascending: false }),
        ]);
        const tour = unwrap(t);
        if (!tour) return null;
        return { t: tour, teams: shapeTeams(unwrap(teams), unwrap(members)), matches: unwrap(matches), announcements: unwrap(ann) };
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

      generateBracket: (tid, seeds, shuffle) => rpc('generate_bracket', { t: tid, seeds: seeds || null, shuffle: !!shuffle }),
      updateMatch: (mid, p) => rpc('update_match', { mid, p }),
      reportResult: (mid, a, b) => rpc('report_result', { mid, sa: a, sb: b }),
      resetResult: mid => rpc('reset_result', { mid }),
      vetoAction: (mid, map) => rpc('veto_action', { mid, map_name: map }),
      resetVeto: mid => rpc('reset_veto', { mid }),
      addAnnouncement: (tid, body) => rpc('add_announcement', { t: tid, text_body: body }),
      deleteAnnouncement: id => rpc('delete_announcement', { aid: id }),

      async getProfile(steamId) {
        const p = unwrap(await sb.from('profiles').select(PUB_PROFILE).eq('steam_id', steamId).maybeSingle());
        if (!p) return null;
        const [teams, organized] = await Promise.all([
          sb.from('team_members').select('role,team:teams(id,name,tag,logo_url),tournament:tournaments(id,title,starts_at,stage,status,mode)').eq('user_id', p.id),
          sb.from('tournament_cards').select('*').eq('organizer_id', p.id).order('starts_at', { ascending: false }),
        ]);
        return { profile: p, teams: unwrap(teams).filter(x => x.tournament), organized: unwrap(organized) };
      },
      async myContacts() { return me ? (unwrap(await sb.from('profile_contacts').select('*').eq('user_id', me.id).maybeSingle()) || {}) : {}; },
      async updateProfile(p) { await rpc('update_profile', { p }); await loadMe(); },

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
        for (const tbl of ['matches', 'teams', 'team_members', 'announcements']) {
          ch.on('postgres_changes', { event: '*', schema: 'public', table: tbl, filter: `tournament_id=eq.${tid}` }, cb);
        }
        ch.on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${tid}` }, cb);
        ch.subscribe();
        return () => sb.removeChannel(ch);
      },
    };
  }

  // =====================================================================
  //  ДЕМО: те же функции, данные хранятся в браузере
  // =====================================================================
  function demoApi() {
    const KEY = 'organizm_demo_v1';
    let db;
    try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { db = null; }
    if (!db || db.v !== 1) db = seed();
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (_) {} listeners.forEach(f => f()); };
    const listeners = new Set();
    const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    const code = () => Math.random().toString(36).slice(2, 10).toUpperCase();
    const delay = v => new Promise(r => setTimeout(() => r(v), 120));
    const fail = m => { throw new Error(m); };
    const me = () => db.session ? db.profiles.find(p => p.id === db.session) : null;
    const needMe = () => me() || fail('Войдите через Steam');
    const T = id => db.tournaments.find(t => t.id === id) || fail('Турнир не найден');
    const canManage = t => { const m = me(); return !!m && (m.is_admin || t.organizer_id === m.id); };
    const needManage = t => { needMe(); canManage(t) || fail('Недостаточно прав: это может только организатор турнира'); };
    const card = t => {
      const o = db.profiles.find(p => p.id === t.organizer_id) || {};
      return { ...t, organizer_nickname: o.nickname, organizer_avatar: o.avatar_url, organizer_steam_id: o.steam_id, teams_count: db.teams.filter(x => x.tournament_id === t.id).length };
    };
    const visible = t => t.status === 'published' || canManage(t);
    const needReg = t => {
      t.status === 'published' || fail('Турнир ещё не прошёл модерацию');
      (t.stage === 'registration' && (!t.reg_closes_at || new Date(t.reg_closes_at) > new Date())) || fail('Регистрация на турнир закрыта');
    };
    const roundBo = (t, r, total) => r === total ? t.bo_final : r === total - 1 ? t.bo_semifinal : t.bo_default;
    const nextOf = m => db.matches.find(x => x.tournament_id === m.tournament_id && x.round === m.round + 1 && x.position === Math.ceil(m.position / 2));
    function clearForward(m, team) {
      if (!team) return;
      const nx = nextOf(m);
      if (!nx || (nx.team_a !== team && nx.team_b !== team)) return;
      if (nx.winner_id) clearForward(nx, nx.winner_id);
      if (nx.team_a === team) nx.team_a = null; else nx.team_b = null;
      Object.assign(nx, { score_a: null, score_b: null, winner_id: null, status: 'pending', is_bye: false, veto: { log: [] } });
    }
    function advance(m) {
      if (!m.winner_id) return;
      const nx = nextOf(m);
      if (!nx) { T(m.tournament_id).stage = 'finished'; return; }
      if (m.position % 2 === 1) nx.team_a = m.winner_id; else nx.team_b = m.winner_id;
    }
    function rebalance(team) {
      const t = T(team.tournament_id);
      const ms = db.members.filter(m => m.team_id === team.id).sort((a, b) => a.joined_at.localeCompare(b.joined_at));
      let i = 0;
      for (const m of ms) { if (m.user_id === team.captain_id) m.role = 'captain'; else m.role = ++i <= t.team_size - 1 ? 'player' : 'sub'; }
    }
    function applyT(t, p) {
      const keys = ['title', 'description', 'rules', 'prize', 'entry_fee', 'region', 'banner_url', 'contact_url', 'starts_at', 'reg_closes_at', 'max_teams', 'max_subs', 'bo_default', 'bo_semifinal', 'bo_final', 'map_pool', 'mode'];
      if (p.mode && p.mode !== t.mode && db.teams.some(x => x.tournament_id === t.id)) fail('Формат нельзя менять, когда уже есть команды');
      if (p.map_pool && (p.map_pool.length < 5 || p.map_pool.length > 10)) fail('В пуле должно быть от 5 до 10 карт');
      for (const k of keys) if (k in p) t[k] = p[k] === '' ? null : p[k];
      t.team_size = t.mode === '5v5' ? 5 : t.mode === '2v2' ? 2 : 1;
      if (t.mode === '1v1') t.max_subs = 0;
      ['max_teams', 'max_subs', 'bo_default', 'bo_semifinal', 'bo_final'].forEach(k => t[k] = Number(t[k]));
      if (db.teams.filter(x => x.tournament_id === t.id).length > t.max_teams) fail('Команд уже больше, чем новый лимит');
    }

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
          return {
            ...pub,
            members: db.members.filter(m => m.team_id === tm.id).map(m => ({ ...db.profiles.find(p => p.id === m.user_id), user_id: m.user_id, role: m.role, joined_at: m.joined_at }))
              .sort((a, b) => (a.role === 'captain' ? -1 : b.role === 'captain' ? 1 : 0) || (a.role === 'sub') - (b.role === 'sub') || a.joined_at.localeCompare(b.joined_at)),
          };
        });
        const matches = db.matches.filter(m => m.tournament_id === id).sort((a, b) => a.round - b.round || a.position - b.position);
        const ann = db.announcements.filter(a => a.tournament_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at));
        return delay(JSON.parse(JSON.stringify({ t: card(t), teams, matches, announcements: ann })));
      },
      async contactsFor(ids) {
        const m = me(); if (!m) return {};
        return Object.fromEntries(ids.filter(i => db.contacts[i]).map(i => [i, { user_id: i, ...db.contacts[i] }]));
      },
      async createTournament(p) {
        const m = needMe();
        if (!m.is_admin && db.tournaments.filter(t => t.organizer_id === m.id && t.status === 'pending').length >= 3) fail('У вас уже 3 турнира на модерации — дождитесь проверки');
        p.starts_at || fail('Укажите дату начала');
        const t = { id: uid(), organizer_id: m.id, status: m.is_admin ? 'published' : 'pending', stage: 'registration', mode: '5v5', team_size: 5, max_subs: 1, max_teams: 16, region: 'RU / СНГ', description: '', rules: '', map_pool: MAP_POOL.slice(0, 7), bo_default: 1, bo_semifinal: 3, bo_final: 3, created_at: new Date().toISOString() };
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
        db.teams.some(z => z.tournament_id === tid && z.name.toLowerCase() === x.name.trim().toLowerCase()) && fail('Команда с таким названием уже есть');
        (x.name || '').trim().length >= 2 || fail('Название — минимум 2 символа');
        const team = { id: uid(), tournament_id: tid, name: x.name.trim(), tag: (x.tag || '').toUpperCase() || null, logo_url: x.logo || null, captain_id: m.id, is_open: x.open !== false || t.team_size === 1, seed: null, created_at: new Date().toISOString(), join_code: code() };
        db.teams.push(team);
        db.members.push({ team_id: team.id, tournament_id: tid, user_id: m.id, role: 'captain', joined_at: new Date().toISOString() });
        save(); return delay({ team_id: team.id, join_code: team.join_code });
      },
      async joinTeam(teamId, c) {
        const m = needMe(), tm = db.teams.find(x => x.id === teamId) || fail('Команда не найдена'), t = T(tm.tournament_id); needReg(t);
        db.members.some(z => z.tournament_id === t.id && z.user_id === m.id) && fail('Вы уже состоите в команде этого турнира');
        if (!tm.is_open && (c || '').trim().toUpperCase() !== tm.join_code) fail('Неверный код команды');
        const cnt = db.members.filter(z => z.team_id === teamId).length;
        cnt >= t.team_size + t.max_subs && fail('В команде нет свободных мест');
        db.members.push({ team_id: teamId, tournament_id: t.id, user_id: m.id, role: cnt >= t.team_size ? 'sub' : 'player', joined_at: new Date().toISOString() });
        save();
      },
      async joinByCode(tid, c) {
        const tm = db.teams.find(x => x.tournament_id === tid && x.join_code === (c || '').trim().toUpperCase()) || fail('Команда с таким кодом не найдена');
        await api.joinTeam(tm.id, c); return tm.id;
      },
      async teamCode(teamId) { const tm = db.teams.find(x => x.id === teamId); (tm.captain_id === needMe().id || canManage(T(tm.tournament_id))) || fail('Код видит только капитан'); return tm.join_code; },
      async updateTeam(teamId, p) {
        const tm = db.teams.find(x => x.id === teamId); (tm.captain_id === needMe().id || canManage(T(tm.tournament_id))) || fail('Менять команду может только капитан');
        if (p.name !== undefined) tm.name = p.name.trim() || tm.name;
        if (p.tag !== undefined) tm.tag = (p.tag || '').toUpperCase() || null;
        if (p.logo_url !== undefined) tm.logo_url = p.logo_url || null;
        if (p.is_open !== undefined) tm.is_open = p.is_open;
        if (p.new_code) tm.join_code = code();
        save();
      },
      async leaveTeam(teamId) {
        const m = needMe(), tm = db.teams.find(x => x.id === teamId) || fail('Команда не найдена');
        ['registration', 'closed'].includes(T(tm.tournament_id).stage) || fail('Турнир уже идёт — выйти из команды можно только через организатора');
        if (tm.captain_id === m.id) {
          const heir = db.members.filter(z => z.team_id === teamId && z.user_id !== m.id).sort((a, b) => a.joined_at.localeCompare(b.joined_at))[0];
          if (!heir) { db.teams = db.teams.filter(x => x.id !== teamId); db.members = db.members.filter(z => z.team_id !== teamId); save(); return; }
          tm.captain_id = heir.user_id;
        }
        db.members = db.members.filter(z => !(z.team_id === teamId && z.user_id === m.id)); rebalance(tm); save();
      },
      async kick(teamId, member) {
        const tm = db.teams.find(x => x.id === teamId); (tm.captain_id === needMe().id || canManage(T(tm.tournament_id))) || fail('Исключать игроков может только капитан');
        member === tm.captain_id && fail('Капитана нельзя исключить — сначала передайте капитанство');
        db.members = db.members.filter(z => !(z.team_id === teamId && z.user_id === member)); rebalance(tm); save();
      },
      async makeCaptain(teamId, member) {
        const tm = db.teams.find(x => x.id === teamId); (tm.captain_id === needMe().id || canManage(T(tm.tournament_id))) || fail('Передать капитанство может только капитан');
        tm.captain_id = member; rebalance(tm); save();
      },
      async disbandTeam(teamId) {
        const tm = db.teams.find(x => x.id === teamId); if (!tm) return;
        const t = T(tm.tournament_id);
        if (!canManage(t)) { tm.captain_id === needMe().id || fail('Распустить команду может только капитан'); t.stage === 'registration' || fail('Регистрация закрыта — распустить команду может только организатор'); }
        db.teams = db.teams.filter(x => x.id !== teamId); db.members = db.members.filter(z => z.team_id !== teamId);
        db.matches.forEach(mm => { if (mm.team_a === teamId) mm.team_a = null; if (mm.team_b === teamId) mm.team_b = null; });
        save();
      },

      async generateBracket(tid, seeds, shuffle) {
        const t = T(tid); needManage(t);
        let ids = db.teams.filter(x => x.tournament_id === tid).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(x => x.id);
        if (seeds && seeds.length) ids = [...seeds.filter(s => ids.includes(s)), ...ids.filter(i => !seeds.includes(i))];
        else if (shuffle) ids.sort(() => Math.random() - .5);
        const n = ids.length; n >= 2 || fail('Для сетки нужно минимум 2 команды');
        let size = 2, rounds = 1; while (size < n) { size *= 2; rounds++; }
        const ord = seedOrder(size);
        db.matches = db.matches.filter(m => m.tournament_id !== tid);
        db.teams.filter(x => x.tournament_id === tid).forEach(x => { x.seed = ids.indexOf(x.id) + 1 || null; });
        for (let r = 1; r <= rounds; r++) {
          for (let p = 1; p <= size / 2 ** r; p++) {
            const a = r === 1 ? ord[p * 2 - 2] : 0, b = r === 1 ? ord[p * 2 - 1] : 0;
            db.matches.push({ id: uid(), tournament_id: tid, round: r, position: p, team_a: r === 1 && a <= n ? ids[a - 1] : null, team_b: r === 1 && b <= n ? ids[b - 1] : null,
              score_a: null, score_b: null, winner_id: null, best_of: roundBo(t, r, rounds), scheduled_at: null, status: 'pending', is_bye: false, veto: { log: [] } });
          }
        }
        for (const m of db.matches.filter(x => x.tournament_id === tid && x.round === 1)) {
          if (!!m.team_a !== !!m.team_b) { Object.assign(m, { winner_id: m.team_a || m.team_b, status: 'finished', is_bye: true }); advance(m); }
        }
        if (['registration', 'closed'].includes(t.stage)) t.stage = 'ongoing';
        save();
      },
      async updateMatch(mid, p) {
        const m = db.matches.find(x => x.id === mid); needManage(T(m.tournament_id));
        for (const k of ['team_a', 'team_b', 'scheduled_at', 'best_of']) if (k in p) m[k] = p[k] === '' ? null : p[k];
        if (p.status && !m.winner_id) m.status = p.status;
        m.best_of = Number(m.best_of); save();
      },
      async reportResult(mid, a, b) {
        const m = db.matches.find(x => x.id === mid); needManage(T(m.tournament_id));
        (m.team_a && m.team_b) || fail('В матче ещё нет обеих команд');
        (a >= 0 && b >= 0 && a !== b) || fail('Укажите счёт без ничьей');
        const w = a > b ? m.team_a : m.team_b;
        if (m.winner_id && m.winner_id !== w) clearForward(m, m.winner_id);
        Object.assign(m, { score_a: a, score_b: b, winner_id: w, status: 'finished' }); advance(m); save();
      },
      async resetResult(mid) {
        const m = db.matches.find(x => x.id === mid); const t = T(m.tournament_id); needManage(t);
        clearForward(m, m.winner_id);
        Object.assign(m, { score_a: null, score_b: null, winner_id: null, status: 'pending', is_bye: false });
        if (t.stage === 'finished') t.stage = 'ongoing'; save();
      },
      async vetoAction(mid, map) {
        const u = needMe(), m = db.matches.find(x => x.id === mid), t = T(m.tournament_id);
        (m.team_a && m.team_b) || fail('В матче ещё нет обеих команд');
        m.status !== 'finished' || fail('Матч уже сыгран');
        const seq = vetoSequence(m.best_of, t.map_pool.length), step = m.veto.log.length;
        step < seq.length || fail('Пики и баны уже завершены');
        const side = step % 2 === 0 ? 'A' : 'B';
        db.teams.find(x => x.id === (side === 'A' ? m.team_a : m.team_b)).captain_id === u.id || fail('Сейчас ход капитана другой команды');
        const used = m.veto.log.map(l => l.map);
        (t.map_pool.includes(map) && !used.includes(map)) || fail('Эта карта недоступна');
        m.veto.log.push({ side, action: seq[step], map, at: new Date().toISOString() });
        if (step + 1 === seq.length) m.veto.decider = t.map_pool.find(x => ![...used, map].includes(x));
        save(); return m.veto;
      },
      async resetVeto(mid) { const m = db.matches.find(x => x.id === mid); needManage(T(m.tournament_id)); m.veto = { log: [] }; save(); },
      async addAnnouncement(tid, body) { const t = T(tid); needManage(t); db.announcements.push({ id: uid(), tournament_id: tid, author_id: me().id, body: body.trim(), created_at: new Date().toISOString() }); save(); },
      async deleteAnnouncement(id) { const a = db.announcements.find(x => x.id === id); needManage(T(a.tournament_id)); db.announcements = db.announcements.filter(x => x.id !== id); save(); },

      async getProfile(steamId) {
        const p = db.profiles.find(x => x.steam_id === steamId); if (!p) return null;
        const teams = db.members.filter(m => m.user_id === p.id).map(m => {
          const tm = db.teams.find(x => x.id === m.team_id), t = db.tournaments.find(x => x.id === m.tournament_id);
          return { role: m.role, team: tm, tournament: t && visible(t) ? t : null };
        }).filter(x => x.tournament);
        return delay({ profile: p, teams, organized: db.tournaments.filter(t => t.organizer_id === p.id && visible(t)).map(card) });
      },
      async myContacts() { const m = me(); return m ? (db.contacts[m.id] || {}) : {}; },
      async updateProfile(p) {
        const m = needMe();
        for (const k of ['faceit_url', 'faceit_level', 'premier_rating', 'bio']) if (k in p) m[k] = p[k] === '' ? null : p[k];
        db.contacts[m.id] = { ...(db.contacts[m.id] || {}), discord: p.discord || null, telegram: p.telegram || null };
        save();
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
      const now = Date.now(), day = 864e5, iso = ms => new Date(ms).toISOString();
      const nicks = ['Rush3r', 'kvant', 'SaNeK', 'b1ade', 'Mor1arty', 'fl1ckz', 'ZeRo_', 'Hellraiser', 'nek0', 'Krypto', 'vortex', 'Snapy', 'Tr1ckster', 'Gh0st', 'Ra1den', 'Bulat', 'm0nesy_fan', 'Arch1e', 'D1ma', 'KOT', 'shadoW', 'xantares_ru', 'Lynx', 'f0rest_fan', 'Jinx', 'Pulse', 'Wolfie', 'aZ1z', 'Nomad', 'Vint',
        'Sk1f', 'Bober', 'Frosty', 'Hydra', 'Rocket', 'k1nG', 'TaToo', 'Zver', 'Echo', 'Blaze', 'Oxide', 'Rapid', 'Venom', 'S1ren', 'Q-Ball', 'Tesla', 'Grom', 'Yeti'];
      const colors = ['e8554e', '4ea4dc', 'f2a900', '3fbf74', 'b26ee8', 'e8854e', '4ee0c8', 'e84e9b'];
      const profiles = [{ id: 'me', steam_id: '76561198000000000', nickname: 'Вы (демо)', avatar_url: null, profile_url: 'https://steamcommunity.com/', country: 'RU', faceit_level: 8, premier_rating: 17400, faceit_url: null, bio: 'Демо-аккаунт: у него права администратора, чтобы показать все функции.', is_admin: true, is_banned: false, created_at: iso(now - 30 * day) }];
      nicks.forEach((n, i) => profiles.push({ id: 'p' + i, steam_id: '765611980' + String(10000000 + i * 7919).padStart(8, '0'), nickname: n, avatar_url: null, profile_url: 'https://steamcommunity.com/', country: 'RU', faceit_level: 1 + (i * 7) % 10, premier_rating: 8000 + (i * 1373) % 17000, faceit_url: null, bio: null, is_admin: false, is_banned: false, created_at: iso(now - (60 - i) * day) }));
      const d = { v: 1, session: null, profiles, tournaments: [], teams: [], members: [], matches: [], announcements: [], contacts: { me: { discord: 'demo_player', telegram: '@demo' } } };
      let pi = 0, ti = 0;
      const nextP = () => profiles[1 + (pi++ % nicks.length)].id;
      const mkT = (o) => { const t = { id: 't' + (++ti), description: '', rules: '', prize: null, entry_fee: 'Бесплатно', region: 'RU / СНГ', banner_url: null, contact_url: 'https://t.me/', map_pool: MAP_POOL.slice(0, 7), bo_default: 1, bo_semifinal: 3, bo_final: 3, team_size: 5, max_subs: 1, mode: '5v5', status: 'published', stage: 'registration', created_at: iso(now - 10 * day), organizer_id: 'p0', reg_closes_at: null, ...o }; d.tournaments.push(t); return t; };
      const mkTeam = (t, name, tag, size, captain) => {
        const tm = { id: 'tm' + d.teams.length, tournament_id: t.id, name, tag, logo_url: null, captain_id: captain || nextP(), is_open: d.teams.length % 3 !== 0, seed: null, created_at: iso(now - (20 - d.teams.length % 20) * 36e5), join_code: 'DEMO' + (1000 + d.teams.length) };
        d.teams.push(tm);
        d.members.push({ team_id: tm.id, tournament_id: t.id, user_id: tm.captain_id, role: 'captain', joined_at: tm.created_at });
        for (let i = 1; i < size; i++) d.members.push({ team_id: tm.id, tournament_id: t.id, user_id: nextP(), role: i < t.team_size ? 'player' : 'sub', joined_at: iso(new Date(tm.created_at).getTime() + i * 6e4) });
        return tm;
      };
      const RULES = '1. Матчи играются на серверах организатора, античит обязателен.\n2. Опоздание более 15 минут — техническое поражение.\n3. Пики и баны проходят на сайте до начала матча.\n4. Споры решает главный судья, его решение окончательное.';
      const TEAMS = [['Северные Волки', 'NWV'], ['Red Fox', 'RFX'], ['Iron Squad', 'IRN'], ['Ночной Дозор', 'NDZ'], ['Pixel Gang', 'PXL'], ['Сибирь', 'SIB'], ['Mad Hatters', 'MAD'], ['Кибер Барсы', 'KBR'], ['Echo Five', 'EC5'], ['Тайга', 'TGA'], ['Volt', 'VLT'], ['Гроза', 'GRZ']];

      const t1 = mkT({ title: 'Organizm Winter Cup', starts_at: iso(now + 9 * day), reg_closes_at: iso(now + 8 * day), prize: '30 000 ₽', max_teams: 16, banner_url: null,
        description: 'Главный зимний турнир сообщества. Олимпийская система, финал — Bo3 с трансляцией и комментаторами.', rules: RULES, bo_semifinal: 3, bo_final: 3 });
      for (let i = 0; i < 9; i++) mkTeam(t1, TEAMS[i][0], TEAMS[i][1], 5 + (i % 2));

      const t2 = mkT({ title: 'Night Clash #12', starts_at: iso(now - 2 * 36e5), stage: 'ongoing', prize: '10 000 ₽', max_teams: 8, description: 'Вечерний кубок за один вечер: восемь команд, четвертьфиналы в Bo1, плей-офф в Bo3.', rules: RULES });
      const t2teams = TEAMS.slice(0, 8).map((x, i) => mkTeam(t2, x[0], x[1], 5, i === 0 ? 'me' : null));
      const seeds8 = seedOrder(8);
      for (let r = 1; r <= 3; r++) for (let p = 1; p <= 8 / 2 ** r; p++) {
        d.matches.push({ id: `m2_${r}_${p}`, tournament_id: t2.id, round: r, position: p, team_a: r === 1 ? t2teams[seeds8[p * 2 - 2] - 1].id : null, team_b: r === 1 ? t2teams[seeds8[p * 2 - 1] - 1].id : null,
          score_a: null, score_b: null, winner_id: null, best_of: r === 1 ? 1 : 3, scheduled_at: iso(now - 2 * 36e5 + (r - 1) * 5400e3 + p * 6e5), status: 'pending', is_bye: false, veto: { log: [] } });
      }
      t2teams.forEach((tm, i) => tm.seed = i + 1);
      const res = [[13, 7], [9, 13], [13, 11], [16, 14]];
      d.matches.filter(m => m.tournament_id === t2.id && m.round === 1).forEach((m, i) => {
        const [a, b] = res[i];
        Object.assign(m, { score_a: a, score_b: b, winner_id: a > b ? m.team_a : m.team_b, status: 'finished', veto: { log: [], decider: ['Mirage', 'Nuke', 'Ancient', 'Inferno'][i] } });
        const nx = d.matches.find(x => x.tournament_id === t2.id && x.round === 2 && x.position === Math.ceil(m.position / 2));
        if (m.position % 2) nx.team_a = m.winner_id; else nx.team_b = m.winner_id;
      });
      const semi = d.matches.find(m => m.id === 'm2_2_1');
      semi.status = 'live';
      semi.veto = { log: [{ side: 'A', action: 'ban', map: 'Train', at: iso(now - 3e5) }, { side: 'B', action: 'ban', map: 'Anubis', at: iso(now - 2e5) }] };
      d.announcements.push({ id: 'a1', tournament_id: t2.id, author_id: 'p0', body: 'Четвертьфиналы сыграны! Полуфиналы стартуют в 21:00, капитаны — проведите пики и баны на сайте.', created_at: iso(now - 36e5) });
      d.announcements.push({ id: 'a2', tournament_id: t2.id, author_id: 'p0', body: 'Сервер для матчей: connect 1.2.3.4:27015, пароль выдаст судья в Discord.', created_at: iso(now - 3 * 36e5) });

      const t3 = mkT({ title: 'Duo Masters', mode: '2v2', team_size: 2, max_subs: 1, starts_at: iso(now + 3 * day), prize: 'Скины на 5 000 ₽', max_teams: 16, map_pool: ['Inferno', 'Nuke', 'Vertigo', 'Overpass', 'Ancient'], bo_default: 1, bo_semifinal: 1, bo_final: 3, description: 'Турнир для пар в режиме «Напарники».', organizer_id: 'p3' });
      for (let i = 0; i < 5; i++) mkTeam(t3, ['Два Ствола', 'Dynamic Duo', 'Братья', 'Tandem', 'Рикошет'][i], null, 2);

      const t4 = mkT({ title: 'Aim Kings 1v1', mode: '1v1', team_size: 1, max_subs: 0, starts_at: iso(now - 6 * day), stage: 'finished', prize: 'Нож из коллекции', max_teams: 8, map_pool: ['Mirage', 'Dust2', 'Inferno', 'Nuke', 'Ancient'], description: 'Дуэли на aim-картах.', organizer_id: 'p7' });
      const solo = [];
      for (let i = 0; i < 8; i++) { const cap = nextP(); solo.push(mkTeam(t4, db_nick(cap), null, 1, cap)); }
      function db_nick(id) { return profiles.find(p => p.id === id).nickname; }
      const s1 = seedOrder(8); let prev = [];
      for (let r = 1; r <= 3; r++) {
        const cur = [];
        for (let p = 1; p <= 8 / 2 ** r; p++) {
          const a = r === 1 ? solo[s1[p * 2 - 2] - 1].id : prev[p * 2 - 2], b = r === 1 ? solo[s1[p * 2 - 1] - 1].id : prev[p * 2 - 1];
          const sa = 16, sb = 6 + ((r * 3 + p * 5) % 9);
          d.matches.push({ id: `m4_${r}_${p}`, tournament_id: t4.id, round: r, position: p, team_a: a, team_b: b, score_a: sa, score_b: sb, winner_id: a, best_of: r === 3 ? 3 : 1, scheduled_at: iso(now - 6 * day + r * 36e5), status: 'finished', is_bye: false, veto: { log: [] } });
          cur.push(a);
        }
        prev = cur;
      }

      mkT({ title: 'Пятничный микс', status: 'pending', starts_at: iso(now + 4 * day), prize: '2 000 ₽', max_teams: 8, organizer_id: 'p5', description: 'Собираем команды из одиночек и играем вечером в пятницу.' });
      const t6 = mkT({ title: 'Кубок новичков', starts_at: iso(now + 14 * day), max_teams: 8, organizer_id: 'me', prize: 'Медали и роли в Discord', description: 'Для игроков до 10 уровня FACEIT.', rules: RULES });
      mkTeam(t6, TEAMS[10][0], TEAMS[10][1], 3); mkTeam(t6, TEAMS[11][0], TEAMS[11][1], 4);
      d.profiles.forEach((p, i) => { if (i > 0) p.avatar_color = colors[i % colors.length]; });
      return d;
    }
  }

  window.OrganizmApi = {
    create(cfg) {
      const forceDemo = new URLSearchParams(location.search).has('demo');
      const ready = cfg && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase && !forceDemo;
      return ready ? supaApi(cfg) : demoApi();
    },
    vetoSequence, MAP_POOL,
  };
})();
