const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const sessionSchemaStructure = {
  sessionId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, default: '' },
  status: { type: String, enum: ['active', 'waiting', 'closed'], default: 'waiting' },
  agentId: { type: String, default: null },
  userAgent: { type: String, default: '' },
  platform: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
};

const messageSchemaStructure = {
  sessionId: { type: String, required: true },
  sender: { type: String, enum: ['customer', 'agent'], required: true },
  text: { type: String, required: true },
  readAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
};

let Session;
let Message;
let isUsingMock = false;

// ──────────────────────────────────────────────
// FILE-BACKED PERSISTENT MOCK STORE
// ──────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadFromDisk() {
  ensureDataDir();
  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      // Convert date strings back to Date objects
      if (parsed.sessions) {
        parsed.sessions = parsed.sessions.map(s => ({
          ...s,
          createdAt: new Date(s.createdAt),
          updatedAt: new Date(s.updatedAt)
        }));
      }
      if (parsed.messages) {
        parsed.messages = parsed.messages.map(m => ({
          ...m,
          createdAt: new Date(m.createdAt),
          readAt: m.readAt ? new Date(m.readAt) : null
        }));
      }
      console.log(`✅ Loaded persistent store: ${(parsed.sessions || []).length} sessions, ${(parsed.messages || []).length} messages`);
      return parsed;
    } catch (e) {
      console.warn('⚠️  Failed to parse db.json, starting fresh:', e.message);
    }
  }
  return { sessions: [], messages: [] };
}

let saveTimer = null;
function saveToDisk() {
  // Debounce writes — only write once per 500ms burst
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      ensureDataDir();
      fs.writeFileSync(DB_FILE, JSON.stringify(mockStore, null, 2), 'utf8');
    } catch (e) {
      console.error('❌ Failed to save db.json:', e.message);
    }
  }, 500);
}

const mockStore = loadFromDisk();

const mockSessionModel = {
  find: async (query = {}) => {
    let results = [...mockStore.sessions];
    if (query.status) {
      if (typeof query.status === 'object' && query.status.$in) {
        results = results.filter(s => query.status.$in.includes(s.status));
      } else {
        results = results.filter(s => s.status === query.status);
      }
    }
    return results;
  },
  findOne: async (query) => {
    return mockStore.sessions.find(s => s.sessionId === query.sessionId) || null;
  },
  findOneAndUpdate: async (query, update, options = {}) => {
    let session = mockStore.sessions.find(s => s.sessionId === query.sessionId);
    if (!session && options.upsert) {
      session = {
        sessionId: query.sessionId,
        name: update.name || 'Guest',
        email: update.email || '',
        status: update.status || 'waiting',
        agentId: update.agentId || null,
        userAgent: update.userAgent || '',
        platform: update.platform || '',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      mockStore.sessions.push(session);
      saveToDisk();
      return session;
    }
    if (session) {
      Object.assign(session, update);
      session.updatedAt = new Date();
      saveToDisk();
    }
    return session;
  },
  create: async (doc) => {
    // Prevent duplicates
    const existing = mockStore.sessions.find(s => s.sessionId === doc.sessionId);
    if (existing) return existing;
    const session = {
      sessionId: doc.sessionId,
      name: doc.name || 'Guest',
      email: doc.email || '',
      status: doc.status || 'waiting',
      agentId: doc.agentId || null,
      userAgent: doc.userAgent || '',
      platform: doc.platform || '',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    mockStore.sessions.push(session);
    saveToDisk();
    return session;
  }
};

const mockMessageModel = {
  find: async (query) => {
    return mockStore.messages.filter(m => m.sessionId === query.sessionId);
  },
  create: async (doc) => {
    const message = {
      _id: 'msg_' + Math.random().toString(36).substr(2, 9),
      sessionId: doc.sessionId,
      sender: doc.sender,
      text: doc.text,
      readAt: doc.readAt || null,
      createdAt: new Date()
    };
    mockStore.messages.push(message);
    saveToDisk();
    return message;
  },
  updateMany: async (query, update) => {
    let updatedCount = 0;
    mockStore.messages.forEach(m => {
      if (m.sessionId === query.sessionId && m.sender === query.sender && !m.readAt) {
        if (update.$set && update.$set.readAt) {
          m.readAt = update.$set.readAt;
          updatedCount++;
        }
      }
    });
    if (updatedCount > 0) saveToDisk();
    return { modifiedCount: updatedCount };
  }
};

async function connectDB() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/livechat';
  try {
    console.log('Connecting to MongoDB at:', mongoUri);
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 2000
    });
    console.log('MongoDB connected successfully.');
    
    const SessionSchema = new mongoose.Schema(sessionSchemaStructure);
    const MessageSchema = new mongoose.Schema(messageSchemaStructure);
    
    Session = mongoose.model('Session', SessionSchema);
    Message = mongoose.model('Message', MessageSchema);
    isUsingMock = false;
  } catch (error) {
    console.warn('\n⚠️  MongoDB Connection Failed:', error.message);
    console.warn('⚠️  Falling back to FILE-BACKED DATABASE MOCK (data/db.json).\n');
    Session = mockSessionModel;
    Message = mockMessageModel;
    isUsingMock = true;
  }
  return { Session, Message, isUsingMock: () => isUsingMock };
}

module.exports = {
  connectDB,
  getSessionModel: () => Session,
  getMessageModel: () => Message,
  isMock: () => isUsingMock
};
