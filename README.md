# Telegram Group Calendar (Mini App + Cloudflare Worker + D1)

Готовый каркас репозитория **без** двух файлов с кодом (страница Mini App и файл воркера). 
Добавьте их самостоятельно:
- `pages/index.html` — ваш Mini App
- `worker/worker.js` — ваш Cloudflare Worker

## Структура
```
.
├─ worker/
│  ├─ wrangler.toml        # биндинги и конфиг (без секретов)
│  └─ (добавьте сюда worker.js)
├─ pages/
│  ├─ (добавьте сюда index.html)
├─ .gitignore
├─ README.md
├─ LICENSE
└─ .env.example
```

## D1: таблицы (выполните в Console)
```
CREATE TABLE IF NOT EXISTS bookings(chat_id TEXT NOT NULL,date TEXT NOT NULL,user_id INTEGER NOT NULL,user_name TEXT,ts TEXT NOT NULL DEFAULT (datetime('now')),PRIMARY KEY(chat_id,date));
CREATE TABLE IF NOT EXISTS boards(chat_id TEXT NOT NULL,topic_id INTEGER,message_id INTEGER NOT NULL,PRIMARY KEY(chat_id,topic_id));
CREATE TABLE IF NOT EXISTS chat_prefs(chat_id TEXT PRIMARY KEY,lang TEXT NOT NULL DEFAULT 'ru');
```

## Быстрый деплой
1. **Pages** → создайте проект из папки `pages/` (пока пустая, добавьте свой `index.html`).
2. **D1** → создайте БД `calendar`, выполните SQL выше, привяжите как binding `DB`.
3. **Worker** → создайте воркер из `worker/worker.js` (добавите сами).
   - Переменные: `BOT_USERNAME` (Text), `PAGES_URL` (Text), `BOT_TOKEN` (Secret).
   - Binding: D1 как `DB`.
4. Установите вебхук Telegram: `https://<your-worker>.<sub>.workers.dev/webhook/<BOT_TOKEN>`.
5. В группе: `/open` → кнопка в ЛС → «📅 Open Calendar».

## Заметки по безопасности
- Не коммитьте `BOT_TOKEN`. Храните секреты только в Cloudflare.
- `wrangler.toml` в репозитории — без секретов; допускается держать там `BOT_USERNAME` и `PAGES_URL`.
