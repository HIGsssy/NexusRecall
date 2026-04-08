// ============================================================
// memory/normalization — Dialect spelling canonicalization
// Nexus Recall Phase 1
// ============================================================
//
// Deterministic British/Canadian → American spelling normalization.
// Applied before embedding so dialect variants produce identical vectors.
//
// Responsibility: bounded dialect word replacement ONLY.
// Does NOT trim, lowercase, or normalize whitespace.

// --- Group 1: -our → -or (9 stems + plurals) ---

const DIALECT_RULES: readonly { pattern: RegExp; replacement: string }[] = [
  { pattern: /\bcolour(s?)\b/gi, replacement: 'color$1' },
  { pattern: /\bfavour(s?)\b/gi, replacement: 'favor$1' },
  { pattern: /\bfavourite(s?)\b/gi, replacement: 'favorite$1' },
  { pattern: /\bflavour(s?)\b/gi, replacement: 'flavor$1' },
  { pattern: /\bhonour(s?)\b/gi, replacement: 'honor$1' },
  { pattern: /\bneighbour(s?)\b/gi, replacement: 'neighbor$1' },
  { pattern: /\bhumour(s?)\b/gi, replacement: 'humor$1' },
  { pattern: /\blabour(s?)\b/gi, replacement: 'labor$1' },
  { pattern: /\bbehaviour(s?)\b/gi, replacement: 'behavior$1' },

  // --- Group 2: -ise/-ised/-ising → -ize/-ized/-izing (5 bounded words) ---

  { pattern: /\brealis(e|ed|ing)\b/gi, replacement: 'realiz$1' },
  { pattern: /\borganis(e|ed|ing)\b/gi, replacement: 'organiz$1' },
  { pattern: /\brecognis(e|ed|ing)\b/gi, replacement: 'recogniz$1' },
  { pattern: /\bspecialis(e|ed|ing)\b/gi, replacement: 'specializ$1' },
  { pattern: /\bcustomis(e|ed|ing)\b/gi, replacement: 'customiz$1' },

  // --- Group 3: -re → -er (5 bounded words + plurals) ---

  { pattern: /\bcentre(s?)\b/gi, replacement: 'center$1' },
  { pattern: /\btheatre(s?)\b/gi, replacement: 'theater$1' },
  { pattern: /\bmetre(s?)\b/gi, replacement: 'meter$1' },
  { pattern: /\blitre(s?)\b/gi, replacement: 'liter$1' },
  { pattern: /\bfibre(s?)\b/gi, replacement: 'fiber$1' },
];

export function canonicalizeDialect(text: string): string {
  let result = text;
  for (const rule of DIALECT_RULES) {
    result = result.replace(rule.pattern, rule.replacement);
  }
  return result;
}
