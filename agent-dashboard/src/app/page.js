'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useDashboardStore } from '../store/dashboardStore';

function DashboardMessageBubble({ message, onVisible }) {
  const bubbleRef = useRef(null);
  const isCustomer = message.sender === 'customer';

  useEffect(() => {
    if (!isCustomer || message.readAt) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onVisible();
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );

    if (bubbleRef.current) {
      observer.observe(bubbleRef.current);
    }

    return () => observer.disconnect();
  }, [message.readAt, isCustomer, onVisible]);

  const formatTime = (dateStr) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  };

  return (
    <div
      ref={bubbleRef}
      className={`message-row ${message.sender === 'agent' ? 'agent-row' : 'customer-row'}`}
    >
      <div className="dashboard-bubble-wrapper">
        <div className="dashboard-bubble">
          {message.text}
        </div>
        <div className="dashboard-meta">
          <span>{formatTime(message.createdAt)}</span>
          {message.sender === 'agent' && (
            <span className="checkmarks">
              {message.readAt ? (
                <svg className="checkmark-blue" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 5L9.5 12.5L6 9" />
                  <path d="M22 5L14.5 12.5" />
                </svg>
              ) : (
                <svg className="checkmark-gray" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const {
    sessions,
    selectedSessionId,
    messages,
    isConnected,
    customerTyping,
    agentId,
    agentName,
    initDashboard,
    selectSession,
    sendMessage,
    sendTypingStatus,
    markMessagesAsRead,
    claimSession,
    closeSession,
    disconnectAll
  } = useDashboardStore();

  const [activeTab, setActiveTab] = useState('waiting');
  const [inputText, setInputText] = useState('');
  const [showQueue, setShowQueue] = useState(true);
  const [showProfile, setShowProfile] = useState(true);
  const [isNarrow, setIsNarrow] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const toggleQueue = () => {
    const nextVal = !showQueue;
    setShowQueue(nextVal);
    if (nextVal && (typeof window !== 'undefined' ? window.innerWidth <= 768 : isMobile)) {
      setShowProfile(false);
    }
  };

  const toggleProfile = () => {
    const nextVal = !showProfile;
    setShowProfile(nextVal);
    if (nextVal && (typeof window !== 'undefined' ? window.innerWidth <= 1024 : isNarrow)) {
      setShowQueue(false);
    }
  };

  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    initDashboard();
    return () => disconnectAll();
  }, [initDashboard, disconnectAll]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleResize = () => {
        const width = window.innerWidth;
        const narrow = width < 1024;
        const mobile = width <= 768;

        setIsNarrow(narrow);
        setIsMobile(mobile);

        if (narrow) {
          setShowProfile(false);
        } else {
          setShowProfile(true);
        }

        if (mobile) {
          setShowQueue(false);
        } else {
          setShowQueue(true);
        }
      };
      handleResize();
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, []);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, customerTyping]);

  const handleInputChange = (e) => {
    setInputText(e.target.value);
    sendTypingStatus(true);

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    typingTimeoutRef.current = setTimeout(() => {
      sendTypingStatus(false);
    }, 1500);
  };

  const handleSend = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    sendMessage(inputText.trim());
    setInputText('');
    sendTypingStatus(false);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  };

  const waitingSessions = sessions.filter(s => s.status === 'waiting');
  const activeSessions = sessions.filter(s => s.status === 'active' && s.agentId === agentId);
  const closedSessions = sessions.filter(s => s.status === 'closed');

  const filteredSessions =
    activeTab === 'waiting' ? waitingSessions :
      activeTab === 'active' ? activeSessions :
        closedSessions;

  const selectedSession = sessions.find(s => s.sessionId === selectedSessionId);

  const getInitials = (fullName) => {
    if (!fullName) return '';
    return fullName.split(' ').map(n => n[0]).join('').toUpperCase();
  };

  return (
    <div className={`dashboard-shell ${!showQueue ? 'queue-collapsed' : ''} ${!showProfile ? 'profile-collapsed' : ''}`}>
      <aside className="queue-sidebar">
        <div className="sidebar-header">
          <div>
            <h2>Agent Panel</h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Welcome, {agentName}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className={`connection-badge ${isConnected ? 'connected' : 'disconnected'}`}>
              <span className="badge-dot" />
              {isConnected ? 'Live' : 'Offline'}
            </div>
            <button
              onClick={() => setShowQueue(false)}
              className="close-sidebar-btn"
              title="Close Sidebar"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="queue-tabs">
          <button
            className={`queue-tab ${activeTab === 'waiting' ? 'active' : ''}`}
            onClick={() => setActiveTab('waiting')}
          >
            Waiting
            <span className="tab-count">{waitingSessions.length}</span>
          </button>
          <button
            className={`queue-tab ${activeTab === 'active' ? 'active' : ''}`}
            onClick={() => setActiveTab('active')}
          >
            Active
            <span className="tab-count">{activeSessions.length}</span>
          </button>
          <button
            className={`queue-tab ${activeTab === 'closed' ? 'active' : ''}`}
            onClick={() => setActiveTab('closed')}
          >
            Closed
          </button>
        </div>

        <div className="queue-list">
          {filteredSessions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              No chats in this queue
            </div>
          ) : (
            filteredSessions.map((session) => (
              <div
                key={session.sessionId}
                className={`queue-item ${selectedSessionId === session.sessionId ? 'selected' : ''}`}
                onClick={() => {
                  selectSession(session.sessionId);
                  if (window.innerWidth <= 768) {
                    setShowQueue(false);
                  }
                }}
              >
                <div className="item-header">
                  <span className="item-name">{session.name}</span>
                  <span className="item-time">
                    {new Date(session.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                {session.email && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {session.email}
                  </div>
                )}
                <div className="item-footer">
                  <span className="item-preview">
                    {session.status === 'waiting' && !session.agentId ? 'Waiting for agent response...' : 'Conversation active'}
                  </span>

                  {session.status === 'waiting' ? (
                    <button
                      className="claim-small-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        claimSession(session.sessionId);
                      }}
                    >
                      Claim
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      <section className="chat-panel">
        {!selectedSession ? (
          <>
            <div className="chat-panel-header">
              <button
                onClick={toggleQueue}
                className="toggle-sidebar-btn left"
                title="Toggle Queue Sidebar"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
              <div className="header-user-info">
                <h3>Support Dashboard</h3>
                <p>Select a customer conversation to start</p>
              </div>
              {/* <button
                onClick={toggleProfile}
                className="toggle-sidebar-btn right"
                title="Toggle Profile Sidebar"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </button> */}
            </div>
            <div className="chat-placeholder">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <p>Select a customer conversation from the queue to start chat</p>
            </div>
          </>
        ) : (
          <>
            <div className="chat-panel-header">
              <button
                onClick={toggleQueue}
                className="toggle-sidebar-btn left"
                title="Toggle Queue Sidebar"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
              <div className="header-user-info">
                <h3>{selectedSession.name}</h3>
                <p>Status: <span style={{ textTransform: 'capitalize', color: selectedSession.status === 'waiting' ? 'var(--accent-amber)' : 'var(--accent-emerald)', fontWeight: 600 }}>{selectedSession.status}</span></p>
              </div>
              <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                {selectedSession.status === 'waiting' && (
                  <button
                    onClick={() => claimSession(selectedSession.sessionId)}
                    className="btn btn-primary"
                  >
                    Claim Chat
                  </button>
                )}
                {selectedSession.status !== 'closed' && (
                  <button
                    onClick={() => closeSession(selectedSession.sessionId)}
                    className="btn btn-outline-danger"
                  >
                    Close Session
                  </button>
                )}
                {/* <button 
                  onClick={toggleProfile} 
                  className="toggle-sidebar-btn right" 
                  title="Toggle Profile Sidebar"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </button> */}
              </div>
            </div>

            <div className="chat-messages">
              {messages.length === 0 ? (
                <div style={{ margin: 'auto', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  No messages history found
                </div>
              ) : (
                messages.map((msg) => (
                  <DashboardMessageBubble
                    key={msg._id || msg.createdAt}
                    message={msg}
                    onVisible={markMessagesAsRead}
                  />
                ))
              )}

              {customerTyping && (
                <div className="dashboard-typing-row">
                  <div className="typing-bubble">
                    <div className="dots">
                      <div className="dot" />
                      <div className="dot" />
                      <div className="dot" />
                    </div>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Customer is typing...</span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <div className="chat-panel-input">
              <form onSubmit={handleSend} className="input-container">
                <textarea
                  className="dashboard-input"
                  value={inputText}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  placeholder={selectedSession.status === 'closed' ? 'This conversation is closed.' : 'Type your reply here...'}
                  disabled={selectedSession.status === 'closed'}
                  rows="1"
                />
                <button
                  type="submit"
                  className="dashboard-send-btn"
                  disabled={!inputText.trim() || selectedSession.status === 'closed'}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </form>
            </div>
          </>
        )}
      </section>

      {/* <aside className="profile-sidebar">
        <div className="profile-sidebar-header">
          <h4>Profile Info</h4>
          <button 
            onClick={() => setShowProfile(false)} 
            className="close-sidebar-btn" 
            title="Close Profile"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        {!selectedSession ? (
          <div className="profile-sidebar-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
            <p>No conversation selected</p>
          </div>
        ) : (
          <>
            <div className="profile-card">
              <div className="profile-avatar">
                {getInitials(selectedSession.name)}
              </div>
              <h3>{selectedSession.name}</h3>
              <p>{selectedSession.email || 'No email provided'}</p>
            </div>

            <div>
              <h4 className="profile-section-title">Session Metadata</h4>
              <table className="metadata-table">
                <tbody>
                  <tr>
                    <td className="label">Session ID</td>
                    <td className="value">{selectedSession.sessionId}</td>
                  </tr>
                  <tr>
                    <td className="label">Platform</td>
                    <td className="value">{selectedSession.platform || 'Unknown'}</td>
                  </tr>
                  <tr>
                    <td className="label">Started</td>
                    <td className="value">
                      {new Date(selectedSession.createdAt).toLocaleString()}
                    </td>
                  </tr>
                  <tr>
                    <td className="label">Last Event</td>
                    <td className="value">
                      {new Date(selectedSession.updatedAt).toLocaleString()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </aside> */}
    </div>
  );
}
