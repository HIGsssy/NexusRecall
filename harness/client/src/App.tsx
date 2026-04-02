import { useState, useCallback } from 'react';
import type { ChatMessage, IntentType, MemoryObject, TurnDiagnostics, RetrievalDebugInfo } from './types';
import { patchSession } from './api';
import { ErrorBanner } from './components/ErrorBanner';
import { SessionControls } from './components/SessionControls';
import { PersonaEditor } from './components/PersonaEditor';
import { IntentSelector } from './components/IntentSelector';
import { ChatPanel } from './components/ChatPanel';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { PromptViewer } from './components/PromptViewer';
import './App.css';

export default function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [personaPrompt, setPersonaPrompt] = useState(
    'You are a helpful assistant with memory capabilities.'
  );
  const [intentType, setIntentType] = useState<IntentType>('conversational');
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [retrievedMemories, setRetrievedMemories] = useState<MemoryObject[]>([]);
  const [retrievalDebug, setRetrievalDebug] = useState<RetrievalDebugInfo | undefined>(undefined);
  const [latestDiagnostics, setLatestDiagnostics] = useState<TurnDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleError = useCallback((msg: string) => setError(msg), []);

  async function handlePersonaChange(prompt: string) {
    setPersonaPrompt(prompt);
    if (sessionId) {
      try {
        await patchSession(sessionId, { personaPrompt: prompt });
      } catch {
        // non-critical: local state is canonical during session
      }
    }
  }

  async function handleIntentChange(intent: IntentType) {
    setIntentType(intent);
    if (sessionId) {
      try {
        await patchSession(sessionId, { intentType: intent });
      } catch {
        // non-critical
      }
    }
  }

  function handleSessionCreated(id: string) {
    setSessionId(id);
    setHistory([]);
    setRetrievedMemories([]);
    setRetrievalDebug(undefined);
    setLatestDiagnostics(null);
    setError(null);
  }

  function handleSessionDeleted() {
    setSessionId(null);
    setHistory([]);
    setRetrievedMemories([]);
    setRetrievalDebug(undefined);
    setLatestDiagnostics(null);
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Nexus Recall Harness</h1>
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
      </header>

      <div className="app-body">
        <div className="column-left">
          <ChatPanel
            sessionId={sessionId}
            history={history}
            onHistoryUpdate={setHistory}
            onRetrieval={(memories: MemoryObject[], debugInfo?: RetrievalDebugInfo) => {
              setRetrievedMemories(memories);
              setRetrievalDebug(debugInfo);
            }}
            onDiagnostics={setLatestDiagnostics}
            onError={handleError}
          />
        </div>

        <div className="column-right">
          <SessionControls
            sessionId={sessionId}
            onSessionCreated={handleSessionCreated}
            onSessionDeleted={handleSessionDeleted}
            personaPrompt={personaPrompt}
            intentType={intentType}
            onError={handleError}
          />
          <PersonaEditor
            personaPrompt={personaPrompt}
            onChange={handlePersonaChange}
            disabled={false}
          />
          <IntentSelector
            value={intentType}
            onChange={handleIntentChange}
          />
          <DiagnosticsPanel
            latestDiagnostics={latestDiagnostics}
            retrievedMemories={retrievedMemories}
            retrievalDebug={retrievalDebug}
          />
          <PromptViewer
            assembledPrompt={latestDiagnostics?.assembledPrompt ?? null}
          />
        </div>
      </div>
    </div>
  );
}
