import { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '../types';
import { sendChat, type SSECallbacks } from '../api';
import type { MemoryObject, TurnDiagnostics, RetrievalDebugInfo } from '../types';

interface Props {
  sessionId: string | null;
  history: ChatMessage[];
  onHistoryUpdate: (history: ChatMessage[]) => void;
  onRetrieval: (memories: MemoryObject[], debugInfo?: RetrievalDebugInfo) => void;
  onDiagnostics: (diag: TurnDiagnostics) => void;
  onError: (msg: string) => void;
}

export function ChatPanel({
  sessionId,
  history,
  onHistoryUpdate,
  onRetrieval,
  onDiagnostics,
  onError,
}: Props) {
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const messagesEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, streamingContent]);

  async function handleSend() {
    if (!sessionId || !input.trim() || streaming) return;

    const userMessage = input.trim();
    setInput('');
    setStreaming(true);
    setStreamingContent('');

    const updatedHistory: ChatMessage[] = [
      ...history,
      { role: 'user', content: userMessage },
    ];
    onHistoryUpdate(updatedHistory);

    let accumulated = '';

    const callbacks: SSECallbacks = {
      onRetrieval: (data) => onRetrieval(data.memories, data.debugInfo),
      onDelta: (data) => {
        accumulated += data.content;
        setStreamingContent(accumulated);
      },
      onDone: (data) => {
        onHistoryUpdate([
          ...updatedHistory,
          { role: 'assistant', content: data.fullResponse },
        ]);
        onDiagnostics(data.diagnostics);
        setStreamingContent('');
        setStreaming(false);
      },
      onError: (data) => {
        onError(data.message);
        setStreaming(false);
      },
    };

    try {
      await sendChat(sessionId, userMessage, callbacks);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      setStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="chat-panel">
      <div className="messages">
        {history
          .filter((m) => m.role !== 'system')
          .map((msg, i) => (
            <div key={i} className={`message ${msg.role}`}>
              <span className="role">{msg.role}</span>
              <p>{msg.content}</p>
            </div>
          ))}
        {streaming && streamingContent && (
          <div className="message assistant streaming">
            <span className="role">assistant</span>
            <p>{streamingContent}</p>
          </div>
        )}
        <div ref={messagesEnd} />
      </div>
      <div className="chat-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={sessionId ? 'Type a message...' : 'Create a session first'}
          disabled={!sessionId || streaming}
          rows={2}
        />
        <button onClick={handleSend} disabled={!sessionId || streaming || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
