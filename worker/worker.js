/**
 * Cloudflare Worker — Telegram Group Calendar (WebApp-first)
 * Mini App (Pages) + D1 + /open + /list + /lang + /cancel_api(JSON) + /bookings(JSON) + fallback /ingest + WebApp в группе/ЛС
 *
 * Workers → Settings:
 *   Secrets: BOT_TOKEN
 *   Text   : BOT_USERNAME (без @), PAGES_URL (https://<your>.pages.dev)
 *   D1     : DB
 *
 * D1:
 *   CREATE TABLE IF NOT EXISTS bookings(chat_id TEXT NOT NULL,date TEXT NOT NULL,user_id INTEGER NOT NULL,user_name TEXT,ts TEXT NOT NULL DEFAULT (datetime('now')),PRIMARY KEY(chat_id,date));
 *   CREATE TABLE IF NOT EXISTS chat_prefs(chat_id TEXT PRIMARY KEY,lang TEXT NOT NULL DEFAULT 'ru');
 */

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const pagesBase = (env.PAGES_URL || '').replace(/\/+$/, '');

    // ---------- helpers ----------
    const api = (token, method, body) =>
      fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {})
      });

    const sendText = async (env, chat_id, text, extra = {}) => {
      try {
        await api(env.BOT_TOKEN, 'sendMessage', {
          chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra
        });
      } catch (e) { console.error('sendMessage fail', e); }
    };

    const fullName = (u) => {
      if (!u) return 'кто-то';
      const s = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
      return s || (u.username ? '@' + u.username : `id${u.id}`);
    };

    const threadExtra = (topicId) =>
      Number.isFinite(topicId) ? { message_thread_id: topicId } : {};

    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    };

    // ---------- i18n ----------
    const T = {
      ru: {
        open_in_dm: 'Откройте календарь кнопкой ниже:',
        none: 'Пока нет броней.',
        taken: (d, u) => `✅ День ${d} занят пользователем ${u}.`,
        busy:  (d, u) => `❌ День ${d} уже занят (${u}).`,
        canceled_ok: (d) => `🗑️ Бронь на ${d} снята.`,
        canceled_denied: (d) => `⛔ Вы не владелец брони ${d}.`,
        canceled_absent: (d) => `🙈 Брони на ${d} не найдено.`,
        list_header: '📅 Занятые дни:',
        wrong_format: 'Использование: /cancel YYYY-MM-DD',
        lang_set: (l) => `Язык чата: ${l}`,
        open_here_btn: '📅 Открыть здесь',
        open_dm_btn: '📬 Открыть в ЛС',
      },
      en: {
        open_in_dm: 'Open the calendar using a button below:',
        none: 'No bookings yet.',
        taken: (d, u) => `✅ ${d} booked by ${u}.`,
        busy:  (d, u) => `❌ ${d} already booked by ${u}.`,
        canceled_ok: (d) => `🗑️ Booking for ${d} removed.`,
        canceled_denied: (d) => `⛔ You don’t own the booking for ${d}.`,
        canceled_absent: (d) => `🙈 No booking found for ${d}.`,
        list_header: '📅 Booked days:',
        wrong_format: 'Usage: /cancel YYYY-MM-DD',
        lang_set: (l) => `Chat language: ${l}`,
        open_here_btn: '📅 Open here',
        open_dm_btn: '📬 Open in DM',
      },
      ja: {
        open_in_dm: '下のボタンからカレンダーを開いてください：',
        none: 'まだ予約はありません。',
        taken: (d, u) => `✅ ${d} は ${u} が予約しました。`,
        busy:  (d, u) => `❌ ${d} は既に予約済み（${u}）。`,
        canceled_ok: (d) => `🗑️ ${d} の予約を取り消しました。`,
        canceled_denied: (d) => `⛔ ${d} の予約者ではありません。`,
        canceled_absent: (d) => `🙈 ${d} の予約は見つかりません。`,
        list_header: '📅 予約済みの日付：',
        wrong_format: '使い方: /cancel YYYY-MM-DD',
        lang_set: (l) => `チャットの言語: ${l}`,
        open_here_btn: '📅 ここで開く',
        open_dm_btn: '📬 DMで開く',
      },
    };

    const getT = async (env, chatId) => {
      try {
        const r = await env.DB?.prepare('SELECT lang FROM chat_prefs WHERE chat_id=?')
          .bind(String(chatId)).first();
        return T[r?.lang || 'ru'] || T.ru;
      } catch { return T.ru; }
    };

    const tr = (t, key, ...args) => {
      const v = t[key];
      return typeof v === 'function' ? v(...args) : v;
    };

    const setLang = async (env, chatId, lang) => {
      if (!['ru','en','ja'].includes(lang)) return;
      await env.DB.prepare(
        'INSERT INTO chat_prefs(chat_id,lang) VALUES(?1,?2) ON CONFLICT(chat_id) DO UPDATE SET lang=excluded.lang'
      ).bind(String(chatId), lang).run();
    };

    // ---------- data ----------
    const getBookings = async (env, chatId) => {
      return (await env.DB
        .prepare('SELECT date, user_id, user_name FROM bookings WHERE chat_id=? ORDER BY date')
        .bind(String(chatId)).all()).results || [];
    };

    async function isAdminInChatViaId(env, chatId, userId) {
      if (!userId) return false;
      try {
        const r = await api(env.BOT_TOKEN, 'getChatMember', { chat_id: chatId, user_id: userId });
        const d = await r.json();
        const s = d?.result?.status;
        return (s === 'creator' || s === 'administrator');
      } catch { return false; }
    }

    // ---------- health ----------
    if (req.method === 'GET' && url.pathname === '/') return new Response('ok');

    if (req.method === 'GET' && url.pathname === '/status') {
      let dbOk = false, rows = 0;
      try {
        dbOk = !!(await env.DB?.prepare('SELECT 1 AS ok').first())?.ok;
        rows = (await env.DB?.prepare('SELECT COUNT(*) AS n FROM bookings').first())?.n ?? 0;
      } catch (e) { console.error('D1 status fail', e); }
      return new Response(JSON.stringify({
        ok: true, hasBOT_TOKEN: !!env.BOT_TOKEN,
        BOT_USERNAME: env.BOT_USERNAME || null,
        PAGES_URL: pagesBase || null, dbOk, rows
      }, null, 2), { headers: { 'content-type': 'application/json' }});
    }

    // ---------- JSON: /bookings
    if (req.method === 'GET' && url.pathname === '/bookings') {
      const chatId = url.searchParams.get('chat_id');
      if (!chatId) {
        return new Response(JSON.stringify({ ok:false, error:'chat_id is required' }), {
          status: 400, headers: { 'content-type': 'application/json', ...cors }
        });
      }
      try {
        const rows = await getBookings(env, chatId);
        return new Response(JSON.stringify({ ok:true, chat_id: String(chatId), bookings: rows }), {
          headers: { 'content-type': 'application/json', ...cors }
        });
      } catch (e) {
        console.error('bookings json fail', e);
        return new Response(JSON.stringify({ ok:false }), {
          status: 500, headers: { 'content-type': 'application/json', ...cors }
        });
      }
    }

    // ---------- JSON: /cancel_api  (owner or admin)
    if (url.pathname === '/cancel_api') {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (req.method === 'POST') {
        try {
          const p = await req.json();
          const chat_id = String(p.chat_id || '');
          const date    = String(p.date    || '');
          const user_id = Number(p.user_id || 0);
          if (!chat_id || !date) {
            return new Response(JSON.stringify({ ok:false, error:'bad-params' }), {
              status: 400, headers: { 'content-type': 'application/json', ...cors }
            });
          }
          if (!env.DB) {
            return new Response(JSON.stringify({ ok:false, error:'no-db' }), {
              status: 200, headers: { 'content-type': 'application/json', ...cors }
            });
          }

          const row = await env.DB.prepare(
            'SELECT user_id, user_name FROM bookings WHERE chat_id=?1 AND date=?2'
          ).bind(chat_id, date).first();

          if (!row) {
            return new Response(JSON.stringify({ ok:false, error:'not-found' }), {
              status: 200, headers: { 'content-type': 'application/json', ...cors }
            });
          }

          const isOwner = (row.user_id === user_id) || (row.user_id === 0); // «наследие» позволим
          const isAdmin = await isAdminInChatViaId(env, chat_id, user_id);

          if (!(isOwner || isAdmin)) {
            return new Response(JSON.stringify({ ok:false, error:'forbidden' }), {
              status: 200, headers: { 'content-type': 'application/json', ...cors }
            });
          }

          await env.DB.prepare('DELETE FROM bookings WHERE chat_id=?1 AND date=?2')
            .bind(chat_id, date).run();

          return new Response(JSON.stringify({ ok:true }), {
            headers: { 'content-type': 'application/json', ...cors }
          });
        } catch (e) {
          console.error('cancel_api fail', e);
          return new Response(JSON.stringify({ ok:false }), {
            status: 500, headers: { 'content-type': 'application/json', ...cors }
          });
        }
      }
    }

    // ---------- fallback /ingest (CORS)  (create booking)
    if (url.pathname === '/ingest') {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (req.method === 'POST') {
        try {
          const p = await req.json();
          if (p?.type !== 'book') return new Response('ok', { headers: cors });

          const chat_id = String(p.chat_id);
          const date = String(p.date);
          const uid  = Number(p.user_id) || 0;
          const uname = (p.user_name && String(p.user_name).trim()) || 'через WebApp';
          if (!env.DB) return new Response('ok', { headers: cors });

          try {
            await env.DB.prepare(
              'INSERT INTO bookings(chat_id,date,user_id,user_name) VALUES (?1,?2,?3,?4)'
            ).bind(chat_id, date, uid, uname).run();
          } catch {
            // уже занято — ничего
          }
        } catch (e) { console.error('ingest fail', e); }
        return new Response('ok', { headers: cors });
      }
    }

    // ---------- Telegram webhook ----------
    if (req.method === 'POST' && url.pathname.startsWith('/webhook/')) {
      const pathToken = url.pathname.split('/').pop();
      if (!env.BOT_TOKEN || pathToken !== env.BOT_TOKEN) return new Response('ok');

      let update; try { update = await req.json(); } catch { return new Response('ok'); }
      const msg = update?.message;

      // /open → две кнопки: открыть WebApp в группе и в ЛС
      if (msg?.text && /^\/open(\@\w+)?/.test(msg.text)) {
        const chat = msg.chat;
        const threadId = msg.message_thread_id;
        const t = await getT(env, chat.id);

        if (chat?.type === 'group' || chat?.type === 'supergroup') {
          const ingest = `https://${url.host}/ingest`;
          const baseUrl = `${pagesBase}/index.html?chat_id=${chat.id}`
                        + (threadId ? `&topic_id=${threadId}` : '')
                        + `&ingest=${encodeURIComponent(ingest)}`
                        + `&uid=${encodeURIComponent(String(msg.from?.id || 0))}`
                        + `&uname=${encodeURIComponent(fullName(msg.from))}`;

          const deepLink = `https://t.me/${env.BOT_USERNAME}?start=${encodeURIComponent(`G${chat.id}` + (threadId ? `_T${threadId}` : ''))}`;

          await sendText(env, chat.id, tr(t,'open_in_dm'), {
            reply_markup: {
              inline_keyboard: [
                [{ text: tr(t,'open_here_btn'), web_app: { url: baseUrl } }],
                [{ text: tr(t,'open_dm_btn'),   url: deepLink }]
              ]
            },
            ...threadExtra(threadId)
          });
        } else {
          await sendText(env, chat.id, 'Команду /open нужно вызывать в группе.');
        }
        return new Response('ok');
      }

      // /list → просто текст
      if (msg?.text && /^\/list(\@\w+)?/.test(msg.text)) {
        const chat = msg.chat;
        const threadId = msg.message_thread_id;
        const t = await getT(env, chat.id);

        if (chat?.type !== 'group' && chat?.type !== 'supergroup') {
          await sendText(env, chat.id, tr(t,'none'));
          return new Response('ok');
        }
        if (!env.DB) {
          await sendText(env, chat.id, '❗ DB binding отсутствует.', threadExtra(threadId));
          return new Response('ok');
        }
        try {
          const rows = await getBookings(env, chat.id);
          const text = rows.length
            ? tr(t,'list_header') + '\n' + rows.map(r => `${r.date} — ${r.user_name}`).join('\n')
            : tr(t,'none');
          await sendText(env, chat.id, text, threadExtra(threadId));
        } catch (e) {
          console.error('D1 list fail', e);
          await sendText(env, chat.id, '❗ Не удалось получить список (DB).', threadExtra(threadId));
        }
        return new Response('ok');
      }

      // /lang
      if (msg?.text && /^\/lang(\@\w+)?\s+/.test(msg.text)) {
        const chat = msg.chat;
        const threadId = msg.message_thread_id;
        const m = msg.text.trim().match(/^\/lang(?:@\w+)?\s+(ru|en|ja)$/i);
        if (!m) { await sendText(env, chat.id, 'Usage: /lang ru|en|ja', threadExtra(threadId)); return new Response('ok'); }
        const lang = m[1].toLowerCase();
        if (env.DB) await setLang(env, chat.id, lang);
        const t = await getT(env, chat.id);
        await sendText(env, chat.id, tr(t,'lang_set', lang), threadExtra(threadId));
        return new Response('ok');
      }

      // WebApp sendData (DM / group) — оставляем как «доп канал» на будущее
      if (msg?.web_app_data?.data) {
        try {
          const p = JSON.parse(msg.web_app_data.data);
          if (p?.type !== 'book') return new Response('ok');

          const chat_id = String(p.chat_id);
          const date = String(p.date);
          const uid  = Number(p.user_id) || (msg.from?.id ?? 0);
          const uname = (p.user_name && String(p.user_name).trim()) || fullName(msg.from);

          if (!env.DB) return new Response('ok');

          try {
            await env.DB.prepare(
              'INSERT INTO bookings(chat_id,date,user_id,user_name) VALUES (?1,?2,?3,?4)'
            ).bind(chat_id, date, uid, uname).run();
          } catch {}
        } catch (e) { console.error('web_app_data parse fail', e); }
        return new Response('ok');
      }

      return new Response('ok');
    }

    return new Response('Not found', { status: 404 });
  }
};