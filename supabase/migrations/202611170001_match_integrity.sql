-- Исправления матчей: выполнить в Supabase SQL Editor после обновления сайта.
-- Не удаляет турниры, команды или результаты.
begin;

create or replace function public.generate_bracket(t uuid, seeds uuid[] default null, shuffle boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare r tournaments; ids uuid[]; pool uuid[]; n int;
begin
  perform public._require_manage(t);
  select * into r from tournaments where id = t for update;
  -- участвуют все команды, а при включённом чек-ине — только подтвердившие участие
  select array_agg(id order by created_at) into pool from teams
  where tournament_id = t and (r.checkin_minutes is null or checked_in_at is not null);
  pool := coalesce(pool, array[]::uuid[]);
  if seeds is not null and array_length(seeds, 1) > 0 then
    select array_agg(s order by i) into ids from unnest(seeds) with ordinality u(s, i) where s = any (pool);
    ids := coalesce(ids, array[]::uuid[]);
    ids := ids || coalesce((select array_agg(x order by o) from unnest(pool) with ordinality p(x, o) where not (x = any (ids))), array[]::uuid[]);
  elsif shuffle then
    select array_agg(x order by random()) into ids from unnest(pool) x;
  else
    ids := pool;
  end if;
  n := coalesce(array_length(ids, 1), 0);
  if n < 2 then
    raise exception '%', case when r.checkin_minutes is not null then 'Для сетки нужно минимум 2 команды, прошедшие чек-ин'
                              else 'Для сетки нужно минимум 2 команды' end;
  end if;
  if r.format = 'groups' and n < 3 then raise exception 'Для группового этапа нужно минимум 3 команды'; end if;

  delete from matches where tournament_id = t;
  update teams set seed = null where tournament_id = t;
  for i in 1..n loop update teams set seed = i where id = ids[i]; end loop;

  if r.format = 'groups' then
    perform public._build_groups(t, ids);
  else
    perform public._build_elim(t, ids, r.format = 'double');
    perform public._resolve(t);
  end if;
  update tournaments set stage = 'ongoing', updated_at = now() where id = t and stage in ('registration', 'closed');
end $$;

create or replace function public.generate_playoff(t uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r tournaments; ids uuid[];
begin
  perform public._require_manage(t);
  select * into r from tournaments where id = t for update;
  if r.format <> 'groups' then raise exception 'Плей-офф из групп есть только в формате «Группы + плей-офф»'; end if;
  if not exists (select 1 from matches where tournament_id = t and bracket = 'group') then raise exception 'Сначала сформируйте группы'; end if;
  if exists (select 1 from matches where tournament_id = t and bracket = 'group' and status <> 'finished') then
    raise exception 'Ещё не все матчи групп сыграны';
  end if;
  select array_agg(team_id order by place, group_no) into ids from public.group_standings(t) where place <= r.group_advance;
  if coalesce(array_length(ids, 1), 0) < 2 then raise exception 'В плей-офф выходит меньше двух команд'; end if;
  delete from matches where tournament_id = t and bracket <> 'group';
  perform public._build_elim(t, ids, false);
  perform public._resolve(t);
  update tournaments set stage = 'ongoing', updated_at = now() where id = t;
end $$;

create or replace function public._require_group_result_edit(m public.matches) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if m.bracket = 'group' and exists (
    select 1 from matches where tournament_id = m.tournament_id and bracket <> 'group'
  ) then
    raise exception 'Плей-офф уже создан — результаты и участников групп менять нельзя';
  end if;
end $$;

create or replace function public.update_match(mid uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare m matches;
begin
  select * into m from matches where id = mid;
  if not found then raise exception 'Матч не найден'; end if;
  perform public._require_manage(m.tournament_id);
  -- Один порядок блокировок с генерацией плей-офф и записью результатов.
  perform 1 from tournaments where id = m.tournament_id for update;
  select * into m from matches where id = mid for update;
  if not found then raise exception 'Матч не найден'; end if;
  if (p ? 'team_a' and nullif(p->>'team_a', '')::uuid is distinct from m.team_a)
     or (p ? 'team_b' and nullif(p->>'team_b', '')::uuid is distinct from m.team_b) then
    perform public._require_group_result_edit(m);
    if m.status = 'finished' or m.winner_id is not null then
      raise exception 'Перед заменой команд сбросьте результат матча';
    end if;
  end if;
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
  perform 1 from tournaments where id = m.tournament_id for update;
  select * into m from matches where id = mid for update;
  if not found then raise exception 'Матч не найден'; end if;
  perform public._require_group_result_edit(m);
  if m.team_a is null or m.team_b is null then raise exception 'В матче ещё нет обеих команд'; end if;
  if sa is null or sb is null or sa < 0 or sb < 0 or sa = sb then raise exception 'Укажите счёт без ничьей'; end if;
  w := case when sa > sb then m.team_a else m.team_b end;
  -- победитель сменился: убрать прежнего из следующих матчей (и проигравшего из нижней сетки)
  if m.winner_id is not null and m.winner_id <> w then perform public._unwind(mid); end if;
  update matches set score_a = sa, score_b = sb, winner_id = w, status = 'finished', is_bye = false, updated_at = now() where id = mid;
  if m.winner_id is distinct from w then perform public._advance(mid); end if;
  perform public._resolve(m.tournament_id);
end $$;

create or replace function public.reset_result(mid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m matches;
begin
  select * into m from matches where id = mid;
  if not found then raise exception 'Матч не найден'; end if;
  perform public._require_manage(m.tournament_id);
  perform 1 from tournaments where id = m.tournament_id for update;
  select * into m from matches where id = mid for update;
  if not found then raise exception 'Матч не найден'; end if;
  perform public._require_group_result_edit(m);
  if m.is_bye then raise exception 'Проход без игры нельзя сбросить — пересоздайте сетку'; end if;
  perform public._unwind(mid);
  update matches set score_a = null, score_b = null, winner_id = null, status = 'pending', updated_at = now() where id = mid;
end $$;

create or replace function public.veto_sequence(bo int, pool_size int) returns text[]
language plpgsql immutable as $$
declare s text[] := array[]::text[]; bans int;
begin
  if coalesce(pool_size, 0) < 2 then return s; end if;
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

revoke all on function public._require_group_result_edit(public.matches) from public, anon, authenticated;
alter function public.veto_sequence(int, int) set search_path = '';
commit;
