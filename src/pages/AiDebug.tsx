import React from 'react';

export function AiDebug() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>AI Assistant</h1>
      <p style={{ color: 'var(--hit-muted-foreground)' }}>
        This page exists mainly so the shell can detect that the <code>ai-assistant</code> feature pack is enabled.
      </p>
      <p style={{ color: 'var(--hit-muted-foreground)' }}>
        Use the floating AI button on any page to open the assistant overlay.
      </p>
    </div>
  );
}
