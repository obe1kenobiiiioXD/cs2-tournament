# Подключение Organizm к Supabase и Steam

Пока сайт не подключён, он работает в **демо-режиме**: всё можно потрогать, но данные хранятся только в браузере. Чтобы включить настоящий режим, сделайте шаги ниже — это около 15 минут.

## 1. Проект Supabase

1. Зарегистрируйтесь на [supabase.com](https://supabase.com) и нажмите **New project**.
2. Регион — **Central EU (Frankfurt)**, тариф Free. Пароль базы сохраните, он пригодится только для обслуживания.

## 2. База данных

1. В проекте откройте **SQL Editor → New query**.
2. Вставьте целиком файл [`supabase/schema.sql`](supabase/schema.sql) и нажмите **Run**.
   Скрипт можно запускать повторно — например, после обновления сайта.

## 3. Ключ Steam API

1. Откройте [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey) (нужен аккаунт Steam без ограничений).
2. Домен: `obe1kenobiiiioxd.github.io`. Скопируйте ключ.

## 4. Функция входа через Steam

1. В Supabase откройте **Edge Functions → Deploy a new function → Via Editor**.
2. Имя функции — ровно `steam-auth`.
3. Вставьте код из [`supabase/functions/steam-auth/index.ts`](supabase/functions/steam-auth/index.ts) и нажмите **Deploy**.
4. В настройках функции (**Details**) выключите **Enforce JWT verification** (Verify JWT) — функция вызывается ещё до входа, у посетителя нет токена.

   Если пользуетесь Supabase CLI: `supabase functions deploy steam-auth --no-verify-jwt`.

5. **Edge Functions → Secrets** — добавьте:

| Имя | Значение |
|---|---|
| `STEAM_API_KEY` | ключ из шага 3 |
| `STEAM_LOGIN_SECRET` | любая случайная строка от 32 символов, например из генератора паролей. **Не меняйте после запуска** |
| `ALLOWED_ORIGINS` | `https://obe1kenobiiiioxd.github.io` |
| `ADMIN_STEAM_IDS` | ваш SteamID64 (17 цифр, начинается с 7656…). Через запятую можно указать нескольких |

SteamID64 виден в адресе профиля Steam (`steamcommunity.com/profiles/7656…`) или на [steamid.io](https://steamid.io).
При входе этим аккаунтам автоматически выдаются права администратора. Позже админов можно назначать прямо на сайте: **Модерация → Игроки**.

## 5. Связать сайт с базой

1. В Supabase: **Project Settings → API** (или **Data API**).
2. Скопируйте **Project URL** и ключ **anon public** (или **publishable**).
3. Впишите их в [`assets/config.js`](assets/config.js):

```js
window.ORGANIZM_CONFIG = {
  SUPABASE_URL: 'https://abcdefghijkl.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOi…',
};
```

Этот ключ публичный по назначению — его видит любой посетитель. Данные защищают права в базе: писать в таблицы можно только через серверные функции, которые проверяют, кто вы.

## 6. Проверка

Откройте сайт → **Войти через Steam** → подтвердите вход на странице Steam. Вы вернётесь на сайт с ником и аватаром из Steam, а в меню появится **Модерация**.

## Если что-то не работает

- **«Не удалось войти: Функция не настроена…»** — не задан секрет `STEAM_LOGIN_SECRET`.
- **«Вход начат с чужого сайта»** — проверьте `ALLOWED_ORIGINS` (без слэша в конце).
- **Ошибка 401 при входе** — у функции не выключена проверка JWT (шаг 4.4).
- **«Не удалось создать пользователя: … email …»** — добавьте секрет `STEAM_EMAIL_DOMAIN` со значением `example.com`. Это служебный адрес, письма на него не отправляются.
- **Нет кнопки «Модерация»** — выйдите и войдите снова после добавления `ADMIN_STEAM_IDS`.

## Как устроено

- `index.html`, `assets/` — сайт (GitHub Pages, без сборки).
- `assets/api.js` — работа с базой; при пустом `config.js` включается демо-режим.
- `supabase/schema.sql` — таблицы, права доступа и вся логика: модерация, команды, сетка, результаты, пики и баны.
- `supabase/functions/steam-auth` — проверка входа через Steam (OpenID) и выдача сессии.
