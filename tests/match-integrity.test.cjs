const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const root = path.join(__dirname, '..');
const apiSource = fs.readFileSync(path.join(root, 'assets/api.js'), 'utf8');

function demo(format = 'single', count = 4) {
  let saved = JSON.stringify({
    v: 3, session: 'me', profiles: [{ id: 'me', is_admin: true }],
    tournaments: [{ id: 't', organizer_id: 'me', status: 'published', stage: 'registration', format,
      checkin_minutes: null, bo_default: 1, bo_semifinal: 3, bo_final: 3, group_count: 2, group_advance: 1 }],
    teams: Array.from({ length: count }, (_, i) => ({ id: `T${i + 1}`, tournament_id: 't', name: `Team ${i + 1}`, created_at: String(i) })),
    members: [], matches: [], announcements: [], agents: [], invites: [], contacts: {},
  });
  const context = vm.createContext({ window: {}, location: { search: '?demo' }, URLSearchParams, setTimeout,
    localStorage: { getItem: () => saved, setItem: (_k, value) => { saved = value; } } });
  vm.runInContext(apiSource, context);
  return { api: context.window.OrganizmApi.create({}), helpers: context.window.OrganizmApi, read: () => JSON.parse(saved) };
}

test('no-veto matches open for Bo1, Bo3 and Bo5 with zero or one map', () => {
  const { helpers } = demo();
  const source = fs.readFileSync(path.join(root, 'assets/app.js'), 'utf8');
  const openMatch = source.slice(source.indexOf('  function openMatch(mid) {'), source.indexOf('  // ---------- вкладка «Анонсы»'));
  for (const best_of of [1, 3, 5]) for (const map_pool of [[], ['aim_map']]) {
    assert.equal(helpers.vetoSequence(best_of, map_pool.length).length, 0);
    let rendered = '';
    const m = { id: 'm', team_a: 'A', team_b: 'B', best_of, status: 'pending', veto: { log: [] } };
    const context = vm.createContext({
      ctx: () => ({ t: { map_pool }, matches: [m], teamById: { A: { name: 'A' }, B: { name: 'B' } }, canManage: false }),
      noVeto: t => t.map_pool.length < 5,
      window: { OrganizmApi: { vetoSequence() { throw new Error('Veto must be skipped'); } } },
      esc: String, mapBg: () => '', teamLogo: () => '', matchName: () => 'Match',
      modal: (_title, html) => { rendered = html; return { dataset: {} }; }, $$: () => [],
    });
    vm.runInContext(openMatch + '\nopenMatch("m");', context);
    assert.match(rendered, /без пиков и банов|Без пиков и банов/);
    if (map_pool.length) assert.match(rendered, /aim_map/);
  }
  assert.equal(helpers.vetoSequence(1, 7).length, 6);
  assert.equal(helpers.vetoSequence(3, 7).filter(x => x === 'pick').length, 2);
});

test('demo protects played matches but permits metadata edits and changes after reset', async () => {
  const { api, read } = demo();
  await api.generateBracket('t');
  const m = read().matches.find(x => x.round === 1);
  await api.reportResult(m.id, 13, 5);
  const before = read();
  const replacement = before.teams.find(x => x.id !== m.team_a && x.id !== m.team_b).id;
  await assert.rejects(api.updateMatch(m.id, { team_a: replacement }), /сбросьте результат/);
  assert.deepEqual(read(), before);
  await api.updateMatch(m.id, { team_a: m.team_a, team_b: m.team_b, best_of: 3 });
  await api.resetResult(m.id);
  assert.equal(read().matches.find(x => x.id === m.next_match_id)[m.next_slot === 'a' ? 'team_a' : 'team_b'], null);
  await api.updateMatch(m.id, { team_a: replacement });
  assert.equal(read().matches.find(x => x.id === m.id).team_a, replacement);
});

