/**
 * Cloudflare Worker — Telegram Group Calendar
 * Функции: Mini App + D1 + fallback /ingest + /open + /list + /listall + /lang + /cancel + /board + закреп-доска + i18n
 *
 * Workers → Settings:
 *   Secrets: BOT_TOKEN
 *   Text   : BOT_USERNAME  (без @)
 *            PAGES_URL     (https://<your>.pages.dev)
 *   D1     : DB
 *
 * D1 (одной строкой на таблицу):
 *   CREATE TABLE IF NOT EXISTS bookings(chat_id TEXT NOT NULL,date TEXT NOT NULL,user_id INTEGER NOT NULL,user_name TEXT,ts TEXT NOT NULL DEFAULT (datetime('now')),PRIMARY KEY(chat_id,date));
 *   CREATE TABLE IF NOT EXISTS boards(chat_id TEXT NOT NULL,topic_id INTEGER,message_id INTEGER NOT NULL,PRIMARY KEY(chat_id,topic_id));
 *   CREATE TABLE IF NOT EXISTS chat_prefs(chat_id TEXT PRIMARY KEY,lang TEXT NOT NULL DEFAULT 'ru');
 */

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const pagesBase = (env.PAGES_URL || '').replace(/\/+$/, '');

    // ===== Core helpers =======================================================
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

    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    };

    const threadExtra = (topicId) =>
      Number.isFinite(topicId) ? { message_thread_id: topicId } : {};

    // ===== i18n ===============================================================
    const T = {
      ru: {
        open_in_dm: 'Откройте календарь по кнопке — он запустится в ЛС с ботом:',
        board_title: '📌 Бронирования',
        none: 'Пока нет броней.',
        taken: (d, u) => `✅ День ${d} занят пользователем ${u}.`,
        busy:  (d, u) => `❌ День ${d} уже занят (${u}).`,
        canceled_ok: (d) => `🗑️ Бронь на ${d} снята.`,
        canceled_denied: (d) => `⛔ Вы не владелец брони ${d}.`,
        canceled_absent: (d) => `🙈 Брони на ${d} не найдено.`,
        list_header: 'Занятые дни:',
        wrong_format: 'Использование: /cancel YYYY-MM-DD',
        lang_set: (l) => `Язык чата: ${l}`,
      },
      en: {
        open_in_dm: 'Open the calendar via the button — it will launch in DM:',
        board_title: '📌 Bookings',
        none: 'No bookings yet.',
        taken: (d, u) => `✅ ${d} booked by ${u}.`,
        busy:  (d, u) => `❌ ${d} already booked by ${u}.`,
        canceled_ok: (d) => `🗑️ Booking for ${d} removed.`,
        canceled_denied: (d) => `⛔ You don’t own the booking for ${d}.`,
        canceled_absent: (d) => `🙈 No booking found for ${d}.`,
        list_header: 'Booked days:',
        wrong_format: 'Usage: /cancel YYYY-MM-DD',
        lang_set: (l) => `Chat language: ${l}`,
      },
      ja: {
        open_in_dm: 'ボタンから開くとDMで起動します：',
        board_title: '📌 予約一覧',
        none: 'まだ予約はありません。',
        taken: (d, u) => `✅ ${d} は ${u} が予約しました。`,
        busy:  (d, u) => `❌ ${d} は既に予約済み（${u}）。`,
        canceled_ok: (d) => `🗑️ ${d} の予約を取り消しました。`,
        canceled_denied: (d) => `⛔ ${d} の予約者ではありません。`,
        canceled_absent: (d) => `🙈 ${d} の予約は見つかりません。`,
        list_header: '予約済みの日付：',
        wrong_format: '使い方: /cancel YYYY-MM-DD',
        lang_set: (l) => `チャットの言語: ${l}`,
      },
    };

    const tr = (t, key, ...args) => {
      const v = t[key];
      return typeof v === 'function' ? v(...args) : v;
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

    const lsend = async (env, chatId, t, key, args = [], extra = {}) =>
      sendText(env, chatId, tr(t, key, ...(args || [])), extra);

    // ===== Board (pinned message) =============================================
    const getBookings = async (env, chatId) => {
      return (await env.DB
        .prepare('SELECT date, user_name FROM bookings WHERE chat_id=? ORDER BY date')
        .bind(String(chatId)).all()).results || [];
    };

    // дополнительные хелперы для выборки «с сегодняшнего дня»
    const todayISO = () => (new Date()).toISOString().slice(0, 10);
    const getBookingsSince = async (env, chatId, fromDate) => {
      return (await env.DB
        .prepare('SELECT date, user_name FROM bookings WHERE chat_id=? AND date>=? ORDER BY date')
        .bind(String(chatId), fromDate).all()).results || [];
    };

    const renderBoard = async (env, chatId, t) => {
      const rows = await getBookings(env, chatId);
      if (!rows.length) return `${t.board_title}\n\n${t.none}`;
      const lines = rows.map(r => `${r.date} — ${r.user_name}`);
      return `${t.board_title}\n\n${t.list_header}\n${lines.join('\n')}`;
    };

    async function ensureBoard(env, chatId, topicId, t) {
      const exist = await env.DB.prepare(
        'SELECT message_id FROM boards WHERE chat_id=?1 AND IFNULL(topic_id,-1)=IFNULL(?2,-1)'
      ).bind(String(chatId), topicId ?? null).first();
      if (exist?.message_id) return exist.message_id;

      const text = await renderBoard(env, chatId, t);
      const resp = await api(env.BOT_TOKEN, 'sendMessage', {
        chat_id: chatId, text,
        parse_mode: 'HTML', disable_web_page_preview: true,
        ...(Number.isFinite(topicId) ? { message_thread_id: topicId } : {})
      });
      const data = await resp.json().catch(() => ({}));
      const mid = data?.result?.message_id;
      if (!mid) return null;

      await env.DB.prepare(
        'INSERT INTO boards(chat_id,topic_id,message_id) VALUES(?1,?2,?3)'
      ).bind(String(chatId), topicId ?? null, mid).run();

      try {
        await api(env.BOT_TOKEN, 'pinChatMessage', {
          chat_id: chatId, message_id: mid,
          ...(Number.isFinite(topicId) ? { message_thread_id: topicId } : {}),
          disable_notification: true
        });
      } catch {}
      return mid;
    }

    // устойчивая версия: редактируем, а если не вышло — создаём новый и закрепляем
    async function updateBoard(env, chatId, topicId, t) {
      const row = await env.DB.prepare(
        'SELECT message_id FROM boards WHERE chat_id=?1 AND IFNULL(topic_id,-1)=IFNULL(?2,-1)'
      ).bind(String(chatId), topicId ?? null).first();

      let message_id = row?.message_id || null;
      const text = await renderBoard(env, chatId, t);

      if (message_id) {
        const resp = await api(env.BOT_TOKEN, 'editMessageText', {
          chat_id: chatId, message_id, text,
          parse_mode: 'HTML', disable_web_page_preview: true
        });
        const data = await resp.json().catch(() => ({}));
        if (!data?.ok) message_id = null; // потерян / не редактируется → создаём заново
      }

      if (!message_id) {
        const resp2 = await api(env.BOT_TOKEN, 'sendMessage', {
          chat_id: chatId, text,
          parse_mode: 'HTML', disable_web_page_preview: true,
          ...(Number.isFinite(topicId) ? { message_thread_id: topicId } : {})
        });
        const data2 = await resp2.json().catch(() => ({}));
        const mid = data2?.result?.message_id;
        if (!mid) return;

        message_id = mid;

        await env.DB.prepare(
          'INSERT INTO boards(chat_id,topic_id,message_id) VALUES(?1,?2,?3) ' +
          'ON CONFLICT(chat_id,topic_id) DO UPDATE SET message_id=excluded.message_id'
        ).bind(String(chatId), topicId ?? null, message_id).run();

        try {
          await api(env.BOT_TOKEN, 'pinChatMessage', {
            chat_id: chatId, message_id,
            ...(Number.isFinite(topicId) ? { message_thread_id: topicId } : {}),
            disable_notification: true
          });
        } catch {}
      }
    }

    // ===== Auth helpers =======================================================
    async function isAdminInChat(env, chat, from, sender_chat) {
      if (sender_chat && sender_chat.id === chat.id) return true; // анонимный админ
      if (from?.id) {
        try {
          const r = await api(env.BOT_TOKEN, 'getChatMember',
            { chat_id: chat.id, user_id: from.id });
          const d = await r.json();
          const status = d?.result?.status;
          return (status === 'creator' || status === 'administrator');
        } catch {}
      }
      return false;
    }

    function isOwnerOfBooking(row, from) {
      const userId = from?.id ?? null;
      if (userId !== null && row.user_id === userId) return true;
      if (row.user_id === 0) {
        const a = (row.user_name || '').trim().toLowerCase();
        const b = (fullName(from) || '').trim().toLowerCase();
        if (a && b && a === b) return true;
      }
      return false;
    }

    // ===== Health/diagnostics =================================================
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

    // Диагностика: отправить deep-link в группу
    if (req.method === 'GET' && url.pathname === '/simulate-open') {
      const chatId = url.searchParams.get('chat_id');
      const topicId = url.searchParams.get('topic_id');
      if (!chatId) return new Response('chat_id is required', { status: 400 });

      const payload = `G${chatId}` + (topicId ? `_T${topicId}` : '');
      const deepLink = `https://t.me/${env.BOT_USERNAME}?start=${encodeURIComponent(payload)}`;

      await sendText(env, chatId, T.ru.open_in_dm, {
        reply_markup: { inline_keyboard: [[{ text: '📬 Открыть в ЛС', url: deepLink }]] },
        ...threadExtra(Number(topicId))
      });
      return new Response('ok');
    }

    // ===== Fallback endpoint for Mini App ====================================
    if (url.pathname === '/ingest') {
      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: cors });
      }
      if (req.method === 'POST') {
        try {
          const p = await req.json();
          if (p?.type !== 'book') return new Response('ok', { headers: cors });

          const chat_id = String(p.chat_id);
          const date = String(p.date);
          const t = await getT(env, chat_id);
          const topicIdNum = Number(p.topic_id);
          const uid = Number(p.user_id) || 0;
          const uname = (p.user_name && String(p.user_name).trim()) || 'через WebApp';

          if (!env.DB) return new Response('ok', { headers: cors });

          try {
            await env.DB.prepare(
              'INSERT INTO bookings(chat_id,date,user_id,user_name) VALUES (?1,?2,?3,?4)'
            ).bind(chat_id, date, uid, uname).run();

            await sendText(env, chat_id, tr(t,'taken', date, uname), threadExtra(topicIdNum));
            try { await updateBoard(env, chat_id, topicIdNum, t); } catch {}
          } catch {
            const row = await env.DB
              .prepare('SELECT user_name FROM bookings WHERE chat_id=?1 AND date=?2')
              .bind(chat_id, date).first();
            await sendText(env, chat_id,
              tr(t,'busy', date, row?.user_name || 'кто-то'), threadExtra(topicIdNum));
          }
        } catch (e) { console.error('ingest fail', e); }
        return new Response('ok', { headers: cors });
      }
    }

    // ===== Telegram webhook ===================================================
    if (req.method === 'POST' && url.pathname.startsWith('/webhook/')) {
      const pathToken = url.pathname.split('/').pop();
      if (!env.BOT_TOKEN || pathToken !== env.BOT_TOKEN) return new Response('ok');

      let update; try { update = await req.json(); } catch { return new Response('ok'); }
      const msg = update?.message;

      // --- /open (в группе) → deep-link в ЛС
      if (msg?.text && /^\/open(\@\w+)?/.test(msg.text)) {
        const chat = msg.chat;
        const threadId = msg.message_thread_id;
        const t = await getT(env, chat.id);

        if (chat?.type === 'group' || chat?.type === 'supergroup') {
          const payload = `G${chat.id}` + (threadId ? `_T${threadId}` : '');
          const deepLink = `https://t.me/${env.BOT_USERNAME}?start=${encodeURIComponent(payload)}`;
          await sendText(env, chat.id, tr(t,'open_in_dm'), {
            reply_markup: { inline_keyboard: [[{ text: '📬 Открыть в ЛС', url: deepLink }]] },
            ...threadExtra(threadId)
          });
        } else {
          await sendText(env, chat.id, 'Команду /open нужно вызывать в группе.');
        }
        return new Response('ok');
      }

      // --- /list  → будущие (сегодня и дальше, UTC)
      if (msg?.text && /^\/list(\@\w+)?$/.test(msg.text.trim())) {
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
          const since = todayISO();
          const rows = await getBookingsSince(env, chat.id, since);
          const text = rows.length
            ? tr(t,'list_header') + '\n' + rows.map(r => `${r.date} — ${r.user_name}`).join('\n')
            : tr(t,'none');
          await sendText(env, chat.id, text, threadExtra(threadId));

          try { await updateBoard(env, chat.id, threadId, t); } catch {}
        } catch (e) {
          console.error('D1 list (future) fail', e);
          await sendText(env, chat.id, '❗ Не удалось получить список (DB).', threadExtra(threadId));
        }
        return new Response('ok');
      }

      // --- /listall  → все
      if (msg?.text && /^\/listall(\@\w+)?$/.test(msg.text.trim())) {
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

          try { await updateBoard(env, chat.id, threadId, t); } catch {}
        } catch (e) {
          console.error('D1 listall fail', e);
          await sendText(env, chat.id, '❗ Не удалось получить список (DB).', threadExtra(threadId));
        }
        return new Response('ok');
      }

      // --- /board [rebuild]  (только админ)
      if (msg?.text && /^\/board(\@\w+)?(\s+rebuild)?/i.test(msg.text)) {
        const chat = msg.chat;
        const threadId = msg.message_thread_id;
        const from = msg.from;
        const senderChat = msg.sender_chat;
        const t = await getT(env, chat.id);

        const isAdmin = await isAdminInChat(env, chat, from, senderChat);
        if (!isAdmin) {
          await sendText(env, chat.id, '⛔ Только администратор может управлять доской.', threadExtra(threadId));
          return new Response('ok');
        }

        const m = msg.text.trim().match(/^\/board(?:@\w+)?\s+(rebuild)$/i);
        const force = !!m;

        if (force && env.DB) {
          await env.DB.prepare(
            'DELETE FROM boards WHERE chat_id=?1 AND IFNULL(topic_id,-1)=IFNULL(?2,-1)'
          ).bind(String(chat.id), threadId ?? null).run();
        }

        try {
          await updateBoard(env, chat.id, threadId, t);
          await sendText(env, chat.id, force ? '🔁 Доска пересоздана.' : '✅ Доска обновлена.', threadExtra(threadId));
        } catch (e) {
          console.error('board update fail', e);
          await sendText(env, chat.id, '❗ Не удалось обновить доску.', threadExtra(threadId));
        }
        return new Response('ok');
      }

      // --- /lang ru|en|ja
      if (msg?.text && /^\/lang(\@\w+)?\s+/.test(msg.text)) {
        const chat = msg.chat;
        const threadId = msg.message_thread_id;
        const m = msg.text.trim().match(/^\/lang(?:@\w+)?\s+(ru|en|ja)$/i);
        if (!m) { await sendText(env, chat.id, 'Usage: /lang ru|en|ja', threadExtra(threadId)); return new Response('ok'); }
        const lang = m[1].toLowerCase();
        if (env.DB) await setLang(env, chat.id, lang);
        const t = await getT(env, chat.id);
        await sendText(env, chat.id, tr(t,'lang_set', lang), threadExtra(threadId));
        try { await updateBoard(env, chat.id, threadId, t); } catch {}
        return new Response('ok');
      }

      // --- /cancel YYYY-MM-DD
      if (msg?.text && /^\/cancel(\@\w+)?\s+/.test(msg.text)) {
        const chat = msg.chat;
        const threadId = msg.message_thread_id;
        const from = msg.from;
        const senderChat = msg.sender_chat;
        const t = await getT(env, chat.id);

        const m = msg.text.trim().match(/^\/cancel(?:@\w+)?\s+(\d{4}-\d{2}-\d{2})$/);
        if (!m) { await sendText(env, chat.id, tr(t,'wrong_format'), threadExtra(threadId)); return new Response('ok'); }
        const date = m[1];
        if (!env.DB) return new Response('ok');

        const row = await env.DB.prepare(
          'SELECT user_id, user_name FROM bookings WHERE chat_id=?1 AND date=?2'
        ).bind(String(chat.id), date).first();

        if (!row) { await sendText(env, chat.id, tr(t,'canceled_absent', date), threadExtra(threadId)); return new Response('ok'); }

        const owner = isOwnerOfBooking(row, from);
        const admin = await isAdminInChat(env, chat, from, senderChat);

        if (!(owner || admin)) {
          await sendText(env, chat.id, tr(t,'canceled_denied', date), threadExtra(threadId));
          return new Response('ok');
        }

        await env.DB.prepare(
          'DELETE FROM bookings WHERE chat_id=?1 AND date=?2'
        ).bind(String(chat.id), date).run();

        await sendText(env, chat.id, tr(t,'canceled_ok', date), threadExtra(threadId));
        try { await updateBoard(env, chat.id, threadId, t); } catch {}
        return new Response('ok');
      }

      // --- /start в ЛС → web_app-кнопка
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
            text: 'Откройте календарь и выберите день:',
            reply_markup: { inline_keyboard: [[{ text: '📅 Open Calendar', web_app: { url: openUrl } }]] }
          });
        } else {
          await sendText(env, msg.chat.id,
            'Это приватный чат с ботом. Запустите /open в группе, чтобы получить ссылку сюда.');
        }
        return new Response('ok');
      }

      // --- WebApp → sendData
      if (msg?.web_app_data?.data) {
        try {
          const p = JSON.parse(msg.web_app_data.data);
          if (p?.type !== 'book') return new Response('ok');

          const chat_id = String(p.chat_id);
          const date = String(p.date);
          const t = await getT(env, chat_id);
          const topicIdNum = Number(p.topic_id);
          const uid = Number(p.user_id) || (msg.from?.id ?? 0);
          const uname = (p.user_name && String(p.user_name).trim()) || fullName(msg.from);

          if (!env.DB) { await sendText(env, chat_id, '❗ База данных не привязана (DB).', threadExtra(topicIdNum)); return new Response('ok'); }

          try {
            await env.DB.prepare(
              'INSERT INTO bookings(chat_id,date,user_id,user_name) VALUES (?1,?2,?3,?4)'
            ).bind(chat_id, date, uid, uname).run();

            await sendText(env, chat_id, tr(t,'taken', date, uname), threadExtra(topicIdNum));
            try { await updateBoard(env, chat_id, topicIdNum, t); } catch {}
          } catch {
            const row = await env.DB
              .prepare('SELECT user_name FROM bookings WHERE chat_id=?1 AND date=?2')
              .bind(chat_id, date).first();
            await sendText(env, chat_id, tr(t,'busy', date, row?.user_name || 'кто-то'), threadExtra(topicIdNum));
          }
        } catch (e) { console.error('web_app_data parse fail', e); }
        return new Response('ok');
      }

      return new Response('ok');
    }

    return new Response('Not found', { status: 404 });
  }
};
