/**
 * Cloudflare Worker — Telegram Group Booking Calendar
 * (English, DM-only button, DM /start shows group name)
 *
 * ENV (Workers → Settings):
 *   Secret   BOT_TOKEN        — Telegram Bot API token
 *   Variable BOT_USERNAME     — bot username without @ (e.g. GroupBookingBot)
 *   Variable PAGES_URL        — https://<your-pages>.pages.dev  (no trailing slash)
 *   D1 bind  DB               — D1 database binding
 *
 * D1 schema (run once):
 *   CREATE TABLE IF NOT EXISTS bookings(
 *     chat_id   TEXT NOT NULL,
 *     date      TEXT NOT NULL,       -- YYYY-MM-DD
 *     user_id   INTEGER NOT NULL,
 *     user_name TEXT,
 *     ts        TEXT NOT NULL DEFAULT (datetime('now')),
 *     PRIMARY KEY(chat_id, date)
 *   );
 */

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const pagesBase = (env.PAGES_URL || '').replace(/\/+$/, '');

    // ---------------- helpers ----------------
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
      if (!u) return 'someone';
      const s = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
      return s || (u.username ? '@' + u.username : `id${u.id}`);
    };

    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    };

    const getBookings = async (env, chatId) => {
      return (
        (await env.DB
          .prepare('SELECT date, user_id, user_name FROM bookings WHERE chat_id=? ORDER BY date')
          .bind(String(chatId))
          .all()).results || []
      );
    };

    async function isAdminInChatViaId(env, chatId, userId) {
      if (!userId) return false;
      try {
        const r = await api(env.BOT_TOKEN, 'getChatMember', { chat_id: chatId, user_id: userId });
        const d = await r.json();
        const s = d?.result?.status;
        return s === 'creator' || s === 'administrator';
      } catch { return false; }
    }

    // ---------------- health ----------------
    if (req.method === 'GET' && url.pathname === '/') return new Response('ok');

    if (req.method === 'GET' && url.pathname === '/status') {
      let dbOk = false, rows = 0;
      try {
        dbOk = !!(await env.DB?.prepare('SELECT 1 AS ok').first())?.ok;
        rows = (await env.DB?.prepare('SELECT COUNT(*) AS n FROM bookings').first())?.n ?? 0;
      } catch (e) { console.error('D1 status fail', e); }
      return new Response(JSON.stringify({
        ok: true,
        hasBOT_TOKEN: !!env.BOT_TOKEN,
        BOT_USERNAME: env.BOT_USERNAME || null,
        PAGES_URL: pagesBase || null,
        dbOk, rows
      }, null, 2), { headers: { 'content-type': 'application/json' }});
    }

    // ---------------- JSON endpoints ----------------
    // /bookings?chat_id=...
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

    // /cancel_api  (POST JSON: {chat_id,date,user_id})
    if (url.pathname === '/cancel_api') {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (req.method === 'POST') {
        try {
          const p = await req.json();
          const chat_id = String(p.chat_id || '');
          const date    = String(p.date || '');
          const user_id = Number(p.user_id || 0);
          if (!chat_id || !date) {
            return new Response(JSON.stringify({ ok:false, error:'bad-params' }), {
              status: 400, headers: { 'content-type': 'application/json', ...cors }
            });
          }
          const row = await env.DB.prepare(
            'SELECT user_id FROM bookings WHERE chat_id=?1 AND date=?2'
          ).bind(chat_id, date).first();

          if (!row) {
            return new Response(JSON.stringify({ ok:false, error:'not-found' }), {
              status: 200, headers: { 'content-type': 'application/json', ...cors }
            });
          }

          const isOwner = row.user_id === user_id;
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

    // /ingest  (POST JSON: {type:'book',chat_id,date,user_id,user_name})
    if (url.pathname === '/ingest') {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (req.method === 'POST') {
        try {
          const p = await req.json();
          if (p?.type !== 'book') return new Response('ok', { headers: cors });
          const chat_id = String(p.chat_id);
          const date = String(p.date);
          const uid  = Number(p.user_id) || 0;
          const uname = (p.user_name && String(p.user_name).trim()) || 'via WebApp';
          await env.DB.prepare(
            'INSERT INTO bookings(chat_id,date,user_id,user_name) VALUES (?1,?2,?3,?4)'
          ).bind(chat_id, date, uid, uname).run().catch(() => {});
        } catch (e) {
          console.error('ingest fail', e);
        }
        return new Response('ok', { headers: cors });
      }
    }

    // ---------------- Telegram webhook ----------------
    if (req.method === 'POST' && url.pathname.startsWith('/webhook/')) {
      const pathToken = url.pathname.split('/').pop();
      if (!env.BOT_TOKEN || pathToken !== env.BOT_TOKEN) return new Response('ok');

      let update; try { update = await req.json(); } catch { return new Response('ok'); }
      const msg = update.message
               || update.channel_post
               || update.edited_message
               || update.edited_channel_post
               || null;

      // extract bot_command safely
      function extractCommand(m) {
        if (!m?.text || !Array.isArray(m.entities)) return null;
        const ent = m.entities.find(e => e.type === 'bot_command' && e.offset === 0);
        if (!ent) return null;
        const raw  = m.text.slice(0, ent.length);     // "/open" or "/open@Bot"
        const tail = m.text.slice(ent.length).trim(); // payload (for /start)
        return { raw, tail };
      }
      const cmd = extractCommand(msg);

      // ---- /open (group: DM deep-link; private: web_app button) ----
      if (cmd && /^\/open(?:@\w+)?$/i.test(cmd.raw)) {
        const chat = msg.chat;
        const threadId = msg.message_thread_id;
        const from = msg.from;

        try {
          const ingest = `https://${url.host}/ingest`;
          const baseUrl = `${pagesBase}/index.html?chat_id=${encodeURIComponent(chat.id)}`
                        + (threadId ? `&topic_id=${encodeURIComponent(threadId)}` : '')
                        + `&ingest=${encodeURIComponent(ingest)}`
                        + `&uid=${encodeURIComponent(String(from?.id || 0))}`
                        + `&uname=${encodeURIComponent(fullName(from))}`;

          const deepLink =
            `https://t.me/${env.BOT_USERNAME}?start=${encodeURIComponent('G' + chat.id + (threadId ? '_T' + threadId : ''))}`;

          if (chat?.type === 'private') {
            const resp = await api(env.BOT_TOKEN, 'sendMessage', {
              chat_id: chat.id,
              text: 'Open the calendar:',
              reply_markup: { inline_keyboard: [[{ text: '📅 Open Calendar', web_app: { url: baseUrl } }]] }
            });
            console.log('open/private resp:', await resp.json().catch(()=>null));
          } else {
            // Only one button now (no browser URL)
            const resp = await api(env.BOT_TOKEN, 'sendMessage', {
              chat_id: chat.id,
              text: 'Open the calendar:',
              reply_markup: { inline_keyboard: [[{ text: '📬 Open in DM', url: deepLink }]] },
              ...(threadId ? { message_thread_id: threadId } : {}),
              reply_to_message_id: msg.message_id,
              allow_sending_without_reply: true
            });
            console.log('open/group resp:', await resp.json().catch(()=>null));
          }
        } catch (e) {
          console.error('open handler fail', e);
        }
        return new Response('ok');
      }

      // ---- /start (private): parse deep-link, include group name, show web_app button) ----
      if (cmd && /^\/start(?:@\w+)?$/i.test(cmd.raw)) {
        const chat = msg.chat;
        const from = msg.from;

        if (chat?.type !== 'private') {
          await api(env.BOT_TOKEN, 'sendMessage', { chat_id: chat.id, text: 'Please use /open in the group.' });
          return new Response('ok');
        }

        // Expect payload like: G-123456789 or G-123456789_T42
        const payload = cmd.tail || '';
        let groupId = null, topicId = null;
        try {
          const m = payload.match(/^G(-?\d+)(?:_T(\d+))?$/);
          if (m) { groupId = m[1]; topicId = m[2] ? Number(m[2]) : null; }
        } catch {}

        if (!groupId) {
          await api(env.BOT_TOKEN, 'sendMessage', {
            chat_id: chat.id,
            text: 'Open this bot from your group using /open to get the calendar link.'
          });
          return new Response('ok');
        }

        // Fetch group title
        let groupName = 'the group';
        try {
          const r = await api(env.BOT_TOKEN, 'getChat', { chat_id: groupId });
          const d = await r.json();
          if (d?.ok && d.result?.title) groupName = d.result.title;
        } catch (e) { console.error('getChat failed', e); }

        const ingest = `https://${url.host}/ingest`;
        const webappUrl = `${pagesBase}/index.html?chat_id=${encodeURIComponent(groupId)}`
                        + (topicId ? `&topic_id=${encodeURIComponent(topicId)}` : '')
                        + `&ingest=${encodeURIComponent(ingest)}`
                        + `&uid=${encodeURIComponent(String(from?.id || 0))}`
                        + `&uname=${encodeURIComponent(fullName(from))}`;

        const text = `📅 <b>${groupName}</b>\nOpen the calendar below:`;
        const resp = await api(env.BOT_TOKEN, 'sendMessage', {
          chat_id: chat.id,
          text, parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: `📅 Open ${groupName}`, web_app: { url: webappUrl } }]] }
        });
        console.log('start/private resp:', await resp.json().catch(()=>null));
        return new Response('ok');
      }

      // ---- /list (simple text list) ----
      if (cmd && /^\/list(?:@\w+)?$/i.test(cmd.raw)) {
        const chat = msg.chat;
        const threadId = msg.message_thread_id;
        if (!env.DB) {
          await sendText(env, chat.id, '❗ Database binding missing.');
          return new Response('ok');
        }
        try {
          const rows = await getBookings(env, chat.id);
          const text = rows.length
            ? '📅 Booked days:\n' + rows.map(r => `${r.date} — ${r.user_name}`).join('\n')
            : 'No bookings yet.';
          await sendText(env, chat.id, text, threadId ? { message_thread_id: threadId } : {});
        } catch (e) {
          console.error('list fail', e);
          await sendText(env, chat.id, '❗ Failed to load list.');
        }
        return new Response('ok');
      }

      // ---- WebApp sendData (from Telegram client) ----
      if (msg?.web_app_data?.data) {
        try {
          const p = JSON.parse(msg.web_app_data.data);
          if (p?.type === 'book') {
            const chat_id = String(p.chat_id);
            const date = String(p.date);
            const uid  = Number(p.user_id) || (msg.from?.id ?? 0);
            const uname = (p.user_name && String(p.user_name).trim()) || fullName(msg.from);
            await env.DB.prepare(
              'INSERT INTO bookings(chat_id,date,user_id,user_name) VALUES (?1,?2,?3,?4)'
            ).bind(chat_id, date, uid, uname).run().catch(() => {});
          }
        } catch (e) { console.error('web_app_data fail', e); }
        return new Response('ok');
      }

      return new Response('ok');
    }

    return new Response('Not found', { status: 404 });
  }
};
