// ============================================================
// memory/ingestion/metrics — In-memory classification counters
// Nexus Recall — Instrumentation
// ============================================================

export interface ClassificationMetrics {
  total: number;
  accepted: number;
  rejected: number;
  acceptanceRate: number;
  assistant: {
    total: number;
    accepted: number;
    rejected: number;
    acceptanceRate: number;
  };
  byReason: Record<string, number>;
  overrides: { total: number; bypassed: number };
  since: string;
}

let total = 0;
let accepted = 0;
let rejected = 0;
let assistantTotal = 0;
let assistantAccepted = 0;
let assistantRejected = 0;
const byReason: Record<string, number> = {};
let overridesTotal = 0;
let overridesBypassed = 0;
let since = new Date().toISOString();

export function recordClassification(
  role: 'user' | 'assistant',
  reason: string,
  wasAccepted: boolean
): void {
  total++;
  if (wasAccepted) {
    accepted++;
  } else {
    rejected++;
  }

  if (role === 'assistant') {
    assistantTotal++;
    if (wasAccepted) {
      assistantAccepted++;
    } else {
      assistantRejected++;
    }
  }

  byReason[reason] = (byReason[reason] ?? 0) + 1;
}

export function recordOverride(bypassed: boolean): void {
  overridesTotal++;
  if (bypassed) {
    overridesBypassed++;
  }
}

export function getClassificationMetrics(): ClassificationMetrics {
  return {
    total,
    accepted,
    rejected,
    acceptanceRate: total > 0 ? accepted / total : 0,
    assistant: {
      total: assistantTotal,
      accepted: assistantAccepted,
      rejected: assistantRejected,
      acceptanceRate: assistantTotal > 0 ? assistantAccepted / assistantTotal : 0,
    },
    byReason: { ...byReason },
    overrides: { total: overridesTotal, bypassed: overridesBypassed },
    since,
  };
}

export function resetClassificationMetrics(): ClassificationMetrics {
  const snapshot = getClassificationMetrics();
  total = 0;
  accepted = 0;
  rejected = 0;
  assistantTotal = 0;
  assistantAccepted = 0;
  assistantRejected = 0;
  overridesTotal = 0;
  overridesBypassed = 0;
  for (const key of Object.keys(byReason)) {
    delete byReason[key];
  }
  since = new Date().toISOString();
  return snapshot;
}
