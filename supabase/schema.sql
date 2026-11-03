-- =====================================================================
--  Organizm — схема базы данных для Supabase
--  Выполните целиком в Supabase → SQL Editor → New query → Run.
--  Скрипт можно запускать повторно: он пересоздаёт функции и политики.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Таблицы
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  steam_id       text not null unique,
  nickname       text not null,
  avatar_url     text,
  profile_url    text,
  country        text,
  faceit_url     text,
  faceit_level   int check (faceit_level between 1 and 10),
  premier_rating int check (premier_rating between 0 and 50000),
  bio            text check (char_length(bio) <= 300),
  is_admin       boolean not null default false,
  is_banned      boolean not null default false,
  created_at     timestamptz not null default now(),
  last_login_at  timestamptz
);

-- контакты видны только самому игроку, его сокомандникам, организатору его турнира и админам
create table if not exists public.profile_contacts (
  user_id  uuid primary key references public.profiles(id) on delete cascade,
  discord  text check (char_length(discord) <= 64),
  telegram text check (char_length(telegram) <= 64)
);

create table if not exists public.tournaments (
  id              uuid primary key default gen_random_uuid(),
  title           text not null check (char_length(title) between 3 and 80),
  description     text not null default '' check (char_length(description) <= 4000),
  rules           text not null default '' check (char_length(rules) <= 8000),
  organizer_id    uuid not null references public.profiles(id),
  status          text not null default 'pending' check (status in ('pending', 'published', 'rejected')),
  moderation_note text,
  stage           text not null default 'registration' check (stage in ('registration', 'closed', 'ongoing', 'finished', 'cancelled')),
  mode            text not null default '5v5' check (mode in ('5v5', '2v2', '1v1')),
  team_size       int  not null default 5 check (team_size between 1 and 5),
  max_subs        int  not null default 1 check (max_subs between 0 and 3),
  max_teams       int  not null default 16 check (max_teams between 2 and 128),
  starts_at       timestamptz not null,
  reg_closes_at   timestamptz,
  prize           text check (char_length(prize) <= 120),
  entry_fee       text check (char_length(entry_fee) <= 60),
  region          text not null default 'RU / СНГ' check (char_length(region) <= 40),
  banner_url      text,
  contact_url     text,
  map_pool        text[] not null default array['Mirage', 'Inferno', 'Nuke', 'Ancient', 'Anubis', 'Dust2', 'Train'],
  bo_default      int  not null default 1 check (bo_default in (1, 3, 5)),
  bo_semifinal    int  not null default 3 check (bo_semifinal in (1, 3, 5)),
  bo_final        int  not null default 3 check (bo_final in (1, 3, 5)),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  published_at    timestamptz
);
create index if not exists tournaments_status_starts on public.tournaments (status, starts_at);
create index if not exists tournaments_organizer on public.tournaments (organizer_id);

create table if not exists public.teams (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name          text not null check (char_length(name) between 2 and 32),
  tag           text check (char_length(tag) <= 6),
  logo_url      text,
  captain_id    uuid not null references public.profiles(id),
  is_open       boolean not null default true,
  seed          int,
  created_at    timestamptz not null default now()
);
create unique index if not exists teams_unique_name on public.teams (tournament_id, lower(name));

-- код для вступления в закрытую команду: никому не виден напрямую
create table if not exists public.team_secrets (
  team_id   uuid primary key references public.teams(id) on delete cascade,
  join_code text not null
);

create table if not exists public.team_members (
  team_id       uuid not null references public.teams(id) on delete cascade,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  role          text not null default 'player' check (role in ('captain', 'player', 'sub')),
  joined_at     timestamptz not null default now(),
  primary key (team_id, user_id),
  unique (tournament_id, user_id)
);

create table if not exists public.matches (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  round         int not null,
  position      int not null,
  team_a        uuid references public.teams(id) on delete set null,
  team_b        uuid references public.teams(id) on delete set null,
  score_a       int check (score_a >= 0),
  score_b       int check (score_b >= 0),
  winner_id     uuid references public.teams(id) on delete set null,
  best_of       int not null default 1 check (best_of in (1, 3, 5)),
  scheduled_at  timestamptz,
  status        text not null default 'pending' check (status in ('pending', 'live', 'finished')),
  is_bye        boolean not null default false,
  veto          jsonb not null default '{"log": []}'::jsonb,
  updated_at    timestamptz not null default now(),
  unique (tournament_id, round, position)
);