test('demo permits group corrections before playoffs and freezes them afterwards', async () => {
  const { api, read } = demo('groups', 6);
  await api.generateBracket('t');
  for (const m of read().matches) await api.reportResult(m.id, 13, 5);
  const m = read().matches[0];
  await api.reportResult(m.id, 5, 13);
  await api.resetResult(m.id);
  await api.reportResult(m.id, 13, 5);
  await api.generatePlayoff('t');
  const before = read();
  await assert.rejects(api.reportResult(m.id, 5, 13), /Плей-офф уже создан/);
  await assert.rejects(api.resetResult(m.id), /Плей-офф уже создан/);
  await assert.rejects(api.updateMatch(m.id, { team_a: 'T6' }), /Плей-офф уже создан/);
  assert.deepEqual(read(), before);
  await api.updateMatch(m.id, { scheduled_at: '2026-12-01T12:00:00Z' });
  const final = read().matches.find(x => x.bracket === 'upper');
  await api.reportResult(final.id, 2, 1);
});

test('PostgreSQL schema and upgrade migration enforce the same rules', async t => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
    await db.exec(fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8'));
    const migration = fs.readFileSync(path.join(root, 'supabase/migrations/202611170001_match_integrity.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    const user = '00000000-0000-0000-0000-000000000001';
    await db.query('insert into auth.users values ($1)', [user]);
    await db.query("insert into profiles(id,steam_id,nickname,is_admin) values ($1,'76561198000000000','Tester',true)", [user]);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
    async function tournament(format, count) {
      const { rows: [tour] } = await db.query(`insert into tournaments(title,organizer_id,starts_at,status,format,group_count,group_advance)
        values ('Test tournament',$1,now(),'published',$2,2,1) returning id`, [user, format]);
      for (let i = 0; i < count; i++) await db.query('insert into teams(tournament_id,name,captain_id,created_at) values ($1,$2,$3,now()+make_interval(secs => $4))', [tour.id, `Team ${i + 1}`, user, i]);
      await db.query('select generate_bracket($1)', [tour.id]);
      return tour.id;
    }
    await t.test('no-veto sequences remain empty', async () => {
      for (const bo of [1, 3, 5]) for (const size of [0, 1]) {
        const { rows: [r] } = await db.query('select veto_sequence($1,$2) as seq', [bo, size]);
        assert.deepEqual(r.seq, []);
      }
    });
    await t.test('played-match participants require a reset', async () => {
      const id = await tournament('single', 4);
      const { rows: [m] } = await db.query('select * from matches where tournament_id=$1 and round=1 order by position', [id]);
      await db.query('select report_result($1,13,5)', [m.id]);
      const { rows: [other] } = await db.query('select id from teams where tournament_id=$1 and id not in ($2,$3)', [id, m.team_a, m.team_b]);
      await assert.rejects(db.query('select update_match($1,$2)', [m.id, { team_a: other.id }]), /сбросьте результат/);
      await db.query('select update_match($1,$2)', [m.id, { team_a: m.team_a, best_of: 3 }]);
      await db.query('select reset_result($1)', [m.id]);
      const { rows: [next] } = await db.query('select * from matches where id=$1', [m.next_match_id]);
      assert.equal(next[m.next_slot === 'a' ? 'team_a' : 'team_b'], null);
      await db.query('select update_match($1,$2)', [m.id, { team_a: other.id }]);
    });
    await t.test('group results freeze only after playoffs exist', async () => {
      const id = await tournament('groups', 6);
      const { rows: matches } = await db.query('select * from matches where tournament_id=$1', [id]);
      for (const m of matches) await db.query('select report_result($1,13,5)', [m.id]);
      const m = matches[0];
      await db.query('select report_result($1,5,13)', [m.id]);
      await db.query('select reset_result($1)', [m.id]);
      await db.query('select report_result($1,13,5)', [m.id]);
      await db.query('select generate_playoff($1)', [id]);
      const { rows: before } = await db.query('select * from matches where tournament_id=$1 order by id', [id]);
      await assert.rejects(db.query('select report_result($1,5,13)', [m.id]), /Плей-офф уже создан/);
      await assert.rejects(db.query('select reset_result($1)', [m.id]), /Плей-офф уже создан/);
      await assert.rejects(db.query('select update_match($1,$2)', [m.id, { team_a: m.team_b }]), /Плей-офф уже создан/);
      assert.deepEqual((await db.query('select * from matches where tournament_id=$1 order by id', [id])).rows, before);
      const final = before.find(x => x.bracket === 'upper');
      await db.query('select report_result($1,2,1)', [final.id]);
    });
  } finally { await db.close(); }
});
