import { create } from 'zustand';
import { io } from 'socket.io-client';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000';
let socket = null;

export const useChatStore = create((set, get) => ({
  sessionId: null,
  name: '',
  email: '',
  messages: [],
  isConnected: false,
  agentsOnline: false,
  agentTyping: false,
  sessionStatus: 'waiting',
  agentId: null,

  initSession: () => {
    if (typeof window === 'undefined') return;
    
    const storedSession = localStorage.getItem('livechat_customer_session');
    if (storedSession) {
      try {
        const { sessionId, name, email } = JSON.parse(storedSession);
        if (sessionId && name) {
          set({ sessionId, name, email });
          get().connectSocket(sessionId);
          get().fetchMessages(sessionId);
          get().fetchSessionStatus(sessionId);
        }
      } catch (e) {
        console.error('Failed to parse stored session:', e);
      }
    }
  },

  startSession: async (name, email) => {
    const sessionId = 'session_' + Math.random().toString(36).substr(2, 9);
    const sessionData = { sessionId, name, email };
    
    localStorage.setItem('livechat_customer_session', JSON.stringify(sessionData));
    set(sessionData);

    try {
      const res = await fetch(`${BACKEND_URL}/api/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'bypass-tunnel-reminder': 'true'
        },
        body: JSON.stringify({
          sessionId,
          name,
          email,
          userAgent: window.navigator.userAgent,
          platform: window.navigator.platform
        })
      });
      if (res.ok) {
        const data = await res.json();
        set({ sessionStatus: data.status, agentId: data.agentId });
      } else {
        console.warn('Session register returned non-OK:', res.status);
      }
    } catch (err) {
      console.error('Failed to register session with server:', err);
    }

    get().connectSocket(sessionId);
  },

  fetchSessionStatus: async (sessionId) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/sessions`, {
        headers: { 'bypass-tunnel-reminder': 'true' }
      });
      if (res.ok) {
        const sessions = await res.json();
        const current = sessions.find(s => s.sessionId === sessionId);
        if (current) {
          set({ sessionStatus: current.status, agentId: current.agentId });
        }
      }
    } catch (e) {
      console.error('Failed to fetch session status:', e);
    }
  },

  fetchMessages: async (sessionId) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/sessions/${sessionId}/messages`, {
        headers: { 'bypass-tunnel-reminder': 'true' }
      });
      if (res.ok) {
        const messages = await res.json();
        set({ messages });
        
        const unreadAgentMessages = messages.some(m => m.sender === 'agent' && !m.readAt);
        if (unreadAgentMessages) {
          get().markMessagesAsRead();
        }
      }
    } catch (err) {
      console.error('Failed to fetch message history:', err);
    }
  },

  connectSocket: (sessionId) => {
    if (socket) {
      socket.disconnect();
    }

    const { name, email } = get();
    socket = io(BACKEND_URL, {
      query: { role: 'customer', sessionId, name: name || 'Customer', email: email || '' },
      extraHeaders: { 'bypass-tunnel-reminder': 'true' },
      // Use polling first so Serveo interstitial bypass header is honoured
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    socket.on('connect', () => {
      set({ isConnected: true });
    });

    socket.on('disconnect', () => {
      set({ isConnected: false });
    });

    socket.on('agents_online', (online) => {
      set({ agentsOnline: online });
    });

    socket.on('client_message_received', (msg) => {
      set((state) => {
        if (state.messages.some(m => m._id === msg._id)) return state;
        return { messages: [...state.messages, msg] };
      });
    });

    socket.on('agent_message_received', (msg) => {
      set((state) => {
        if (state.messages.some(m => m._id === msg._id)) return state;
        return { messages: [...state.messages, msg] };
      });
      get().markMessagesAsRead();
    });

    socket.on('typing_start', (payload) => {
      if (payload.sender === 'agent') {
        set({ agentTyping: true });
      }
    });

    socket.on('typing_stop', (payload) => {
      if (payload.sender === 'agent') {
        set({ agentTyping: false });
      }
    });

    socket.on('messages_marked_read', ({ reader, readAt }) => {
      if (reader === 'agent') {
        set((state) => ({
          messages: state.messages.map(m => 
            m.sender === 'customer' ? { ...m, readAt } : m
          )
        }));
      }
    });

    socket.on('session_closed', () => {
      set({ sessionStatus: 'closed' });
    });

    socket.on('session_claimed', (session) => {
      set({ sessionStatus: session.status, agentId: session.agentId });
    });
  },

  sendMessage: (text) => {
    const { sessionId } = get();
    if (!sessionId) return;

    if (!socket) {
      get().connectSocket(sessionId);
    }
    socket.emit('client_message', { roomId: sessionId, text });
  },

  sendTypingStatus: (isTyping) => {
    const { sessionId, isConnected } = get();
    if (!sessionId || !socket || !isConnected) return;
    
    const event = isTyping ? 'typing_start' : 'typing_stop';
    socket.emit(event, { roomId: sessionId, sender: 'customer' });
  },

  markMessagesAsRead: () => {
    const { sessionId, isConnected } = get();
    if (!sessionId || !socket || !isConnected) return;
    
    socket.emit('message_read', { roomId: sessionId, sender: 'customer' });
  },

  sendOfflineMessage: async (name, email, message) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/sessions/contact-form`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          message,
          userAgent: window.navigator.userAgent,
          platform: window.navigator.platform
        })
      });
      if (res.ok) {
        const data = await res.json();
        const sessionData = { sessionId: data.sessionId, name, email };
        localStorage.setItem('livechat_customer_session', JSON.stringify(sessionData));
        set(sessionData);
        get().connectSocket(data.sessionId);
        get().fetchMessages(data.sessionId);
        set({ sessionStatus: data.session.status });
        return true;
      }
    } catch (e) {
      console.error('Failed to submit offline contact message:', e);
    }
    return false;
  },

  clearSession: () => {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    localStorage.removeItem('livechat_customer_session');
    set({
      sessionId: null,
      name: '',
      email: '',
      messages: [],
      isConnected: false,
      agentTyping: false,
      sessionStatus: 'waiting',
      agentId: null
    });
  }
}));