create table if not exists public.announcements (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  author_id     uuid not null references public.profiles(id),
  body          text not null check (char_length(body) between 1 and 2000),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Вспомогательные функции
-- ---------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
$$;

create or replace function public.can_manage(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from tournaments where id = t and organizer_id = auth.uid())
$$;

create or replace function public.t_visible(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from tournaments where id = t and (status = 'published' or organizer_id = auth.uid()))
         or public.is_admin()
$$;

-- текущий пользователь (или ошибка)
create or replace function public._me() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); banned boolean;
begin
  if uid is null then raise exception 'Войдите через Steam' using errcode = '28000'; end if;
  select is_banned into banned from profiles where id = uid;
  if not found then raise exception 'Профиль не найден — войдите через Steam заново'; end if;
  if banned then raise exception 'Аккаунт заблокирован администрацией'; end if;
  return uid;
end $$;

create or replace function public._require_manage(t uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._me();
  if not public.can_manage(t) then raise exception 'Недостаточно прав: это может только организатор турнира'; end if;
end $$;

create or replace function public._new_code() returns text
language sql volatile as $$
  select upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8))
$$;

create or replace function public._clean_url(u text) returns text
language sql immutable as $$
  select case when u is null or btrim(u) = '' then null
              when btrim(u) ~* '^https?://[^\s<>"]+$' then btrim(u)
              else null end
$$;

