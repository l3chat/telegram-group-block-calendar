/**
 * Cloudflare Worker — Telegram Group Calendar (WebApp-first)
 *
 * ENV (Workers → Settings → Variables):
 *   BOT_TOKEN      (secret)
 *   BOT_USERNAME   (text, без @)
 *   PAGES_URL      (text, https://<your>.pages.dev — без завершающего /)
 * Bindings:
 *   DB (D1)
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

    const sendText = async (chat_id, text, extra = {}) => {
      try {
        return await api(env.BOT_TOKEN, 'sendMessage', {
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
        none: 'Пока нет броней.',
        list_header: '📅 Занятые дни:',
        lang_set: (l) => `Язык чата: ${l}`,
      },
      en: {
        none: 'No bookings yet.',
        list_header: '📅 Booked days:',
        lang_set: (l) => `Chat language: ${l}`,
      },
      ja: {
        none: 'まだ予約はありません。',
        list_header: '📅 予約済みの日付：',
        lang_set: (l) => `チャットの言語: ${l}`,
      },
    };
    const getT = async (env, chatId) => {
      try {
        const r = await env.DB?.prepare('SELECT lang FROM chat_prefs WHERE chat_id=?')
          .bind(String(chatId)).first();
        return T[r?.lang || 'ru'] || T.ru;
      } catch { return T.ru; }
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
      } catch {}
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

    // ---------- JSON: /cancel_api  (remove booking; owner or admin)
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
              headers: { 'content-type': 'application/json', ...cors }
            });
          }

          const row = await env.DB.prepare(
            'SELECT user_id, user_name FROM bookings WHERE chat_id=?1 AND date=?2'
          ).bind(chat_id, date).first();

          if (!row) {
            return new Response(JSON.stringify({ ok:false, error:'not-found' }), {
              headers: { 'content-type': 'application/json', ...cors }
            });
          }

          const owner  = (row.user_id === user_id) || (row.user_id === 0);
          const admin  = await isAdminInChatViaId(env, chat_id, user_id);
          if (!(owner || admin)) {
            return new Response(JSON.stringify({ ok:false, error:'forbidden' }), {
              headers: { 'content-type': 'application/json', ...cors }
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

    // ---------- fallback /ingest (create booking; used by WebApp fallback)
    if (url.pathname === '/ingest') {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (req.method === 'POST') {
        try {
          const p = await req.json();
          console.log('ingest hit', { chat_id: p?.chat_id, date: p?.date, user_id: p?.user_id }); // <— лог
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
            // already exists — ignore
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

      // unify message access
      const msg = update.message
               || update.channel_post
               || update.edited_message
               || update.edited_channel_post
               || null;

      // extract command via entities
      function extractCommand(m) {
        if (!m?.text || !Array.isArray(m.entities)) return null;
        const ent = m.entities.find(e => e.type === 'bot_command' && e.offset === 0);
        if (!ent) return null;
        const raw = m.text.slice(0, ent.length);   // "/open" or "/open@Bot"
        const tail = m.text.slice(ent.length).trim();
        return { raw, tail };
      }
      const cmd = extractCommand(msg);

      // /open — В ЛС: web_app; В группе: deep-link в ЛС + обычная ссылка (браузер)
      if (cmd && /^\/open(?:@\w+)?$/i.test(cmd.raw)) {
        const chat     = msg.chat;
        const threadId = msg.message_thread_id;
        const from     = msg.from;

        const ingest = `https://${url.host}/ingest`;
        const baseUrl = `${pagesBase}/index.html?chat_id=${encodeURIComponent(chat.id)}`
                      + (threadId ? `&topic_id=${encodeURIComponent(threadId)}` : '')
                      + `&ingest=${encodeURIComponent(ingest)}`
                      + `&uid=${encodeURIComponent(String(from?.id || 0))}`
                      + `&uname=${encodeURIComponent(fullName(from))}`;

        const deepLink = `https://t.me/${env.BOT_USERNAME}?start=${encodeURIComponent('G' + chat.id + (threadId ? '_T' + threadId : ''))}`;

        if (chat?.type === 'private') {
          const r = await api(env.BOT_TOKEN, 'sendMessage', {
            chat_id: chat.id,
            text: 'Откройте календарь:',
            reply_markup: { inline_keyboard: [[{ text: '📅 Открыть календарь', web_app: { url: baseUrl } }]] }
          });
          console.log('open/private resp:', await r.json().catch(()=>null));
        } else {
          const r = await api(env.BOT_TOKEN, 'sendMessage', {
            chat_id: chat.id,
            text: 'Откройте календарь:',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📬 Открыть в ЛС', url: deepLink }],
                [{ text: '🌐 Открыть в браузере', url: baseUrl }]
              ]
            },
            ...(threadId ? { message_thread_id: threadId } : {}),
            reply_to_message_id: msg.message_id,
            allow_sending_without_reply: true
          });
          console.log('open/group resp:', await r.json().catch(()=>null));
        }
        return new Response('ok');
      }

      // /list — простой текст
      if (cmd && /^\/list(?:@\w+)?$/i.test(cmd.raw)) {
        const chat = msg.chat;
        const threadId = msg.message_thread_id;
        const t = await getT(env, chat.id);

        if (chat?.type !== 'group' && chat?.type !== 'supergroup') {
          await sendText(chat.id, T.ru.none);
          return new Response('ok');
        }
        if (!env.DB) {
          await sendText(chat.id, '❗ DB binding отсутствует.', threadExtra(threadId));
          return new Response('ok');
        }
        try {
          const rows = await getBookings(env, chat.id);
          const text = rows.length
            ? (await getT(env, chat.id)).list_header + '\n' + rows.map(r => `${r.date} — ${r.user_name}`).join('\n')
            : (await getT(env, chat.id)).none;
          await sendText(chat.id, text, threadExtra(threadId));
        } catch (e) {
          console.error('D1 list fail', e);
          await sendText(chat.id, '❗ Не удалось получить список (DB).', threadExtra(threadId));
        }
        return new Response('ok');
      }

      // /lang ru|en|ja
      if (cmd && /^\/lang(?:@\w+)?$/i.test(cmd.raw)) {
        const chat = msg.chat;
        const threadId = msg.message_thread_id;
        const m = (msg.text || '').trim().match(/^\/lang(?:@\w+)?\s+(ru|en|ja)$/i);
        if (!m) { await sendText(chat.id, 'Usage: /lang ru|en|ja', threadExtra(threadId)); return new Response('ok'); }
        const lang = m[1].toLowerCase();
        if (env.DB) await setLang(env, chat.id, lang);
        const t = await getT(env, chat.id);
        await sendText(chat.id, t.lang_set(lang), threadExtra(threadId));
        return new Response('ok');
      }

      // /start в ЛС → web_app-кнопка
      if (msg?.text && /^\/start/.test(msg.text) && msg.chat?.type === 'private') {
        const arg = msg.text.split(' ', 2)[1] || '';
        const m = arg.match(/^G(-?\d+)(?:_T(\d+))?$/);
        if (m && pagesBase) {
          const groupId = m[1]; const topicId = m[2];
          const uid = msg.from?.id || 0;
          const uname = fullName(msg.from);
          const ingest = `https://${url.host}/ingest`;
          const openUrl = `${pagesBase}/index.html?chat_id=${groupId}`
                        + (topicId ? `&topic_id=${topicId}` : '')
                        + `&ingest=${encodeURIComponent(ingest)}`
                        + `&uid=${encodeURIComponent(String(uid))}`
                        + `&uname=${encodeURIComponent(uname)}`;

          await api(env.BOT_TOKEN, 'sendMessage', {
            chat_id: msg.chat.id,
            text: 'Откройте календарь:',
            reply_markup: { inline_keyboard: [[{ text: '📅 Открыть календарь', web_app: { url: openUrl } }]] }
          });
        } else {
          await sendText(msg.chat.id, 'Это приватный чат с ботом. Запустите /open в группе.');
        }
        return new Response('ok');
      }

      // WebApp → sendData (доп. канал)
      if (msg?.web_app_data?.data) {
        try {
          const p = JSON.parse(msg.web_app_data.data);
          if (p?.type !== 'book') return new Response('ok');

          const chat_id = String(p.chat_id);
          const date = String(p.date);
          const uid  = Number(p.user_id) || (msg.from?.id ?? 0);
          const uname = (p.user_name && String(p.user_name).trim()) || fullName(msg.from);

          if (env.DB) {
            try {
              await env.DB.prepare(
                'INSERT INTO bookings(chat_id,date,user_id,user_name) VALUES (?1,?2,?3,?4)'
              ).bind(chat_id, date, uid, uname).run();
            } catch {}
          }
        } catch (e) { console.error('web_app_data parse fail', e); }
        return new Response('ok');
      }

      return new Response('ok');
    }

    return new Response('Not found', { status: 404 });
  }
};
