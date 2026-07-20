require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const { connectDB, getSessionModel, getMessageModel } = require('./db');
const { connectRedis, getRedisClient } = require('./redis');

// ─────────────────────────────────────────────────
// Persistent Telegram message → session ID map
// So reply-to routing survives server restarts
// ─────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, '..', 'data');
const TGMAP_FILE = path.join(DATA_DIR, 'telegram_map.json');

function loadTelegramMap() {
  try {
    if (fs.existsSync(TGMAP_FILE)) {
      const raw = fs.readFileSync(TGMAP_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('⚠️  Could not load telegram_map.json:', e.message);
  }
  return {};
}

function saveTelegramMap() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TGMAP_FILE, JSON.stringify(global.telegramMsgMap, null, 2), 'utf8');
  } catch (e) {
    console.error('❌ Failed to save telegram_map.json:', e.message);
  }
}

global.telegramMsgMap = loadTelegramMap();
console.log(`✅ Loaded Telegram message map: ${Object.keys(global.telegramMsgMap).length} entries`);

const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST']
}));

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

app.get('/api/sessions', async (req, res) => {
  try {
    const Session = getSessionModel();
    const sessions = await Session.find({});
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    res.json(sessions);
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

app.get('/api/sessions/:id/messages', async (req, res) => {
  try {
    const Message = getMessageModel();
    const messages = await Message.find({ sessionId: req.params.id });
    messages.sort((a, b) => a.createdAt - b.createdAt);
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.post('/api/sessions', async (req, res) => {
  const { sessionId, name, email, userAgent, platform } = req.body;
  if (!sessionId || !name) {
    return res.status(400).json({ error: 'sessionId and name are required' });
  }

  try {
    const Session = getSessionModel();
    let session = await Session.findOne({ sessionId });
    
    if (!session) {
      session = await Session.create({
        sessionId,
        name,
        email: email || '',
        userAgent: userAgent || '',
        platform: platform || '',
        status: 'waiting',
        agentId: null
      });
    }
    res.json(session);
  } catch (error) {
    console.error('Error creating/fetching session:', error);
    res.status(500).json({ error: 'Failed to manage session' });
  }
});

app.post('/api/sessions/contact-form', async (req, res) => {
  const { name, email, message, userAgent, platform } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'name, email, and message are required' });
  }

  const sessionId = 'offline_' + Math.random().toString(36).substr(2, 9);

  try {
    const Session = getSessionModel();
    const Message = getMessageModel();

    const session = await Session.create({
      sessionId,
      name,
      email,
      userAgent: userAgent || '',
      platform: platform || '',
      status: 'waiting',
      agentId: null
    });

    const savedMsg = await Message.create({
      sessionId,
      sender: 'customer',
      text: `[Offline Form] Email: ${email}\nMessage: ${message}`
    });

    io.to('agents').emit('queue_update');

    // Notify via Telegram
    const dashboardLink = process.env.DASHBOARD_URL ? `\n\n[Open Dashboard](${process.env.DASHBOARD_URL})` : '';
    sendTelegramMessage(`✉️ *Offline Contact Form*\n*Name:* ${name}\n*Email:* ${email}\n\n*Message:*\n${message}${dashboardLink}`, sessionId);
    
    res.json({ success: true, sessionId, session, message: savedMsg });
  } catch (error) {
    console.error('Error handling offline contact form:', error);
    res.status(500).json({ error: 'Failed to submit form' });
  }
});

app.post('/api/sessions/:id/close', async (req, res) => {
  try {
    const Session = getSessionModel();
    const session = await Session.findOneAndUpdate(
      { sessionId: req.params.id },
      { status: 'closed' },
      { new: true }
    );
    io.to('agents').emit('queue_update');
    io.to(`room_${req.params.id}`).emit('session_closed', { sessionId: req.params.id });
    res.json(session);
  } catch (error) {
    console.error('Error closing session:', error);
    res.status(500).json({ error: 'Failed to close session' });
  }
});

app.post('/api/sessions/:id/claim', async (req, res) => {
  const { agentId } = req.body;
  if (!agentId) {
    return res.status(400).json({ error: 'agentId is required' });
  }
  try {
    const Session = getSessionModel();
    const session = await Session.findOneAndUpdate(
      { sessionId: req.params.id },
      { status: 'active', agentId },
      { new: true }
    );
    io.to('agents').emit('queue_update');
    io.to(`room_${req.params.id}`).emit('session_claimed', session);
    res.json(session);
  } catch (error) {
    console.error('Error claiming session:', error);
    res.status(500).json({ error: 'Failed to claim session' });
  }
});

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  // Use polling first so Serveo tunnel interstitial bypass works,
  // then upgrade to WebSocket
  transports: ['polling', 'websocket'],
  allowEIO3: true
});

async function getAgentCount() {
  const redis = getRedisClient();
  return await redis.scard('active_agents');
}

async function sendTelegramMessage(text, sessionId = null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
      })
    });
    if (response.ok) {
      const result = await response.json();
      if (result.ok && result.result && sessionId) {
        const messageId = result.result.message_id;
        const redis = getRedisClient();
        if (redis && typeof redis.set === 'function') {
          await redis.set(`telegram_msg_${messageId}`, sessionId, 'EX', 86400);
        }
        // Always also persist in the file-backed map
        global.telegramMsgMap[messageId] = sessionId;
        saveTelegramMap();
        console.log(`✅ Mapped Telegram message ${messageId} → session ${sessionId}`);
      }
    } else {
      console.error('Telegram notification failed:', await response.text());
    }
  } catch (error) {
    console.error('Telegram notification error:', error);
  }
}