-- ---------------------------------------------------------------------
-- Профиль
-- ---------------------------------------------------------------------
create or replace function public.update_profile(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._me();
begin
  update profiles set
    faceit_url     = case when p ? 'faceit_url' then public._clean_url(p->>'faceit_url') else faceit_url end,
    faceit_level   = case when p ? 'faceit_level' then nullif(p->>'faceit_level', '')::int else faceit_level end,
    premier_rating = case when p ? 'premier_rating' then nullif(p->>'premier_rating', '')::int else premier_rating end,
    bio            = case when p ? 'bio' then nullif(btrim(p->>'bio'), '') else bio end
  where id = uid;
  insert into profile_contacts (user_id, discord, telegram)
  values (uid, nullif(btrim(p->>'discord'), ''), nullif(btrim(p->>'telegram'), ''))
  on conflict (user_id) do update set
    discord  = case when p ? 'discord' then excluded.discord else profile_contacts.discord end,
    telegram = case when p ? 'telegram' then excluded.telegram else profile_contacts.telegram end;
end $$;

-- ---------------------------------------------------------------------
-- Турниры
-- ---------------------------------------------------------------------
create or replace function public._apply_tournament(t uuid, p jsonb, is_new boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  pool text[];
  has_teams boolean := exists (select 1 from teams where tournament_id = t);
  new_mode text := coalesce(p->>'mode', (select mode from tournaments where id = t));
begin
  if p ? 'map_pool' then
    select array_agg(distinct btrim(x)) into pool from jsonb_array_elements_text(p->'map_pool') x where btrim(x) <> '';
    if coalesce(array_length(pool, 1), 0) not between 5 and 10 then raise exception 'В пуле должно быть от 5 до 10 карт'; end if;
  end if;
  if not is_new and has_teams and p ? 'mode' and p->>'mode' <> (select mode from tournaments where id = t) then
    raise exception 'Формат нельзя менять, когда уже есть команды';
  end if;
  update tournaments set
    title         = coalesce(nullif(btrim(p->>'title'), ''), title),
    description   = case when p ? 'description' then coalesce(p->>'description', '') else description end,
    rules         = case when p ? 'rules' then coalesce(p->>'rules', '') else rules end,
    mode          = new_mode,
    team_size     = case new_mode when '5v5' then 5 when '2v2' then 2 else 1 end,
    max_subs      = case when new_mode = '1v1' then 0 when p ? 'max_subs' then (p->>'max_subs')::int else max_subs end,
    max_teams     = case when p ? 'max_teams' then (p->>'max_teams')::int else max_teams end,
    starts_at     = case when p ? 'starts_at' then (p->>'starts_at')::timestamptz else starts_at end,
    reg_closes_at = case when p ? 'reg_closes_at' then nullif(p->>'reg_closes_at', '')::timestamptz else reg_closes_at end,
    prize         = case when p ? 'prize' then nullif(btrim(p->>'prize'), '') else prize end,
    entry_fee     = case when p ? 'entry_fee' then nullif(btrim(p->>'entry_fee'), '') else entry_fee end,
    region        = case when p ? 'region' then coalesce(nullif(btrim(p->>'region'), ''), region) else region end,
    banner_url    = case when p ? 'banner_url' then public._clean_url(p->>'banner_url') else banner_url end,
    contact_url   = case when p ? 'contact_url' then public._clean_url(p->>'contact_url') else contact_url end,
    map_pool      = coalesce(pool, map_pool),
    bo_default    = case when p ? 'bo_default' then (p->>'bo_default')::int else bo_default end,
    bo_semifinal  = case when p ? 'bo_semifinal' then (p->>'bo_semifinal')::int else bo_semifinal end,
    bo_final      = case when p ? 'bo_final' then (p->>'bo_final')::int else bo_final end,
    updated_at    = now()
  where id = t;
  if (select max_teams < (select count(*) from teams where tournament_id = t) from tournaments where id = t) then
    raise exception 'Команд уже больше, чем новый лимит';
  end if;
end $$;

create or replace function public.create_tournament(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._me(); t uuid; adm boolean := public.is_admin();
begin
  if not adm and (select count(*) from tournaments where organizer_id = uid and status = 'pending') >= 3 then
    raise exception 'У вас уже 3 турнира на модерации — дождитесь проверки';
  end if;
  if p->>'starts_at' is null then raise exception 'Укажите дату начала'; end if;
  insert into tournaments (title, organizer_id, starts_at, status, published_at)
  values (coalesce(nullif(btrim(p->>'title'), ''), 'Без названия'), uid, (p->>'starts_at')::timestamptz,
          case when adm then 'published' else 'pending' end, case when adm then now() end)
  returning id into t;
  perform public._apply_tournament(t, p, true);
  return t;
end $$;

create or replace function public.update_tournament(t uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_manage(t);
  perform public._apply_tournament(t, p, false);
  -- отклонённый турнир после правок снова уходит на проверку
  if not public.is_admin() then
    update tournaments set status = 'pending', moderation_note = null where id = t and status = 'rejected';
  end if;
end $$;

create or replace function public.set_stage(t uuid, new_stage text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_manage(t);
  if new_stage not in ('registration', 'closed', 'ongoing', 'finished', 'cancelled') then raise exception 'Неизвестная стадия'; end if;
  update tournaments set stage = new_stage, updated_at = now() where id = t;
end $$;

create or replace function public.moderate_tournament(t uuid, new_status text, note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._me();
  if not public.is_admin() then raise exception 'Только для администраторов'; end if;
  if new_status not in ('pending', 'published', 'rejected') then raise exception 'Неизвестный статус'; end if;
  update tournaments set status = new_status, moderation_note = nullif(btrim(note), ''),
    published_at = case when new_status = 'published' then coalesce(published_at, now()) else published_at end
  where id = t;
end $$;

create or replace function public.delete_tournament(t uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_manage(t);
  if not public.is_admin() and exists (select 1 from teams where tournament_id = t) then
    raise exception 'В турнире уже есть команды. Отмените турнир (стадия «Отменён») или обратитесь к администратору';
  end if;
  delete from tournaments where id = t;
end $$;

create or replace function public.set_admin(target_steam_id text, value boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._me();
  if not public.is_admin() then raise exception 'Только для администраторов'; end if;
  if not value and (select id from profiles where steam_id = target_steam_id) = auth.uid() then
    raise exception 'Нельзя снять права с самого себя';
  end if;
  update profiles set is_admin = value where steam_id = target_steam_id;
  if not found then raise exception 'Игрок с таким Steam ID ещё не входил на сайт'; end if;
end $$;

create or replace function public.set_banned(target uuid, value boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._me();
  if not public.is_admin() then raise exception 'Только для администраторов'; end if;
  if target = auth.uid() then raise exception 'Нельзя заблокировать самого себя'; end if;
  update profiles set is_banned = value where id = target;
end $$;

-- ---------------------------------------------------------------------
-- Команды
-- ---------------------------------------------------------------------
create or replace function public._require_registration(t uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare r tournaments;
begin
  select * into r from tournaments where id = t;
  if not found then raise exception 'Турнир не найден'; end if;
  if r.status <> 'published' then raise exception 'Турнир ещё не прошёл модерацию'; end if;
  if r.stage <> 'registration' or (r.reg_closes_at is not null and r.reg_closes_at < now()) then
    raise exception 'Регистрация на турнир закрыта';
  end if;
end $$;

create or replace function public.create_team(t uuid, team_name text, team_tag text default null, logo text default null, open boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._me(); tid uuid; code text := public._new_code(); r tournaments;
begin
  perform public._require_registration(t);
  select * into r from tournaments where id = t;
  if exists (select 1 from team_members where tournament_id = t and user_id = uid) then
    raise exception 'Вы уже состоите в команде этого турнира';
  end if;
  if (select count(*) from teams where tournament_id = t) >= r.max_teams then raise exception 'Все места в турнире заняты'; end if;
  if exists (select 1 from teams where tournament_id = t and lower(name) = lower(btrim(team_name))) then
    raise exception 'Команда с таким названием уже есть';
  end if;
  insert into teams (tournament_id, name, tag, logo_url, captain_id, is_open)
  values (t, btrim(team_name), nullif(upper(btrim(team_tag)), ''), public._clean_url(logo), uid, coalesce(open, true) or r.team_size = 1)
  returning id into tid;
  insert into team_secrets (team_id, join_code) values (tid, code);
  insert into team_members (team_id, tournament_id, user_id, role) values (tid, t, uid, 'captain');
  return jsonb_build_object('team_id', tid, 'join_code', code);
end $$;

create or replace function public.join_team(team uuid, code text default null) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._me(); tm teams; r tournaments; cnt int;
begin
  select * into tm from teams where id = team;
  if not found then raise exception 'Команда не найдена'; end if;
  perform public._require_registration(tm.tournament_id);
  select * into r from tournaments where id = tm.tournament_id;
  if exists (select 1 from team_members where tournament_id = tm.tournament_id and user_id = uid) then
    raise exception 'Вы уже состоите в команде этого турнира';
  end if;
  if not tm.is_open and upper(btrim(coalesce(code, ''))) <> (select join_code from team_secrets where team_id = team) then
    raise exception 'Неверный код команды';
  end if;
  select count(*) into cnt from team_members where team_id = team;
  if cnt >= r.team_size + r.max_subs then raise exception 'В команде нет свободных мест'; end if;
  insert into team_members (team_id, tournament_id, user_id, role)
  values (team, tm.tournament_id, uid, case when cnt >= r.team_size then 'sub' else 'player' end);
end $$;

-- вступление по коду, без выбора команды из списка
create or replace function public.join_by_code(t uuid, code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  select s.team_id into tid from team_secrets s join teams tm on tm.id = s.team_id
  where tm.tournament_id = t and s.join_code = upper(btrim(code));
  if tid is null then raise exception 'Команда с таким кодом не найдена'; end if;
  perform public.join_team(tid, code);
  return tid;
end $$;

create or replace function public.get_team_code(team uuid) returns text
language plpgsql security definer set search_path = public as $$
declare tm teams;
begin
  perform public._me();
  select * into tm from teams where id = team;
  if tm.captain_id <> auth.uid() and not public.can_manage(tm.tournament_id) then raise exception 'Код видит только капитан'; end if;
  return (select join_code from team_secrets where team_id = team);
end $$;

create or replace function public.update_team(team uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare tm teams;
begin
  perform public._me();
  select * into tm from teams where id = team;
  if not found then raise exception 'Команда не найдена'; end if;
  if tm.captain_id <> auth.uid() and not public.can_manage(tm.tournament_id) then raise exception 'Менять команду может только капитан'; end if;
  if p ? 'name' and exists (select 1 from teams where tournament_id = tm.tournament_id and lower(name) = lower(btrim(p->>'name')) and id <> team) then
    raise exception 'Команда с таким названием уже есть';
  end if;
  update teams set
    name     = coalesce(nullif(btrim(p->>'name'), ''), name),
    tag      = case when p ? 'tag' then nullif(upper(btrim(p->>'tag')), '') else tag end,
    logo_url = case when p ? 'logo_url' then public._clean_url(p->>'logo_url') else logo_url end,
    is_open  = case when p ? 'is_open' then (p->>'is_open')::boolean else is_open end
  where id = team;
  if coalesce((p->>'new_code')::boolean, false) then update team_secrets set join_code = public._new_code() where team_id = team; end if;
end $$;

create or replace function public._rebalance(team uuid) returns void
language plpgsql security definer set search_path = public as $$
declare sz int; cap uuid;
begin
  select r.team_size, t.captain_id into sz, cap from teams t join tournaments r on r.id = t.tournament_id where t.id = team;
  update team_members m set role = case when m.user_id = cap then 'captain' when x.rn <= sz - 1 then 'player' else 'sub' end
  from (select user_id, row_number() over (order by joined_at) as rn from team_members where team_id = team and user_id <> cap) x
  where m.team_id = team and (m.user_id = x.user_id or m.user_id = cap);
end $$;

create or replace function public.leave_team(team uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._me(); tm teams; heir uuid;
begin
  select * into tm from teams where id = team;
  if not found then raise exception 'Команда не найдена'; end if;
  if (select stage from tournaments where id = tm.tournament_id) not in ('registration', 'closed') then
    raise exception 'Турнир уже идёт — выйти из команды можно только через организатора';
  end if;
  if tm.captain_id = uid then
    select user_id into heir from team_members where team_id = team and user_id <> uid order by joined_at limit 1;
    if heir is null then delete from teams where id = team; return; end if;
    update teams set captain_id = heir where id = team;
    update team_members set role = 'captain' where team_id = team and user_id = heir;
  end if;
  delete from team_members where team_id = team and user_id = uid;
  perform public._rebalance(team);
end $$;

create or replace function public.kick_member(team uuid, member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare tm teams;
begin
  perform public._me();
  select * into tm from teams where id = team;
  if tm.captain_id <> auth.uid() and not public.can_manage(tm.tournament_id) then raise exception 'Исключать игроков может только капитан'; end if;
  if member = tm.captain_id then raise exception 'Капитана нельзя исключить — сначала передайте капитанство'; end if;
  delete from team_members where team_id = team and user_id = member;
  perform public._rebalance(team);
end $$;

create or replace function public.transfer_captain(team uuid, member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare tm teams;
begin
  perform public._me();
  select * into tm from teams where id = team;
  if tm.captain_id <> auth.uid() and not public.can_manage(tm.tournament_id) then raise exception 'Передать капитанство может только капитан'; end if;
  if not exists (select 1 from team_members where team_id = team and user_id = member) then raise exception 'Игрок не в команде'; end if;
  update team_members set role = 'player' where team_id = team and user_id = tm.captain_id;
  update team_members set role = 'captain' where team_id = team and user_id = member;
  update teams set captain_id = member where id = team;
  perform public._rebalance(team);
end $$;

create or replace function public.disband_team(team uuid) returns void
language plpgsql security definer set search_path = public as $$
declare tm teams;
begin
  perform public._me();
  select * into tm from teams where id = team;
  if not found then return; end if;
  if public.can_manage(tm.tournament_id) then delete from teams where id = team; return; end if;
  if tm.captain_id <> auth.uid() then raise exception 'Распустить команду может только капитан'; end if;
  if (select stage from tournaments where id = tm.tournament_id) <> 'registration' then
    raise exception 'Регистрация закрыта — распустить команду может только организатор';
  end if;
  delete from teams where id = team;
end $$;

-- ---------------------------------------------------------------------
-- Сетка и матчи (олимпийская система)
-- ---------------------------------------------------------------------
-- порядок посева, чтобы сильнейшие встречались как можно позже: 1,8,4,5,2,7,3,6 ...
create or replace function public._seed_order(size int) returns int[]
language plpgsql immutable as $$
declare o int[] := array[1, 2]; nxt int[]; s int; len int;
begin
  if size < 2 then return array[1]; end if;
  while array_length(o, 1) < size loop
    len := array_length(o, 1) * 2 + 1;
    nxt := array[]::int[];
    foreach s in array o loop nxt := nxt || s || (len - s); end loop;
    o := nxt;
  end loop;
  return o;
end $$;

create or replace function public._round_bo(r tournaments, rnd int, total int) returns int
language sql immutable as $$
  select case when rnd = total then r.bo_final when rnd = total - 1 then r.bo_semifinal else r.bo_default end
$$;

-- убрать команду из следующих матчей (если результат переигран)
create or replace function public._clear_forward(m matches, team uuid) returns void
language plpgsql security definer set search_path = public as $$
declare nx matches;
begin
  if team is null then return; end if;
  select * into nx from matches where tournament_id = m.tournament_id and round = m.round + 1 and position = (m.position + 1) / 2;
  if not found then return; end if;
  if nx.winner_id is not null and (nx.team_a = team or nx.team_b = team) then perform public._clear_forward(nx, nx.winner_id); end if;
  update matches set
    team_a = case when team_a = team then null else team_a end,
    team_b = case when team_b = team then null else team_b end,
    score_a = null, score_b = null, winner_id = null, status = 'pending', is_bye = false,
    veto = '{"log": []}'::jsonb, updated_at = now()
  where id = nx.id and (team_a = team or team_b = team);
end $$;

-- провести победителя в следующий раунд
create or replace function public._advance(mid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m matches; nx matches;
begin
  select * into m from matches where id = mid;
  if m.winner_id is null then return; end if;
  select * into nx from matches where tournament_id = m.tournament_id and round = m.round + 1 and position = (m.position + 1) / 2;
  if not found then
    update tournaments set stage = 'finished', updated_at = now() where id = m.tournament_id;
    return;
  end if;
  if m.position % 2 = 1 then update matches set team_a = m.winner_id, updated_at = now() where id = nx.id;
  else update matches set team_b = m.winner_id, updated_at = now() where id = nx.id; end if;
end $$;

-- автопроход, если соперника нет (bye)
create or replace function public._resolve_byes(t uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m matches; changed boolean := true;
begin
  while changed loop
    changed := false;
    for m in select * from matches where tournament_id = t and round = 1 and status = 'pending'
             and ((team_a is null) <> (team_b is null)) loop
      update matches set winner_id = coalesce(team_a, team_b), status = 'finished', is_bye = true, updated_at = now() where id = m.id;
      perform public._advance(m.id);
      changed := true;
    end loop;
  end loop;
end $$;

-- seeds: id команд по порядку посева (null — порядок регистрации), shuffle — случайный посев
create or replace function public.generate_bracket(t uuid, seeds uuid[] default null, shuffle boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  r tournaments; ids uuid[]; n int; size int := 2; rounds int := 1; ord int[];
  rnd int; pos int; cnt int; a int; b int;
begin
  perform public._require_manage(t);
  select * into r from tournaments where id = t;
  if seeds is not null and array_length(seeds, 1) > 0 then
    select array_agg(s order by i) into ids from unnest(seeds) with ordinality u(s, i)
    where exists (select 1 from teams where id = s and tournament_id = t);
    ids := coalesce(ids, array[]::uuid[]) || coalesce((select array_agg(id order by created_at) from teams
           where tournament_id = t and not (id = any (coalesce(ids, array[]::uuid[])))), array[]::uuid[]);
  elsif shuffle then
    select array_agg(id order by random()) into ids from teams where tournament_id = t;
  else
    select array_agg(id order by created_at) into ids from teams where tournament_id = t;
  end if;
  n := coalesce(array_length(ids, 1), 0);
  if n < 2 then raise exception 'Для сетки нужно минимум 2 команды'; end if;
  while size < n loop size := size * 2; rounds := rounds + 1; end loop;
  ord := public._seed_order(size);

  delete from matches where tournament_id = t;
  update teams set seed = null where tournament_id = t;
  for i in 1..n loop update teams set seed = i where id = ids[i]; end loop;

  for rnd in 1..rounds loop
    cnt := size / (2 ^ rnd)::int;
    for pos in 1..cnt loop
      if rnd = 1 then
        a := ord[pos * 2 - 1]; b := ord[pos * 2];
        insert into matches (tournament_id, round, position, team_a, team_b, best_of)
        values (t, 1, pos, case when a <= n then ids[a] end, case when b <= n then ids[b] end, public._round_bo(r, 1, rounds));
      else
        insert into matches (tournament_id, round, position, best_of) values (t, rnd, pos, public._round_bo(r, rnd, rounds));
      end if;
    end loop;
  end loop;
  perform public._resolve_byes(t);
  update tournaments set stage = 'ongoing', updated_at = now() where id = t and stage in ('registration', 'closed');
end $$;

create or replace function public.update_match(mid uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare m matches;
begin
  select * into m from matches where id = mid;
  if not found then raise exception 'Матч не найден'; end if;
  perform public._require_manage(m.tournament_id);
  if (p ? 'team_a' and nullif(p->>'team_a', '') is not null and not exists (select 1 from teams where id = (p->>'team_a')::uuid and tournament_id = m.tournament_id))
     or (p ? 'team_b' and nullif(p->>'team_b', '') is not null and not exists (select 1 from teams where id = (p->>'team_b')::uuid and tournament_id = m.tournament_id)) then
    raise exception 'Команда не из этого турнира';
  end if;
  update matches set
    team_a       = case when p ? 'team_a' then nullif(p->>'team_a', '')::uuid else team_a end,
    team_b       = case when p ? 'team_b' then nullif(p->>'team_b', '')::uuid else team_b end,
    scheduled_at = case when p ? 'scheduled_at' then nullif(p->>'scheduled_at', '')::timestamptz else scheduled_at end,
    best_of      = case when p ? 'best_of' then (p->>'best_of')::int else best_of end,
    status       = case when p ? 'status' and p->>'status' in ('pending', 'live') and winner_id is null then p->>'status' else status end,
    updated_at   = now()
  where id = mid;
end $$;

create or replace function public.report_result(mid uuid, sa int, sb int) returns void
language plpgsql security definer set search_path = public as $$
declare m matches; w uuid;
begin
  select * into m from matches where id = mid;
  if not found then raise exception 'Матч не найден'; end if;
  perform public._require_manage(m.tournament_id);
  if m.team_a is null or m.team_b is null then raise exception 'В матче ещё нет обеих команд'; end if;
  if sa is null or sb is null or sa < 0 or sb < 0 or sa = sb then raise exception 'Укажите счёт без ничьей'; end if;
  w := case when sa > sb then m.team_a else m.team_b end;
  if m.winner_id is not null and m.winner_id <> w then perform public._clear_forward(m, m.winner_id); end if;
  update matches set score_a = sa, score_b = sb, winner_id = w, status = 'finished', updated_at = now() where id = mid;
  perform public._advance(mid);
end $$;

create or replace function public.reset_result(mid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m matches;
begin
  select * into m from matches where id = mid;
  if not found then raise exception 'Матч не найден'; end if;
  perform public._require_manage(m.tournament_id);
  perform public._clear_forward(m, m.winner_id);
  update matches set score_a = null, score_b = null, winner_id = null, status = 'pending', is_bye = false, updated_at = now() where id = mid;
  update tournaments set stage = 'ongoing' where id = m.tournament_id and stage = 'finished';
end $$;

-- ---------------------------------------------------------------------
-- Пики и баны
-- ---------------------------------------------------------------------
-- последовательность действий для пула из p карт: ban/pick, ход команд A,B по очереди
create or replace function public.veto_sequence(bo int, pool_size int) returns text[]
language plpgsql immutable as $$
declare s text[] := array[]::text[]; bans int;
begin
  if bo = 1 then
    for i in 1..pool_size - 1 loop s := s || 'ban'::text; end loop;
  elsif bo = 3 then
    bans := pool_size - 3;
    s := array_fill('ban'::text, array[least(2, bans)]) || array['pick', 'pick'] || array_fill('ban'::text, array[greatest(bans - 2, 0)]);
  else
    bans := pool_size - 5;
    s := array_fill('ban'::text, array[greatest(bans, 0)]) || array['pick', 'pick', 'pick', 'pick'];
  end if;
  return s;
end $$;

create or replace function public.veto_action(mid uuid, map_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._me(); m matches; r tournaments; seq text[]; step int; side text; team uuid;
  used text[]; remaining text[]; v jsonb;
begin
  select * into m from matches where id = mid for update;
  if not found then raise exception 'Матч не найден'; end if;
  select * into r from tournaments where id = m.tournament_id;
  if m.team_a is null or m.team_b is null then raise exception 'В матче ещё нет обеих команд'; end if;
  if m.status = 'finished' then raise exception 'Матч уже сыгран'; end if;
  seq := public.veto_sequence(m.best_of, array_length(r.map_pool, 1));
  step := jsonb_array_length(m.veto->'log');
  if step >= array_length(seq, 1) then raise exception 'Пики и баны уже завершены'; end if;
  side := case when step % 2 = 0 then 'A' else 'B' end;
  team := case when side = 'A' then m.team_a else m.team_b end;
  if (select captain_id from teams where id = team) <> uid then
    raise exception 'Сейчас ход капитана другой команды';
  end if;
  select coalesce(array_agg(x->>'map'), array[]::text[]) into used from jsonb_array_elements(m.veto->'log') x;
  if not (map_name = any (r.map_pool)) or map_name = any (used) then raise exception 'Эта карта недоступна'; end if;

  v := jsonb_set(m.veto, '{log}', (m.veto->'log') || jsonb_build_object('side', side, 'action', seq[step + 1], 'map', map_name, 'at', now()));
  if step + 1 = array_length(seq, 1) then
    select array_agg(x) into remaining from unnest(r.map_pool) x where not (x = any (used || map_name));
    v := v || jsonb_build_object('decider', remaining[1]);
  end if;
  update matches set veto = v, updated_at = now() where id = mid;
  return v;
end $$;

create or replace function public.reset_veto(mid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  select tournament_id into t from matches where id = mid;
  perform public._require_manage(t);
  update matches set veto = '{"log": []}'::jsonb, updated_at = now() where id = mid;
end $$;

-- ---------------------------------------------------------------------
-- Анонсы
-- ---------------------------------------------------------------------
create or replace function public.add_announcement(t uuid, text_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare aid uuid;
begin
  perform public._require_manage(t);
  insert into announcements (tournament_id, author_id, body) values (t, auth.uid(), btrim(text_body)) returning id into aid;
  return aid;
end $$;

create or replace function public.delete_announcement(aid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  select tournament_id into t from announcements where id = aid;
  perform public._require_manage(t);
  delete from announcements where id = aid;
end $$;

-- ---------------------------------------------------------------------
-- Каталог: карточки турниров с числом команд и организатором
-- ---------------------------------------------------------------------
create or replace view public.tournament_cards with (security_invoker = true) as
select t.*,
       p.nickname   as organizer_nickname,
       p.avatar_url as organizer_avatar,
       p.steam_id   as organizer_steam_id,
       (select count(*) from public.teams x where x.tournament_id = t.id)::int as teams_count
from public.tournaments t
join public.profiles p on p.id = t.organizer_id;

-- ---------------------------------------------------------------------
-- Права доступа (RLS): читать можно опубликованное, писать — только через функции выше
-- ---------------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.profile_contacts enable row level security;
alter table public.tournaments      enable row level security;
alter table public.teams            enable row level security;
alter table public.team_secrets     enable row level security;
alter table public.team_members     enable row level security;
alter table public.matches          enable row level security;
alter table public.announcements    enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (true);

drop policy if exists contacts_read on public.profile_contacts;
create policy contacts_read on public.profile_contacts for select using (
  user_id = auth.uid() or public.is_admin()
  or exists (select 1 from public.team_members a join public.team_members b on a.team_id = b.team_id
             where a.user_id = auth.uid() and b.user_id = profile_contacts.user_id)
  or exists (select 1 from public.team_members m join public.tournaments t on t.id = m.tournament_id
             where m.user_id = profile_contacts.user_id and t.organizer_id = auth.uid())
);

drop policy if exists tournaments_read on public.tournaments;
create policy tournaments_read on public.tournaments for select using (
  status = 'published' or organizer_id = auth.uid() or public.is_admin()
);

drop policy if exists teams_read on public.teams;
create policy teams_read on public.teams for select using (public.t_visible(tournament_id));
drop policy if exists members_read on public.team_members;
create policy members_read on public.team_members for select using (public.t_visible(tournament_id));
drop policy if exists matches_read on public.matches;
create policy matches_read on public.matches for select using (public.t_visible(tournament_id));
drop policy if exists announcements_read on public.announcements;
create policy announcements_read on public.announcements for select using (public.t_visible(tournament_id));
-- team_secrets: политик нет — читать напрямую нельзя никому

-- запись в таблицы напрямую запрещена: только select
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
grant select on public.profiles, public.profile_contacts, public.tournaments, public.teams, public.team_members,
                public.matches, public.announcements, public.tournament_cards to anon, authenticated;
revoke all on public.team_secrets from anon, authenticated;

-- функции: вызывать могут только вошедшие пользователи, служебные (с подчёркиванием) — никто
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f'
             and p.proname in ('is_admin','can_manage','t_visible','_me','_require_manage','_new_code','_clean_url','update_profile',
               '_apply_tournament','create_tournament','update_tournament','set_stage','moderate_tournament','delete_tournament',
               'set_admin','set_banned','_require_registration','create_team','join_team','join_by_code','get_team_code','update_team',
               '_rebalance','leave_team','kick_member','transfer_captain','disband_team','_seed_order','_round_bo','_clear_forward','_advance',
               '_resolve_byes','generate_bracket','update_match','report_result','reset_result','veto_sequence','veto_action',
               'reset_veto','add_announcement','delete_announcement') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if left(f.proname, 1) <> '_' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
-- проверки прав используются политиками чтения — они должны работать и для гостей
grant execute on function public.is_admin(), public.can_manage(uuid), public.t_visible(uuid), public.veto_sequence(int, int) to anon, authenticated;

-- чистые функции не зависят от схемы поиска
alter function public._clean_url(text) set search_path = '';
alter function public._new_code() set search_path = '';
alter function public._round_bo(public.tournaments, int, int) set search_path = '';
alter function public._seed_order(int) set search_path = '';
alter function public.veto_sequence(int, int) set search_path = '';

-- ---------------------------------------------------------------------
-- Обновления в реальном времени (пики/баны, счёт, составы)
-- ---------------------------------------------------------------------
do $$
declare tbl text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach tbl in array array['matches', 'teams', 'team_members', 'announcements', 'tournaments'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl) then
        execute format('alter publication supabase_realtime add table public.%I', tbl);
      end if;
    end loop;
  end if;
end $$;
