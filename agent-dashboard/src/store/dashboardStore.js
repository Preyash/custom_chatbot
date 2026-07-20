import { create } from 'zustand';
import { io } from 'socket.io-client';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000';
let socket = null;

function triggerNotification(title, options) {
  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then((registration) => {
          registration.showNotification(title, {
            icon: '/logo.svg',
            ...options
          });
        }).catch((err) => {
          console.warn('Service worker notification failed, falling back:', err);
          fallbackNotification(title, options);
        });
      } else {
        fallbackNotification(title, options);
      }
    }
  }
}

function fallbackNotification(title, options) {
  try {
    const notification = new Notification(title, {
      icon: '/logo.svg',
      ...options
    });
    notification.onclick = () => {
      window.focus();
    };
  } catch (e) {
    console.error('Fallback notification constructor failed:', e);
  }
}

export const useDashboardStore = create((set, get) => ({
  sessions: [],
  selectedSessionId: null,
  messages: [],
  isConnected: false,
  customerTyping: false,
  agentId: 'agent_1',
  agentName: 'Admin',

  initDashboard: () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }
    get().fetchSessions();
    get().connectSocket();
  },

  fetchSessions: async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/sessions`, {
        headers: {
          'bypass-tunnel-reminder': 'true'
        }
      });
      if (res.ok) {
        const newSessions = await res.json();
        const previousSessions = get().sessions;
        const { selectedSessionId, agentId } = get();

        // Compare sessions for changes to trigger background/unselected notifications
        if (previousSessions.length > 0) {
          newSessions.forEach(newSession => {
            const oldSession = previousSessions.find(s => s.sessionId === newSession.sessionId);
            
            if (!oldSession) {
              if (newSession.status === 'waiting') {
                triggerNotification('New Chat Request', {
                  body: `${newSession.name} is waiting in the queue.`,
                });
              }
            } else if (new Date(newSession.updatedAt).getTime() !== new Date(oldSession.updatedAt).getTime()) {
              // Notification for unselected/background sessions
              if (newSession.sessionId !== selectedSessionId) {
                const isWaiting = newSession.status === 'waiting';
                const isMyChat = newSession.status === 'active' && newSession.agentId === agentId;
                
                if (isWaiting || isMyChat) {
                  triggerNotification(`New message from ${newSession.name}`, {
                    body: isWaiting ? 'Customer is waiting in the queue.' : 'Click to view the message.',
                  });
                }
              }
            }
          });
        }

        set({ sessions: newSessions });
      }
    } catch (e) {
      console.error('Failed to fetch sessions:', e);
    }
  },

  connectSocket: () => {
    if (socket) {
      socket.disconnect();
    }

    socket = io(BACKEND_URL, {
      query: { role: 'agent' },
      extraHeaders: {
        'bypass-tunnel-reminder': 'true'
      },
      // Use polling first so Serveo tunnel bypass header is honored in HTTP handshake,
      // then upgrade to WebSocket once connection is established
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

    socket.on('queue_update', () => {
      get().fetchSessions();
      
      const { selectedSessionId } = get();
      if (selectedSessionId) {
        get().fetchMessages(selectedSessionId);
      }
    });

    socket.on('client_message_received', (msg) => {
      const { selectedSessionId, sessions } = get();
      if (msg.sessionId === selectedSessionId) {
        set((state) => {
          if (state.messages.some(m => m._id === msg._id)) return state;
          return { messages: [...state.messages, msg] };
        });
        
        get().markMessagesAsRead();

        // Notification for active session if window/tab is blurred
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          const session = sessions.find(s => s.sessionId === msg.sessionId);
          const name = session ? session.name : 'Customer';
          triggerNotification(`Message from ${name}`, {
            body: msg.text,
          });
        }
      }
    });

    socket.on('agent_message_received', (msg) => {
      const { selectedSessionId } = get();
      if (msg.sessionId === selectedSessionId) {
        set((state) => {
          if (state.messages.some(m => m._id === msg._id)) return state;
          return { messages: [...state.messages, msg] };
        });
      }
    });

    socket.on('typing_start', (payload) => {
      const { selectedSessionId } = get();
      if (payload.roomId === selectedSessionId && payload.sender === 'customer') {
        set({ customerTyping: true });
      }
    });

    socket.on('typing_stop', (payload) => {
      const { selectedSessionId } = get();
      if (payload.roomId === selectedSessionId && payload.sender === 'customer') {
        set({ customerTyping: false });
      }
    });

    socket.on('messages_marked_read', ({ reader, readAt }) => {
      const { selectedSessionId } = get();
      if (reader === 'customer') {
        set((state) => ({
          messages: state.messages.map(m => 
            m.sender === 'agent' ? { ...m, readAt } : m
          )
        }));
      }
    });

    socket.on('session_closed', ({ sessionId }) => {
      const { selectedSessionId } = get();
      if (sessionId === selectedSessionId) {
        get().fetchSessions();
      }
    });

    socket.on('session_claimed', (session) => {
      const { selectedSessionId } = get();
      if (session.sessionId === selectedSessionId) {
        get().fetchSessions();
      }
    });
  },

  selectSession: async (sessionId) => {
    const { selectedSessionId } = get();
    
    if (socket && selectedSessionId) {
      socket.emit('agent_leave', selectedSessionId);
    }

    set({ 
      selectedSessionId: sessionId, 
      messages: [], 
      customerTyping: false 
    });

    if (socket && sessionId) {
      socket.emit('agent_join', sessionId);
      await get().fetchMessages(sessionId);
      
      get().markMessagesAsRead();
    }
  },

  fetchMessages: async (sessionId) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/sessions/${sessionId}/messages`, {
        headers: {
          'bypass-tunnel-reminder': 'true'
        }
      });
      if (res.ok) {
        const messages = await res.json();
        set({ messages });
      }
    } catch (e) {
      console.error('Failed to fetch messages:', e);
    }
  },

  sendMessage: (text) => {
    const { selectedSessionId, isConnected, agentId } = get();
    if (!selectedSessionId || !socket || !isConnected) return;

    socket.emit('agent_message', { 
      roomId: selectedSessionId, 
      text, 
      agentId 
    });
  },

  sendTypingStatus: (isTyping) => {
    const { selectedSessionId, isConnected } = get();
    if (!selectedSessionId || !socket || !isConnected) return;

    const event = isTyping ? 'typing_start' : 'typing_stop';
    socket.emit(event, { roomId: selectedSessionId, sender: 'agent' });
  },

  markMessagesAsRead: () => {
    const { selectedSessionId, isConnected } = get();
    if (!selectedSessionId || !socket || !isConnected) return;

    socket.emit('message_read', { roomId: selectedSessionId, sender: 'agent' });
  },

  claimSession: async (sessionId) => {
    const { agentId } = get();
    try {
      const res = await fetch(`${BACKEND_URL}/api/sessions/${sessionId}/claim`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'bypass-tunnel-reminder': 'true'
        },
        body: JSON.stringify({ agentId })
      });
      if (res.ok) {
        get().fetchSessions();
        const currentSession = get().selectedSessionId;
        if (currentSession === sessionId) {
          get().selectSession(sessionId);
        }
      }
    } catch (e) {
      console.error('Failed to claim session:', e);
    }
  },

  closeSession: async (sessionId) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/sessions/${sessionId}/close`, {
        method: 'POST',
        headers: {
          'bypass-tunnel-reminder': 'true'
        }
      });
      if (res.ok) {
        get().fetchSessions();
        set({ selectedSessionId: null, messages: [] });
      }
    } catch (e) {
      console.error('Failed to close session:', e);
    }
  },

  disconnectAll: () => {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  }
}));