let lastUpdateId = 0;

async function pollTelegramUpdates() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("⚠️ Telegram Bot Token is missing in process.env, skipping poll...");
    setTimeout(pollTelegramUpdates, 5000);
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      if (data.ok && data.result && data.result.length > 0) {
        console.log(`📡 Polled ${data.result.length} new update(s) from Telegram`);
        for (const update of data.result) {
          lastUpdateId = update.update_id;
          await handleTelegramUpdate(update);
        }
      }
    } else {
      console.error('❌ Telegram polling HTTP error:', response.status, await response.text());
    }
  } catch (error) {
    console.error('❌ Error polling Telegram updates:', error);
  }
  setTimeout(pollTelegramUpdates, 1000);
}

async function handleTelegramUpdate(update) {
  console.log("📥 Processing Telegram update:", JSON.stringify(update));
  const message = update.message;
  if (!message || !message.text) {
    console.log("⚠️ Received Telegram update without message or text content");
    return;
  }

  const chatId = message.chat.id.toString();
  const allowedChatId = process.env.TELEGRAM_CHAT_ID ? process.env.TELEGRAM_CHAT_ID.toString() : null;
  
  console.log(`👤 Telegram Message from Chat ID: ${chatId} (Configured allowed Chat ID: ${allowedChatId})`);
  
  if (chatId !== allowedChatId) {
    console.log(`❌ Ignored message: Chat ID mismatch.`);
    return;
  }

  let text = message.text;
  let targetSessionId = null;

  // Handle /sessions command - list all sessions
  if (text.trim() === '/sessions') {
    try {
      const Session = getSessionModel();
      const sessions = await Session.find({});
      if (!sessions || sessions.length === 0) {
        await sendTelegramMessage('📭 No sessions found.');
      } else {
        const sorted = sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        const lines = sorted.map((s, i) => `${i + 1}. [${s.status.toUpperCase()}] ${s.name} — \`${s.sessionId}\``);
        await sendTelegramMessage(`📋 *Active Sessions:*\n${lines.join('\n')}\n\nTo reply: /reply <sessionId> <message>`);
      }
    } catch (e) {
      await sendTelegramMessage('❌ Error fetching sessions: ' + e.message);
    }
    return;
  }

  // 1. Check if this is a reply to a bot notification message
  if (message.reply_to_message) {
    const replyMsgId = message.reply_to_message.message_id;
    console.log(`🔄 Message is a reply to Telegram Message ID: ${replyMsgId}`);
    const redis = getRedisClient();
    if (redis && typeof redis.get === 'function') {
      targetSessionId = await redis.get(`telegram_msg_${replyMsgId}`);
    } else {
      targetSessionId = global.telegramMsgMap ? global.telegramMsgMap[replyMsgId] : null;
    }
    console.log(`📍 Resolved reply to session ID: ${targetSessionId || 'NOT FOUND (map may have been cleared on restart)'}`);
  }

  // 2. Manual command: /reply <sessionId> <message>
  if (!targetSessionId) {
    const match = text.match(/^\/reply\s+(\S+)\s+(.+)$/i);
    if (match) {
      targetSessionId = match[1];
      text = match[2];
      console.log(`📍 Parsed manual /reply command for session ID: ${targetSessionId}`);
    }
  }

  // 3. Fallback: find most recently updated session (any status including waiting)
  if (!targetSessionId) {
    try {
      const Session = getSessionModel();
      const sessions = await Session.find({});
      console.log(`🔍 Fallback search: total sessions = ${sessions ? sessions.length : 0}`);
      if (sessions && sessions.length > 0) {
        // First try non-closed
        const nonClosed = sessions.filter(s => s.status !== 'closed')
          .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        if (nonClosed.length > 0) {
          targetSessionId = nonClosed[0].sessionId;
          console.log(`📍 Fallback: selected most recent non-closed session: ${targetSessionId}`);
        } else {
          // All closed — still pick the most recent one
          const anySorted = [...sessions].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
          targetSessionId = anySorted[0].sessionId;
          console.log(`📍 Fallback: all sessions closed, selected most recent anyway: ${targetSessionId}`);
        }
      }
    } catch (e) {
      console.error('❌ Error finding fallback session:', e);
    }
  }

  if (!targetSessionId) {
    console.log("❌ No sessions found at all.");
    await sendTelegramMessage(
      "❌ No sessions found. The server may have restarted and lost in-memory data.\n\n" +
      "Ask your customer to send a message first, then reply to the bot notification.\n\n" +
      "Or use: /sessions to list sessions, then /reply <sessionId> <message>"
    );
    return;
  }

  try {
    const Message = getMessageModel();
    const Session = getSessionModel();

    // Create the agent message
    const savedMsg = await Message.create({
      sessionId: targetSessionId,
      sender: 'agent',
      text: text
    });

    // Update the session's updatedAt time
    await Session.findOneAndUpdate(
      { sessionId: targetSessionId },
      { updatedAt: new Date() }
    );

    // Broadcast message to room and agent panels
    io.to(`room_${targetSessionId}`).emit('agent_message_received', savedMsg);
    io.to('agents').emit('agent_message_received', savedMsg);
    io.to('agents').emit('queue_update');

    console.log(`Forwarded Telegram reply to customer (${targetSessionId}): ${text}`);
  } catch (error) {
    console.error('Failed to forward Telegram message:', error);
    await sendTelegramMessage(`❌ Failed to send message: ${error.message}`);
  }
}

