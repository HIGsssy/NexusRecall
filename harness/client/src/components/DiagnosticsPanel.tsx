import type { MemoryObject, TurnDiagnostics } from '../types';

interface Props {
  latestDiagnostics: TurnDiagnostics | null;
  retrievedMemories: MemoryObject[];
}

export function DiagnosticsPanel({ latestDiagnostics, retrievedMemories }: Props) {
  return (
    <div className="panel diagnostics-panel">
      <h3>Diagnostics</h3>

      {latestDiagnostics && (
        <div className="diag-summary">
          <p>
            Turn {latestDiagnostics.turnIndex} &mdash;{' '}
            {latestDiagnostics.durationMs}ms
          </p>
        </div>
      )}

      <h4>Retrieved Memories ({retrievedMemories.length})</h4>
      {retrievedMemories.length === 0 ? (
        <p className="muted">No memories retrieved yet</p>
      ) : (
        <ul className="memory-list">
          {retrievedMemories.map((m) => (
            <li key={m.id}>
              <span className="memory-type">{m.memory_type}</span>
              <span className="memory-score">{m.score.toFixed(3)}</span>
              <span className="memory-importance">imp={m.importance}</span>
              <p>{m.content}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
