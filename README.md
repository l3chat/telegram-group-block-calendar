# Telegram Group Booking Calendar

A lightweight booking calendar for Telegram groups — with one-tap interaction, no servers, and no frameworks.  
Built with **Cloudflare Workers (serverless)**, **D1 database**, and a **static web app** on GitHub Pages (or Cloudflare Pages).

---

## 🌍 Overview

This project provides a minimal, privacy-friendly way for Telegram group members to book and free days — for example, to schedule meetings, shifts, events, or shared resources — **without overlapping**.

- Each participant can **book one or more days**.
- Tapping an empty date creates a booking.
- Tapping your own booking removes it.
- Other members’ bookings are visible but not editable.
- Works directly **inside Telegram** via WebApp or DM deep-link.
- No separate backend, only Cloudflare Worker and D1 database.
- 100% open source, ready for GitHub Pages.

---

## ✨ Features

- ⚡ Instant booking / unbooking — one tap, no confirmations.
- 📅 Real-time synchronization (reloads automatically after each action).
- 👥 Supports multiple Telegram groups independently.
- 🔐 Safe: each user can only modify their own bookings.
- 🌐 Runs fully serverless on Cloudflare + GitHub Pages.
- 📱 Works in private chats and group chats.
- 🎨 Simple and clean UI with color legend:
  - Green = your bookings
  - Red = others’ bookings

---

## 🧩 Components

| Component | Description |
|------------|-------------|
| **`index.html`** | The static calendar web app (served from GitHub Pages or Cloudflare Pages). |
| **`worker.js`** | Cloudflare Worker script handling Telegram API, database, and REST endpoints. |
| **D1 database** | Stores bookings: chat ID, date, user ID, and user name. |
| **Telegram bot** | Communicates between Telegram and the Worker via webhook. |

---

## 🛠️ Installation Guide

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/telegram-group-calendar.git
cd telegram-group-calendar
````

You’ll have these key files:

```
index.html        → The WebApp (UI)
worker.js         → Cloudflare Worker
```

---

### 2. Create a Telegram Bot

1. Open [@BotFather](https://t.me/BotFather).
2. Send `/newbot` and follow the instructions.
3. Save your **bot token** (looks like `1234567890:ABC...`).
4. Send `/setdomain` to BotFather and set the domain that your WebApp will use, for example:

   ```
   https://telegram-group-calendar.pages.dev
   ```

This allows Telegram to open your WebApp in inline mode.

---

### 3. Deploy the WebApp

#### Option A — GitHub Pages

1. Go to your repository → **Settings → Pages**.
2. Under “Build and deployment”, choose **Deploy from branch**.
3. Select branch `main` and folder `/ (root)`.
4. Save — your site will be available at
   `https://<your-username>.github.io/telegram-group-calendar/`.

#### Option B — Cloudflare Pages (recommended)

1. Go to [Cloudflare Pages](https://dash.cloudflare.com/).
2. Click **Create a project → Connect to Git**.
3. Select your repository and follow the prompts.
4. Once deployed, note your site URL (e.g. `https://groupcal.pages.dev`).

---

### 4. Create a Cloudflare Worker

1. Go to [Cloudflare Dashboard → Workers](https://dash.cloudflare.com/).
2. Create a new Worker (e.g. `group-calendar`).
3. Replace its content with `worker.js`.
4. Bind the following environment variables:

| Variable name  | Type   | Example                       |
| -------------- | ------ | ----------------------------- |
| `BOT_TOKEN`    | Secret | `1234567890:ABC...`           |
| `BOT_USERNAME` | Text   | `GroupBookingBot` (without @) |
| `PAGES_URL`    | Text   | `https://groupcal.pages.dev`  |

---

### 5. Add D1 Database

1. In Cloudflare dashboard, go to **D1** → Create a new database.
   Name it e.g. `calendar-db`.
2. In the Worker’s “Settings → Bindings”, add a **D1 Database binding**:

   ```
   Variable name: DB
   Database: calendar-db
   ```
3. Open the D1 console and run:

```sql
CREATE TABLE IF NOT EXISTS bookings(
  chat_id   TEXT NOT NULL,
  date      TEXT NOT NULL,
  user_id   INTEGER NOT NULL,
  user_name TEXT,
  ts        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(chat_id, date)
);
```

---

### 6. Connect the Telegram Webhook

Use your bot token and the Worker URL:

```bash
curl "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://<your-worker>.workers.dev/webhook/<YOUR_TOKEN>"
```

Example:

```bash
curl "https://api.telegram.org/bot1234567890:ABCDEF/setWebhook?url=https://cool-frog-62b9.lechat-reg.workers.dev/webhook/1234567890:ABCDEF"
```

You should get:

```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

---

### 7. Test the Bot

In your Telegram group:

1. Add your bot as a member.
2. Send the command `/open`.

The bot replies with a single button:

```
📬 Open in DM
```

Click it → you’ll be redirected to your bot’s private chat.

There, the bot sends:

```
📅 Open Calendar
```

Press the button — the web calendar opens right inside Telegram.

You can now tap on dates to book or unbook them.

---

## 📡 API Endpoints (for debugging)

| Endpoint                 | Method | Description                        |
| ------------------------ | ------ | ---------------------------------- |
| `/status`                | GET    | Health check and DB row count      |
| `/bookings?chat_id=<id>` | GET    | Returns JSON of all bookings       |
| `/ingest`                | POST   | Create a booking (used by WebApp)  |
| `/cancel_api`            | POST   | Cancel booking (by owner or admin) |

---

## 🧠 Technical Notes

* All data is stored locally in the D1 database — no external backend.
* Each Telegram chat (group) has its own namespace of dates.
* The combination `(chat_id, date)` is unique → one booking per date per group.
* Usernames and IDs are stored for identification only; no sensitive info.
* The WebApp communicates via Telegram `sendData()` and falls back to `/ingest`.

---

## 💡 Example Use Cases

* Team scheduling (who’s on duty each day)
* Room or equipment booking
* Volunteer calendar
* Shift planning for small teams
* Personal “who’s available” coordination

---

## 🧾 License

MIT License.
Copyright © 2025.

Feel free to fork, modify, and deploy your own instance.
Contributions are welcome!