io.on('connection', async (socket) => {
  const { role, sessionId } = socket.handshake.query;
  const redis = getRedisClient();

  if (role === 'agent') {
    console.log(`Agent connected: socket.id = ${socket.id}`);
    await redis.sadd('active_agents', socket.id);
    socket.join('agents');
    
    const agentCount = await getAgentCount();
    console.log(`Agents online: ${agentCount}`);
    io.emit('agents_online', agentCount > 0);
    
    socket.on('agent_join', (sessionRoomId) => {
      socket.join(`room_${sessionRoomId}`);
      console.log(`Agent ${socket.id} joined room_${sessionRoomId}`);
    });

    socket.on('agent_leave', (sessionRoomId) => {
      socket.leave(`room_${sessionRoomId}`);
      console.log(`Agent ${socket.id} left room_${sessionRoomId}`);
    });
  } 
  else if (role === 'customer' && sessionId) {
    console.log(`Customer connected: sessionId = ${sessionId}, socket.id = ${socket.id}`);
    socket.join(`room_${sessionId}`);

    // Auto-create session if not exists (fallback if POST /api/sessions was blocked by tunnel)
    try {
      const Session = getSessionModel();
      const existing = await Session.findOne({ sessionId });
      if (!existing) {
        // Extract name from socket query if present, else use 'Customer'
        const customerName = socket.handshake.query.name || 'Customer';
        await Session.create({
          sessionId,
          name: customerName,
          email: socket.handshake.query.email || '',
          status: 'waiting'
        });
        console.log(`✅ Auto-created session record for: ${sessionId}`);
        io.to('agents').emit('queue_update');
      }
    } catch (e) {
      console.error('Error auto-creating session on connect:', e);
    }

    const agentCount = await getAgentCount();
    socket.emit('agents_online', agentCount > 0);
  }

  socket.on('client_message', async (payload) => {
    const { roomId, text, name: payloadName, email: payloadEmail } = payload.data || payload;
    if (!roomId || !text) return;

    try {
      const Message = getMessageModel();
      const Session = getSessionModel();

      const message = await Message.create({
        sessionId: roomId,
        sender: 'customer',
        text
      });

      let session = await Session.findOne({ sessionId: roomId });
      if (!session) {
        // Session missing (e.g. POST /api/sessions failed) — auto-create it
        const customerName = payloadName || socket.handshake.query.name || 'Customer';
        session = await Session.create({
          sessionId: roomId,
          name: customerName,
          email: payloadEmail || socket.handshake.query.email || '',
          status: 'waiting'
        });
        console.log(`✅ Auto-created session on first message for: ${roomId}`);
      } else {
        const updateData = { updatedAt: new Date() };
        if (session.status === 'closed') {
          updateData.status = 'waiting';
        }
        session = await Session.findOneAndUpdate({ sessionId: roomId }, updateData, { new: true });
      }

      io.to(`room_${roomId}`).emit('client_message_received', message);
      io.to('agents').emit('queue_update');

      // Notify via Telegram
      const customerName = session ? session.name : 'Customer';
      const statusText = session && session.status === 'waiting' ? ' (Waiting Queue)' : '';
      const dashboardLink = process.env.DASHBOARD_URL ? `\n\n[Open Dashboard](${process.env.DASHBOARD_URL})` : '';
      sendTelegramMessage(`💬 *New message from ${customerName}${statusText}*\n\n${text}${dashboardLink}`, roomId);
    } catch (error) {
      console.error('Error handling client message:', error);
    }
  });

  socket.on('agent_message', async (payload) => {
    const { roomId, text, agentId } = payload.data || payload;
    if (!roomId || !text) return;

    try {
      const Message = getMessageModel();
      const Session = getSessionModel();

      const message = await Message.create({
        sessionId: roomId,
        sender: 'agent',
        text
      });

      await Session.findOneAndUpdate(
        { sessionId: roomId },
        { 
          status: 'active', 
          agentId: agentId || 'Agent', 
          updatedAt: new Date() 
        }
      );

      io.to(`room_${roomId}`).emit('agent_message_received', message);
      io.to('agents').emit('queue_update');
    } catch (error) {
      console.error('Error handling agent message:', error);
    }
  });

  socket.on('typing_start', (payload) => {
    const { roomId, sender } = payload;
    if (!roomId || !sender) return;
    socket.to(`room_${roomId}`).emit('typing_start', { roomId, sender });
  });

  socket.on('typing_stop', (payload) => {
    const { roomId, sender } = payload;
    if (!roomId || !sender) return;
    socket.to(`room_${roomId}`).emit('typing_stop', { roomId, sender });
  });

  socket.on('message_read', async (payload) => {
    const { roomId, sender } = payload;
    if (!roomId || !sender) return;

    try {
      const Message = getMessageModel();
      const oppositeSender = sender === 'customer' ? 'agent' : 'customer';
      const readAt = new Date();
      
      await Message.updateMany(
        { sessionId: roomId, sender: oppositeSender, readAt: null },
        { $set: { readAt } }
      );

      io.to(`room_${roomId}`).emit('messages_marked_read', { roomId, reader: sender, readAt });
      io.to('agents').emit('queue_update');
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  });

  socket.on('disconnect', async () => {
    if (role === 'agent') {
      console.log(`Agent disconnected: socket.id = ${socket.id}`);
      await redis.srem('active_agents', socket.id);
      
      const agentCount = await getAgentCount();
      console.log(`Agents online: ${agentCount}`);
      io.emit('agents_online', agentCount > 0);
    } else {
      console.log(`Customer disconnected: socket.id = ${socket.id}`);
    }
  });
});

const PORT = process.env.PORT || 5000;

async function bootstrap() {
  await connectDB();
  await connectRedis();
  
  server.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`🚀 Live Chat Server running on port ${PORT}`);
    console.log(`=========================================`);
    pollTelegramUpdates();
  });
}

bootstrap().catch(err => {
  console.error('Server boot failed:', err);
  process.exit(1);
});
