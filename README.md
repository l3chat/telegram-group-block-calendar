# Telegram Group Calendar (Mini App + Cloudflare Worker + D1)

A lightweight, serverless group calendar for Telegram. Members can book **one day per booking** (no overlaps), cancel with `/cancel`, and the bot maintains a **pinned “board”** with all bookings.  
Frontend is a Telegram Mini App (Cloudflare Pages). Backend is a Cloudflare Worker with D1.

## Features
- 📅 Book days via Mini App (WebApp) directly from Telegram.
- 🗑️ `/cancel YYYY-MM-DD` — owners remove their booking; admins (incl. **anonymous admins** in supergroups) can remove any.
- 📌 Auto-updated pinned board per chat/topic.
- 🌐 Localization: `/lang ru|en|ja`.
- 🔄 Fallback `/ingest` in case `sendData` fails.

## Architecture
- `pages/index.html` — Mini App UI (FullCalendar).
- `worker/worker.js` — Telegram webhook + D1 logic + board management.
- D1 tables:
```sql
  CREATE TABLE IF NOT EXISTS bookings(chat_id TEXT NOT NULL,date TEXT NOT NULL,user_id INTEGER NOT NULL,user_name TEXT,ts TEXT NOT NULL DEFAULT (datetime('now')),PRIMARY KEY(chat_id,date));

  CREATE TABLE IF NOT EXISTS boards(chat_id TEXT NOT NULL,topic_id INTEGER,message_id INTEGER NOT NULL,PRIMARY KEY(chat_id,topic_id));

  CREATE TABLE IF NOT EXISTS chat_prefs(chat_id TEXT PRIMARY KEY,lang TEXT NOT NULL DEFAULT 'ru');
```

## Deployment (short)

1. **Cloudflare Pages** → connect this repo (Root directory: `pages`, no build commands).
2. **Cloudflare D1** → create DB `calendar`, run SQL above, bind as `DB`.
3. **Cloudflare Worker** → deploy `worker/worker.js`.

   * Text vars: `BOT_USERNAME` (without @), `PAGES_URL` (your Pages URL).
   * Secret: `BOT_TOKEN`.
   * Bindings: D1 as `DB`.
4. **Telegram**

   * `@BotFather /setdomain` = your Mini App domain (Pages).
   * Webhook: `https://<worker>.workers.dev/webhook/<BOT_TOKEN>`.
5. In a group: `/open` → button in DM → “📅 Open Calendar”.

## Notes

* The pinned board requires `Pin messages` permission for the bot.
* If the pinned message was deleted or the topic cleaned, the worker will re-create it (see `updateBoard` logic).
* Supergroups with **anonymous admins** are supported (we detect by `sender_chat` or `getChatMember`).

---

# Телеграм-групповой календарь (Mini App + Cloudflare Worker + D1)

Небольшой серверлесс-календарь для групп: участники бронируют **дни без пересечений**, снимают бронь `/cancel`, бот ведёт **закреп-“доску”** со списком броней.

## Возможности

* 📅 Бронирование дат через Mini App в ЛС.
* 🗑️ `/cancel YYYY-MM-DD` — владелец снимает свою; админ (вкл. анонимного) снимает любую.
* 📌 Автообновляемая закреп-доска в чате/теме.
* 🌐 `/lang ru|en|ja`.
* 🔄 Fallback `/ingest` на случай падения `sendData`.

## Архитектура

* `pages/index.html` — UI (FullCalendar).
* `worker/worker.js` — Webhook + D1 + логика доски.
* Таблицы D1 см. выше (тот же SQL).

## Деплой (кратко)

1. **Pages:** репозиторий → Root `pages`, без сборки.
2. **D1:** создать `calendar`, выполнить SQL, привязать как `DB`.
3. **Worker:** задеплоить `worker.js`, задать `BOT_USERNAME`, `PAGES_URL`, секрет `BOT_TOKEN`, привязать `DB`.
4. **Telegram:** `/setdomain` = адрес Pages; webhook на воркер `/webhook/<BOT_TOKEN>`.
5. В группе: `/open` → кнопка в ЛС → «📅 Open Calendar».

## Важные заметки

* Для закрепа у бота должно быть право **Pin messages**.
* Если закреп потерян, `updateBoard()` создаст новый и обновит БД.
* В супергруппах с анонимностью админов удаление через `/cancel` работает (см. `isAdminInChat`).

## License

MIT — see `LICENSE`.

```

---

Если захочешь — могу сгенерировать **pull-request diff** (пара патчей: новый `updateBoard` и заменённый `README.md`), чтобы осталось только применить.
::contentReference[oaicite:0]{index=0}
```
