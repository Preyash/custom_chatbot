'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useChatStore } from '../store/chatStore';

function MessageBubble({ message, onVisible }) {
  const bubbleRef = useRef(null);
  const isAgent = message.sender === 'agent';

  useEffect(() => {
    if (!isAgent || message.readAt) return;

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
  }, [message.readAt, isAgent, onVisible]);

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
      className={`message-bubble-wrapper ${message.sender}`}
    >
      <div className="message-bubble">
        {message.text}
      </div>
      <div className="message-meta">
        <span>{formatTime(message.createdAt)}</span>
        {message.sender === 'customer' && (
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
  );
}

export default function ChatWidget() {
  const {
    sessionId,
    name,
    email,
    messages,
    isConnected,
    agentsOnline,
    agentTyping,
    sessionStatus,
    agentId,
    initSession,
    startSession,
    sendMessage,
    sendTypingStatus,
    markMessagesAsRead,
    sendOfflineMessage,
    clearSession
  } = useChatStore();

  const [isOpen, setIsOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  
  const [nameInput, setNameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  
  const [offlineName, setOfflineName] = useState('');
  const [offlineEmail, setOfflineEmail] = useState('');
  const [offlineMsg, setOfflineMsg] = useState('');
  const [offlineSent, setOfflineSent] = useState(false);
  const [offlineLoading, setOfflineLoading] = useState(false);

  const QUICK_REPLIES = ['Order Status', 'Product query', 'New Order', 'Help me'];

  const feedRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    initSession();
  }, [initSession]);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages, agentTyping, isOpen]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, []);

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

  const handleQuickReply = (text) => {
    sendMessage(text);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  };

  const handleStartChatSubmit = (e) => {
    e.preventDefault();
    if (!nameInput.trim()) return;
    startSession(nameInput.trim(), emailInput.trim());
  };

  const handleOfflineSubmit = async (e) => {
    e.preventDefault();
    if (!offlineName.trim() || !offlineEmail.trim() || !offlineMsg.trim()) return;

    setOfflineLoading(true);
    const success = await sendOfflineMessage(
      offlineName.trim(),
      offlineEmail.trim(),
      offlineMsg.trim()
    );
    setOfflineLoading(false);
    
    if (success) {
      setOfflineSent(true);
      setOfflineName('');
      setOfflineEmail('');
      setOfflineMsg('');
    }
  };

  const toggleWidget = () => {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (nextOpen && sessionId) {
      markMessagesAsRead();
    }
  };

  const handleResetSession = () => {
    if (window.confirm('Are you sure you want to end this chat session?')) {
      clearSession();
      setOfflineSent(false);
    }
  };

  return (
    <div className="widget-container">
      <div className={`widget-window ${isOpen ? 'open' : ''}`}>
        
        <div className="chat-header">
          <div className="chat-header-info">
            <div className="agent-avatar">
              CS
              <span className={`status-dot ${agentsOnline ? 'online' : ''}`} />
            </div>
            <div className="header-text">
              <h4>Support Chat</h4>
              <p>{agentsOnline ? 'Agents online now' : 'Support is currently offline'}</p>
            </div>
          </div>
          {sessionId && (
            <button 
              className="clear-btn" 
              onClick={handleResetSession} 
              title="Reset Chat"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>
          )}
        </div>

        {!agentsOnline && sessionId && (
          <div className="offline-banner">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            Agents are offline. Replies may be delayed.
          </div>
        )}

        {!sessionId ? (
          agentsOnline ? (
            <form onSubmit={handleStartChatSubmit} className="onboarding-screen">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <h3>Start Live Chat</h3>
              <p>Fill out the form below to connect with a support agent instantly.</p>
              
              <div className="form-group">
                <label>Name</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={nameInput} 
                  onChange={(e) => setNameInput(e.target.value)} 
                  placeholder="Enter your name" 
                  required
                />
              </div>

              <div className="form-group">
                <label>Email (Optional)</label>
                <input 
                  type="email" 
                  className="form-input" 
                  value={emailInput} 
                  onChange={(e) => setEmailInput(e.target.value)} 
                  placeholder="Enter your email"
                />
              </div>

              <button type="submit" className="primary-btn">
                Start Chatting
              </button>
            </form>
          ) : (
            <div className="offline-screen">
              {offlineSent ? (
                <div style={{ margin: 'auto 0', textAlign: 'center' }}>
                  <svg style={{ color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', padding: '0.75rem', borderRadius: '50%', marginBottom: '1.5rem' }} width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <h3 style={{ marginBottom: '0.5rem' }}>Message Sent!</h3>
                  <p style={{ color: 'var(--text-secondary)' }}>Thank you for reaching out. We have logged your request and our agents will respond via email shortly.</p>
                  <button 
                    onClick={() => setOfflineSent(false)} 
                    className="primary-btn" 
                    style={{ marginTop: '1.5rem', width: 'auto', padding: '0.75rem 1.5rem' }}
                  >
                    Send Another Message
                  </button>
                </div>
              ) : (
                <form onSubmit={handleOfflineSubmit}>
                  <h3>Leave a Message</h3>
                  <p>Our support team is currently offline. Send us a message and we'll reply via email as soon as possible.</p>
                  
                  <div className="form-group">
                    <label>Name</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      value={offlineName} 
                      onChange={(e) => setOfflineName(e.target.value)} 
                      placeholder="Your name" 
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>Email Address</label>
                    <input 
                      type="email" 
                      className="form-input" 
                      value={offlineEmail} 
                      onChange={(e) => setOfflineEmail(e.target.value)} 
                      placeholder="you@example.com" 
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>Message</label>
                    <textarea 
                      className="form-input" 
                      value={offlineMsg} 
                      onChange={(e) => setOfflineMsg(e.target.value)} 
                      placeholder="How can we help you today?" 
                      rows="4"
                      style={{ resize: 'none', fontFamily: 'inherit' }}
                      required
                    />
                  </div>

                  <button type="submit" className="primary-btn" disabled={offlineLoading}>
                    {offlineLoading ? 'Sending...' : 'Submit Message'}
                  </button>
                </form>
              )}
            </div>
          )
        ) : (
          <>
            <div ref={feedRef} className="chat-feed">
              {messages.length === 0 ? (
                <div className="welcome-container">
                  <div className="welcome-chat-row">
                    <div className="welcome-avatar-icon">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <path d="M12 2C8 6 4 10 4 14c0 4.4 3.6 8 8 8s8-3.6 8-8c0-4-4-8-8-12z" />
                        <path d="M12 2v20" />
                        <path d="M12 10c2-1 4-1 6 0" />
                        <path d="M6 10c2-1 4-1 6 0" />
                      </svg>
                    </div>
                    <div className="welcome-bubble-group">
                      <div className="welcome-msg-bubble">Thank you for contacting Diamond Forest!</div>
                      <div className="welcome-time-meta">Live Chat • {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  </div>
                  
                  <div className="welcome-topics-list">
                    <button type="button" onClick={() => sendMessage("Order status")} className="welcome-topic-btn">
                      Order status
                    </button>
                    <button type="button" onClick={() => sendMessage("Product question")} className="welcome-topic-btn">
                      Product question
                    </button>
                    <button type="button" onClick={() => sendMessage("Place a order")} className="welcome-topic-btn">
                      Place a order
                    </button>
                    <button type="button" onClick={() => sendMessage("Help me")} className="welcome-topic-btn">
                      Help me
                    </button>
                  </div>
                </div>
              ) : (
                messages.map((msg) => (
                  <MessageBubble 
                    key={msg._id || msg.createdAt} 
                    message={msg} 
                    onVisible={markMessagesAsRead}
                  />
                ))
              )}

              {agentTyping && (
                <div className="typing-wrapper">
                  <div className="typing-dots">
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Agent is typing...</span>
                </div>
              )}
            </div>

            {/* Quick-reply chips — shown above input when conversation has started */}
            <div className="quick-replies-bar">
              {QUICK_REPLIES.map((reply) => (
                <button
                  key={reply}
                  type="button"
                  className="quick-reply-chip"
                  onClick={() => handleQuickReply(reply)}
                >
                  {reply}
                </button>
              ))}
            </div>

            <form onSubmit={handleSend} className="chat-input-form">
              <textarea
                className="chat-textarea"
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Type your message..."
                rows="1"
              />
              <button 
                type="submit" 
                className="send-btn" 
                disabled={!inputText.trim()}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </form>
          </>
        )}
      </div>

      <button className="widget-trigger" onClick={toggleWidget}>
        {isOpen ? (
          <svg viewBox="0 0 24 24">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24">
            <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z" />
          </svg>
        )}
      </button>
    </div>
  );
}
