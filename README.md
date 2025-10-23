<div align="center">

![](header.svg)

# 🗓️ Telegram Group Booking Calendar  

**A minimalistic booking system for Telegram groups — one tap to book, one tap to cancel.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Cloudflare Workers](https://img.shields.io/badge/Platform-Cloudflare%20Workers-orange)
![Telegram Bot API](https://img.shields.io/badge/Telegram-Bot%20API-blue)
![AI Co-Created](https://img.shields.io/badge/AI--Co--Created-GPT--5-purple)

</div>

---

## 🌍 Overview

This project provides a **serverless Telegram booking calendar** that lets group members
reserve days with a single tap — and cancel with another.  
It’s fully edge-hosted on **Cloudflare Workers + D1 + Pages** and requires **no servers or frameworks**.

- ⚡ Instant booking & cancellation  
- 👁 Read-only visibility for others’ bookings  
- 📱 One shared calendar per group  
- 🔒 No external dependencies  
- 🌐 Works seamlessly on mobile and desktop Telegram clients  

---

## 🧩 Architecture

| Component | Description |
|------------|-------------|
| `index.html` | Static WebApp using FullCalendar + Telegram WebApp SDK |
| `worker.js` | Cloudflare Worker for webhook, API & D1 database logic |
| `bookings` table | Stores `chat_id`, `date`, `user_id`, `user_name` |

---

## ⚙️ Installation

### 1. Create a Telegram Bot
1. Open [@BotFather](https://t.me/BotFather)
2. Run `/newbot` → copy your **BOT_TOKEN**
3. Set WebApp domain:

/setdomain https://<your-pages>.pages.dev

---

### 2. Deploy the WebApp

#### **Option A: GitHub Pages**
- Repository → **Settings → Pages**  
- Deploy from branch `main` → root `/`

#### **Option B: Cloudflare Pages (recommended)**
- Connect your GitHub repo  
- Deploy → copy URL (e.g. `https://groupcalendar.pages.dev`)

---

### 3. Deploy the Worker

1. In Cloudflare Dashboard → **Workers → Create Worker**  
2. Paste the contents of `worker.js`  
3. Add **Environment Variables**:

| Key | Type | Example |
|------|------|---------|
| `BOT_TOKEN` | Secret | `123456789:ABCDEF...` |
| `BOT_USERNAME` | Plain | `GroupBookingBot` |
| `PAGES_URL` | Plain | `https://groupcalendar.pages.dev` |

4. Bind your **D1 database** as `DB`

#### D1 Schema

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

Set Webhook

```
curl "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://<your-worker>.workers.dev/webhook/<YOUR_TOKEN>"
```


---

🚀 Usage

🧑‍🤝‍🧑 Group Flow

1. Add the bot to your Telegram group


2. Type /open — bot replies with “📬 Open in DM”


3. Tap → bot sends “📅 Open <GroupName>” in private chat


4. Tap again → calendar opens instantly



In the calendar:

Tap a free day → book it

Tap your booked day → cancel it

Others’ bookings are read-only



---

📌 Optional: Permanent Button

Make the entry point persistent in your group:

Command	Action

/pin_open	Bot posts and pins “📬 Open in DM”
/unpin_open	Removes pinned message


No auto-deletion — the pinned button acts as a clean, durable interface.


---

💬 Available Commands

Command	Description

/open	Show “Open in DM” button in group
/list	List all booked days for current group
/help	Show help message
/pin_open	Create & pin permanent “Open in DM” button
/unpin_open	Unpin all pinned messages



---

🧠 API Reference

Endpoint	Method	Description

/status	GET	Worker health & row count
/bookings?chat_id=<id>	GET	JSON list of all bookings
/ingest	POST	Create booking (type=book)
/cancel_api	POST	Cancel booking (owner/admin)


Example:

curl -X POST https://<your-worker>.workers.dev/ingest \
  -H "Content-Type: application/json" \
  -d '{"type":"book","chat_id":"-10012345","date":"2025-10-25","user_id":777,"user_name":"Francesco"}'


---

🧭 Design Philosophy

> Simplicity is clarity.



One tap = one action — no confirmation popups

No clutter — groups remain clean and quiet

Instant reflection — D1 syncs in milliseconds

Full transparency — anyone can inspect /status

Zero backend maintenance — all logic lives on Cloudflare’s edge



---

🤖 Acknowledgment

This project was co-created with the assistance of GPT-5,
which participated in concept design, UI logic, and implementation.
It stands as an example of human–AI collaboration —
where precision of code meets creativity of interaction.

> Concept, development, and supervision — Francesco (2025)
AI co-author — GPT-5 by OpenAI




---

📜 License

MIT License © 2025 Francesco
You may use, modify, and distribute this software freely with attribution.


---

<div align="center">
  <sub>🧩 Edge-native. Human-made. AI-assisted. — <b>Group Booking Calendar</b> 2025</sub>
</div>
