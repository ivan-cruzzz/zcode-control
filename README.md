<div align="center">

<img src="docs/banner.svg" alt="ZCODE Control" width="100%">

# ZCODE Control

**Панель управления [ZCODE](https://z.ai) из Telegram** — сессии, задачи, диалоги, статистика токенов. Telegram Mini App без бэкенда в облаке: статика на GitHub Pages, данные остаются на вашем компьютере.

[![Deploy](https://github.com/ivan-cruzzz/zcode-control/actions/workflows/deploy.yml/badge.svg)](https://github.com/ivan-cruzzz/zcode-control/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A522.5-339933?logo=node.js&logoColor=white)

**[Открыть в Telegram](https://t.me/MyWzcode_bot)** · **[Веб-демо](https://ivan-cruzzz.github.io/zcode-control/)** · **[Как это работает](#-архитектура)**

</div>

---

## Что это

Мини-апп для Telegram, который показывает, чем занят ZCODE на вашем ПК, и позволяет следить за работой с телефона:

- **Обзор** — живой статус (активен / простаивает), текущая сессия, модель и режим, токены за сегодня, лента последней активности;
- **Сессии** — список последних сессий с метками `live` / `готово` / `прервана`, расходом токенов и временем; внутри — задачи (todo), диалог пользователя с ассистентом и использованные инструменты;
- **Поиск** — полнотекстовый поиск по всем сообщениям всех сессий;
- **Статистика** — токены по дням за неделю, топ моделей и инструментов;
- **Демо-режим** — если мост не подключён, приложение показывает сгенерированные данные, так что интерфейс можно посмотреть сразу.

Без Telegram приложение тоже работает — откройте [веб-демо](https://ivan-cruzzz.github.io/zcode-control/).

## Архитектура

```
┌─────────────┐   HTTPS/WSS    ┌──────────────────┐   read-only    ┌────────────────┐
│  Telegram    │ ─────────────▶ │  Локальный мост   │ ─────────────▶ │  База ZCODE     │
│  Mini App    │   JSON + WS    │  (server/, ваш ПК)│    SQLite      │  db.sqlite      │
│  (GitHub     │ ◀───────────── │  проверка подписи │                │  session, todo, │
│   Pages)     │  live-события  │  initData HMAC    │                │  message, usage │
└─────────────┘                └──────────────────┘                └────────────────┘
```

- **Мини-апп** (`app/`) — статика: HTML/CSS/vanilla JS, без сборки и зависимостей. Хостится на GitHub Pages.
- **Мост** (`server/`) — маленький Node-сервер, который вы запускаете на своём компьютере. Читает базу ZCODE **только для чтения** и отдаёт данные мини-аппу через туннель (cloudflared / ngrok / tailscale).
- **Живые обновления** — WebSocket: новые сообщения и задачи прилетают в телефон за секунды. Если WS недоступен, клиент автоматически переходит на опрос раз в 12 секунд.

## Безопасность

Главная идея: **секретов в клиенте и репозитории нет и быть не может**.

| Где | Что | Почему безопасно |
|---|---|---|
| `server/.env` | токен бота | Файл в `.gitignore`, существует только на вашем ПК |
| Мини-апп | ничего | Авторизация — через подписанный Telegram `initData` |
| Репозиторий | ничего | В CI уезжает только статика из `app/` |

Как устроена авторизация: Telegram подписывает `initData` ключом, выведенным из токена бота. Мост проверяет HMAC-SHA256 подпись, свежесть (по умолчанию ≤ 24 ч) и — опционально — белый список Telegram ID (`ALLOWED_USER_IDS`). Подделать запрос без токена нельзя, а токен снаружи недоступен.

Дополнительно: CORS-allowlist (по умолчанию только ваш GitHub Pages и localhost), rate-limit, ограничение размера запроса, `timingSafeEqual` при сравнении подписей.

> **Совет:** токен бота вы когда-то вставляли в чаты/скрипты? Перевыпустите его у @BotFather (`/revoke`) и обновите `server/.env` — это одна минута.

## Быстрый старт

1. **Мост.** Нужен Node ≥ 22.5:
   ```bash
   cd server
   cp .env.example .env        # впишите BOT_TOKEN от @BotFather
   npm install
   npm start                   # или: npm run demo — без ZCODE, на сгенерированных данных
   ```
2. **Туннель** — мост должен быть доступен по HTTPS. Самый быстрый способ:
   ```bash
   cloudflared tunnel --url http://localhost:8787
   # скопируйте выданный адрес https://*.trycloudflare.com
   ```
   Альтернативы: `ngrok http 8787`, `tailscale funnel 8787`.
3. **Подключить мини-апп.** Откройте бота → **Настройки** → вставьте адрес туннеля → «Подключить». Готово: статус, сессии и задачи обновляются в реальном времени.

### Кнопка меню у бота

Чтобы приложение открывалось кнопкой меню в чате с ботом (у [этого бота](https://t.me/MyWzcode_bot) уже настроено), отправьте в любом HTTP-клиенте:

```
POST https://api.telegram.org/bot<TOKEN>/setChatMenuButton
{ "menu_button": { "type": "web_app", "text": "ZCODE Control",
                   "web_app": { "url": "https://ivan-cruzzz.github.io/zcode-control/" } } }
```

## API-контракт моста

Если хотите подключить мини-апп к своему каналу данных (не через SQLite), реализуйте эти методы — и всё заработает:

| Метод | Тело запроса | Ответ |
|---|---|---|
| `POST /api/auth` | `{initData}` | `{ok, user:{id, first_name, username}, mode}` |
| `POST /api/overview` | `{initData}` | `{ok, status:{state, model, mode, updatedAt, session}, stats:{sessions, sessionsToday, tokensToday, todosActive}, activity:[{sessionId, sessionTitle, time, text}]}` |
| `POST /api/sessions` | `{initData, limit}` | `{ok, sessions:[{id, title, directory, timeUpdated, outcome, tokens}]}` |
| `POST /api/session` | `{initData, id}` | `{ok, session, todos, messages, tools}` |
| `POST /api/search` | `{initData, q, limit}` | `{ok, results:[{sessionId, sessionTitle, time, text}]}` |
| `POST /api/stats` | `{initData, days}` | `{ok, daily:[{date, tokens, sessions}], models, tools}` |
| `WS /ws` | `{type:"auth", initData}` | `{type:"auth_ok"}`, далее `{type:"refresh", scope, id?}` |

`time*` — epoch-миллисекунды; `outcome` — `completed | interrupted | null`. Референсная реализация — `server/adapter-zcode.mjs`.

## Структура проекта

```
├── app/                    # мини-апп (статика, деплоится на Pages)
│   ├── index.html
│   ├── css/style.css       # дизайн-система: OLED-dark + тема Telegram
│   └── js/
│       ├── app.js          # состояние, экраны, отрисовка
│       ├── api.js          # клиент моста: HTTPS + WebSocket, автопереподключение
│       ├── demo.js         # демо-режим (витрина без моста)
│       └── tg.js           # обёртка Telegram WebApp: тема, хаптика, initData
├── server/                 # мост (запускается на вашем ПК)
│   ├── bridge.mjs          # HTTP/WS, проверка initData, CORS, rate-limit
│   ├── adapter-zcode.mjs   # чтение базы ZCODE (read-only SQLite)
│   ├── adapter-demo.mjs    # демо-адаптер
│   ├── .env.example        # шаблон конфига (без секретов)
│   └── .env                # ← ваши секреты (в git не попадает)
├── docs/banner.svg
└── .github/workflows/deploy.yml
```

## Деплой

Статика публикуется на GitHub Pages автоматически при push в `main` (`.github/workflows/deploy.yml`). Для собственного форка:

1. Settings → Pages → Source: **GitHub Actions**;
2. если меняете адрес сайта — добавьте его в `ALLOWED_ORIGINS` моста (`server/.env`);
3. при желании обновите кнопку меню бота (см. выше).

## FAQ

**Мост запущен, но «нет связи».** Проверьте: адрес в настройках начинается с `https://`; туннель живой; origin вашего сайта есть в `ALLOWED_ORIGINS`; `curl https://<туннель>/health` отвечает.

**«Авторизация Telegram не пройдена: expired».** Откройте мини-апп заново из Telegram — initData подписывается при каждом открытии и по умолчанию живёт сутки (`MAX_AUTH_AGE`).

**Данные кто-то ещё увидит?** Без валидной подписи Telegram — нет. Для дополнительной страховки задайте `ALLOWED_USER_IDS` в `server/.env`.

**SQLite ошибка при старте.** Мост открывает базу в read-only и не мешает ZCODE. Проверьте путь `ZCODE_DB` в `server/.env`, если база нестандартная.

---

<div align="center">

Сделано с ♥ и [ZCODE](https://z.ai) · [MIT](LICENSE) · 2026

</div>
