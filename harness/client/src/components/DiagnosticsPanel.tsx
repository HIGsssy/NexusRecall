import type { MemoryObject, TurnDiagnostics, RetrievalDebugInfo } from '../types';

interface Props {
  latestDiagnostics: TurnDiagnostics | null;
  retrievedMemories: MemoryObject[];
  retrievalDebug?: RetrievalDebugInfo;
}

export function DiagnosticsPanel({ latestDiagnostics, retrievedMemories, retrievalDebug }: Props) {
  const ingestionDebug = latestDiagnostics?.ingestionDebug;
  const memorySectionSentToLLM = latestDiagnostics?.memorySectionSentToLLM;

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

      {/* --- Retrieved Memories (Final Selected) --- */}
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

      {/* --- Retrieval Debug: Excluded Memories --- */}
      {retrievalDebug && retrievalDebug.dropped.length > 0 && (
        <>
          <h4>Excluded Memories ({retrievalDebug.dropped.length})</h4>
          <ul className="memory-list excluded">
            {retrievalDebug.dropped.map((d, i) => (
              <li key={`drop-${i}`} style={{ opacity: 0.7 }}>
                <span className="memory-type">{d.memory_type}</span>
                <span className="drop-reason" style={{ color: '#c44', fontSize: '0.85em' }}>
                  {d.reason}
                </span>
                <p>{d.content_summary}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* --- Retrieval Debug: Score Breakdown --- */}
      {retrievalDebug && retrievalDebug.scored.length > 0 && (
        <>
          <h4>Score Breakdown ({retrievalDebug.scored.length} candidates)</h4>
          <table style={{ fontSize: '0.8em', width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Type</th>
                <th>Sim</th>
                <th>Rec</th>
                <th>Imp</th>
                <th>Str</th>
                <th>Final</th>
                <th>Sel?</th>
              </tr>
            </thead>
            <tbody>
              {retrievalDebug.scored.map((s) => (
                <tr key={s.id} style={{
                  background: retrievalDebug.selected_ids.includes(s.id) ? '#1a3a1a' : 'transparent'
                }}>
                  <td>{s.memory_type}</td>
                  <td style={{ textAlign: 'center' }}>{s.similarity.toFixed(3)}</td>
                  <td style={{ textAlign: 'center' }}>{s.recency.toFixed(3)}</td>
                  <td style={{ textAlign: 'center' }}>{s.importance}</td>
                  <td style={{ textAlign: 'center' }}>{s.strength}</td>
                  <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{s.final_score.toFixed(3)}</td>
                  <td style={{ textAlign: 'center' }}>
                    {retrievalDebug.selected_ids.includes(s.id) ? '✓' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* --- Retrieval Debug: DB Candidate Count --- */}
      {retrievalDebug && (
        <p className="muted" style={{ fontSize: '0.8em' }}>
          DB candidates: {retrievalDebug.candidates_from_db} → scored: {retrievalDebug.scored.length} → selected: {retrievalDebug.selected_ids.length}
        </p>
      )}

      {/* --- Memory Section Sent to LLM --- */}
      {memorySectionSentToLLM && (
        <>
          <h4>Memory Section Sent to LLM</h4>
          <pre style={{ fontSize: '0.75em', whiteSpace: 'pre-wrap', background: '#1a1a2e', padding: '8px', borderRadius: '4px', maxHeight: '150px', overflow: 'auto' }}>
            {memorySectionSentToLLM}
          </pre>
        </>
      )}

      {/* --- Ingestion Debug --- */}
      {ingestionDebug && ingestionDebug.length > 0 && (
        <>
          <h4>Ingestion Log ({ingestionDebug.length} events)</h4>
          <ul className="memory-list" style={{ fontSize: '0.85em' }}>
            {ingestionDebug.slice(-10).reverse().map((ev, i) => (
              <li key={`ing-${i}`} style={{ opacity: ev.discarded ? 0.6 : 1 }}>
                <span className="memory-type">{ev.role}</span>
                {ev.discarded ? (
                  <span style={{ color: '#c44' }}>DISCARDED: {ev.discardReason}</span>
                ) : ev.inserted ? (
                  <span style={{ color: '#4c4' }}>
                    → {ev.inserted.memoryType} (id: {ev.inserted.memoryId.slice(0, 8)}…)
                  </span>
                ) : (
                  <span style={{ color: '#cc4' }}>
                    classified: {ev.classification.memoryType} (imp={ev.classification.importance})
                  </span>
                )}
                <p>{ev.contentSummary}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
