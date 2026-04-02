import { useState } from 'react';
import type { ChatMessage } from '../types';

interface Props {
  assembledPrompt: ChatMessage[] | null;
}

export function PromptViewer({ assembledPrompt }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="panel prompt-viewer">
      <h3>
        Assembled Prompt
        <button className="toggle" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Hide' : 'Show'}
        </button>
      </h3>
      {expanded && assembledPrompt && (
        <div className="prompt-messages">
          {assembledPrompt.map((msg, i) => (
            <div key={i} className={`prompt-msg ${msg.role}`}>
              <strong>{msg.role}</strong>
              <pre>{msg.content}</pre>
            </div>
          ))}
        </div>
      )}
      {expanded && !assembledPrompt && (
        <p className="muted">No prompt assembled yet</p>
      )}
    </div>
  );
}
