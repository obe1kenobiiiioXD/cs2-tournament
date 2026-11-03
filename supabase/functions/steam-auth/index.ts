// Вход через Steam (OpenID 2.0) → сессия Supabase.
//
// Секреты функции (Supabase → Edge Functions → Secrets):
//   STEAM_API_KEY       — ключ https://steamcommunity.com/dev/apikey (ник и аватар игрока)
//   STEAM_LOGIN_SECRET  — любая длинная случайная строка (не меняйте после запуска)
//   ALLOWED_ORIGINS     — адреса сайта через запятую, например https://obe1kenobiiiioxd.github.io
//   ADMIN_STEAM_IDS     — SteamID64 администраторов через запятую
//   STEAM_EMAIL_DOMAIN  — необязательно, служебный домен для технических e-mail (по умолчанию steam.local)
// SUPABASE_URL, SUPABASE_ANON_KEY и SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
const env = (k: string) => (Deno.env.get(k) ?? '').trim();
const list = (k: string) => env(k).split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);

function cors(origin: string | null) {
  const allowed = list('ALLOWED_ORIGINS');
  const ok = origin && (allowed.length === 0 || allowed.includes(origin.replace(/\/+$/, '')));
  return {
    'Access-Control-Allow-Origin': ok ? origin! : allowed[0] ?? '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
}

async function hmacHex(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Проверяет ответ Steam и возвращает SteamID64 */
async function verifySteam(params: Record<string, string>): Promise<string> {
  if (params['openid.mode'] !== 'id_res') throw new Error('Steam не подтвердил вход');
  if (params['openid.op_endpoint'] !== STEAM_OPENID) throw new Error('Неверный адрес Steam');
  const returnTo = params['openid.return_to'] ?? '';
  const allowed = list('ALLOWED_ORIGINS');
  if (allowed.length && !allowed.some((o) => returnTo === o || returnTo.startsWith(o + '/') || returnTo.startsWith(o + '?'))) {
    throw new Error('Вход начат с чужого сайта');
  }
  const m = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(params['openid.claimed_id'] ?? '');
  if (!m || params['openid.identity'] !== params['openid.claimed_id']) throw new Error('Неверный Steam ID');

  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (k.startsWith('openid.')) body.set(k, v);
  body.set('openid.mode', 'check_authentication');
  const res = await fetch(STEAM_OPENID, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const text = await res.text();
  if (!/is_valid\s*:\s*true/.test(text)) throw new Error('Steam не подтвердил подпись — попробуйте войти ещё раз');
  return m[1];
}

async function steamProfile(steamId: string) {
  const key = env('STEAM_API_KEY');
  const fallback = { nickname: `Steam ${steamId.slice(-5)}`, avatar_url: null, profile_url: `https://steamcommunity.com/profiles/${steamId}`, country: null };
  if (!key) return fallback;
  try {
    const r = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(key)}&steamids=${steamId}`);
    const p = (await r.json())?.response?.players?.[0];
    if (!p) return fallback;
    return {
      nickname: String(p.personaname || fallback.nickname).slice(0, 64),
      avatar_url: p.avatarfull || p.avatarmedium || null,
      profile_url: p.profileurl || fallback.profile_url,
      country: p.loccountrycode || null,
    };
  } catch {
    return fallback;
  }
}

Deno.serve(async (req) => {
  const headers = cors(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'Метод не поддерживается' }, 405, headers);

  try {
    const secret = env('STEAM_LOGIN_SECRET');
    if (secret.length < 16) throw new Error('Функция не настроена: задайте секрет STEAM_LOGIN_SECRET (минимум 16 символов)');
    const { params } = await req.json();
    if (!params || typeof params !== 'object') throw new Error('Нет данных от Steam');

    const steamId = await verifySteam(params);
    const profile = await steamProfile(steamId);

    const url = env('SUPABASE_URL');
    const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
    const pub = createClient(url, env('SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });

    const email = `${steamId}@${env('STEAM_EMAIL_DOMAIN') || 'steam.local'}`;
    const password = await hmacHex(secret, `steam:${steamId}`);

    // найти или создать пользователя
    const { data: existing } = await admin.from('profiles').select('id').eq('steam_id', steamId).maybeSingle();
    let userId = existing?.id as string | undefined;
    if (!userId) {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { steam_id: steamId } });
      if (error) throw new Error('Не удалось создать пользователя: ' + error.message);
      userId = data.user!.id;
    }

    const isAdmin = list('ADMIN_STEAM_IDS').includes(steamId);
    const row: Record<string, unknown> = { id: userId, steam_id: steamId, ...profile, last_login_at: new Date().toISOString() };
    if (isAdmin) row.is_admin = true;
    const { error: upErr } = await admin.from('profiles').upsert(row, { onConflict: 'id' });
    if (upErr) throw new Error('Не удалось сохранить профиль: ' + upErr.message);

    // выдать сессию
    let { data: s, error: sErr } = await pub.auth.signInWithPassword({ email, password });
    if (sErr) {
      await admin.auth.admin.updateUserById(userId, { email, password, email_confirm: true });
      ({ data: s, error: sErr } = await pub.auth.signInWithPassword({ email, password }));
    }
    if (sErr || !s?.session) throw new Error('Не удалось открыть сессию: ' + (sErr?.message ?? 'нет сессии'));

    const { data: me } = await admin.from('profiles').select('*').eq('id', userId).single();
    if (me?.is_banned) throw new Error('Аккаунт заблокирован администрацией');
    return json({ session: { access_token: s.session.access_token, refresh_token: s.session.refresh_token }, profile: me }, 200, headers);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400, headers);
  }
});
