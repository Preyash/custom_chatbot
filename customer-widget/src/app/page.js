'use client';

import React from 'react';
import ChatWidget from '../components/ChatWidget';

export default function Home() {
  return (
    <div className="mock-page">
      <header className="mock-header">
        <h1 className="mock-title">Test Customer Widget</h1>
        <p className="mock-subtitle">
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla auctor, nunc at tempus auctor, nunc nunc auctor nunc, at auctor nunc a3.
        </p>
      </header>
      <ChatWidget />
    </div>
  );
}
