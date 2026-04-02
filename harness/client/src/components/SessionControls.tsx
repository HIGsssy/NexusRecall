import { useState } from 'react';
import type { IntentType } from '../types';
import { createSession, deleteSession as apiDeleteSession } from '../api';

interface Props {
  sessionId: string | null;
  onSessionCreated: (id: string) => void;
  onSessionDeleted: () => void;
  personaPrompt: string;
  intentType: IntentType;
  onError: (msg: string) => void;
}

export function SessionControls({
  sessionId,
  onSessionCreated,
  onSessionDeleted,
  personaPrompt,
  intentType,
  onError,
}: Props) {
  const [userId, setUserId] = useState('harness-user-1');
  const [personaId, setPersonaId] = useState('harness-persona-1');
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (!personaPrompt.trim()) {
      onError('Enter a persona prompt before creating a session');
      return;
    }
    setCreating(true);
    try {
      const session = await createSession({
        internalUserId: userId,
        personaId,
        personaPrompt,
        intentType,
      });
      onSessionCreated(session.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete() {
    if (!sessionId) return;
    await apiDeleteSession(sessionId);
    onSessionDeleted();
  }

  return (
    <div className="panel session-controls">
      <h3>Session</h3>
      {!sessionId ? (
        <div className="session-form">
          <label>
            User ID
            <input value={userId} onChange={(e) => setUserId(e.target.value)} />
          </label>
          <label>
            Persona ID
            <input value={personaId} onChange={(e) => setPersonaId(e.target.value)} />
          </label>
          <button onClick={handleCreate} disabled={creating}>
            {creating ? 'Creating...' : 'New Session'}
          </button>
        </div>
      ) : (
        <div className="session-active">
          <span className="session-id">Session: {sessionId.slice(0, 8)}...</span>
          <button className="danger" onClick={handleDelete}>
            End Session
          </button>
        </div>
      )}
    </div>
  );
}
