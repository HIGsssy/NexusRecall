// ============================================================
// memory/ingestion — Ingest exchanges, enqueue async work
// Nexus Recall Phase 1 — S03
// ============================================================

import type { Job } from 'bullmq';
import { config } from '../../config';
import { ingestionQueue } from '../../queue/client';
import { insertExchange, getExchangeById } from '../../db/queries/exchanges';
import {
  insertConfirmedMemory,
  updateBookkeeping,
  updateMemoryByScope,
  deleteAllUserDataFromDb,
  findContradictionCandidates,
  markSuperseded,
  fetchCandidates,
} from '../../db/queries/memories';
import { invalidateRetrievalCache, setCooldown, deleteUserRedisState } from '../cache';
import { embed } from '../embedding';
import type {
  IngestionInput,
  IngestionAck,
  MemoryType,
  ConfidenceLevel,
  VolatilityLevel,
  PruneScope,
  UpdateMemoryInput,
  UpdateMemoryResult,
  IngestionDebugEvent,
} from '../models';
import { recordClassification, recordOverride } from './metrics';

// --- Ingestion Debug Ring Buffer ---

const INGESTION_DEBUG_MAX = 50;
const ingestionDebugBuffer: IngestionDebugEvent[] = [];

function pushIngestionDebug(event: IngestionDebugEvent): void {
  ingestionDebugBuffer.push(event);
  if (ingestionDebugBuffer.length > INGESTION_DEBUG_MAX) {
    ingestionDebugBuffer.shift();
  }
}

export function getIngestionDebugLog(userId?: string, personaId?: string): IngestionDebugEvent[] {
  if (!userId) return [...ingestionDebugBuffer];
  return ingestionDebugBuffer.filter(
    (e) => e.userId === userId && (!personaId || e.personaId === personaId)
  );
}

export function getRecentIngestionDebug(): IngestionDebugEvent[] {
  return [...ingestionDebugBuffer];
}

// --- Job Data Shapes ---

interface ClassifyTurnData {
  exchangeId: string;
  userId: string;
  personaId: string;
}

interface EmbedAndPromoteData {
  exchangeId: string;
  userId: string;
  personaId: string;
  content: string;
  memoryType: MemoryType;
  importance: number;
  confidence: ConfidenceLevel;
  volatility: VolatilityLevel;
}

interface BookkeepingData {
  memoryIds: string[];
  userId: string;
  personaId: string;
}

// --- Classification ---

interface ClassificationResult {
  memoryType: MemoryType | null;
  importance: number;
  confidence: ConfidenceLevel;
  volatility: VolatilityLevel;
  distilledContent?: string;
  reason?: string;
  nearMiss?: NearMissInfo;
}

interface NearMissInfo {
  nearMatch: string;
  pattern: string;
  failedCondition: string;
}

interface SignalEvaluationResult {
  matched: boolean;
  signal?: AssistantSignalDetection;
  nearMiss?: NearMissInfo;
}

interface SemanticFactDetection {
  distilledText: string;
  importance: number;
}

interface AssistantSignalDetection {
  signalType: string;
  distilledText: string;
  memoryType: MemoryType;
  importance: number;
  confidence: ConfidenceLevel;
  volatility: VolatilityLevel;
  reason: string;
}

const SELF_REFERENTIAL_PATTERNS: readonly string[] = [
  'i am a ', 'i am an ', 'i\'m a ', 'i\'m an ',
  'i am designed', 'i am built', 'i am programmed', 'i am configured',
  'i\'m designed', 'i\'m built', 'i\'m programmed', 'i\'m configured',
  'i was designed', 'i was created', 'i was built', 'i was programmed',
  'i have been designed', 'i have been programmed', 'i have been built',
  'i prefer ', 'i can ', 'i cannot ', 'i can\'t ',
  'my purpose', 'my role is', 'my goal is', 'my function is',
  'as an ai', 'as a language model', 'as an assistant',
];

const GREETING_PATTERNS: readonly string[] = [
  'hello', 'hi', 'hey', 'good morning', 'good afternoon',
  'good evening', 'goodnight', 'good night', 'greetings',
];

const META_CONVERSATIONAL_PATTERNS: readonly string[] = [
  'ok', 'okay', 'sure', 'thanks', 'thank you', 'you\'re welcome',
  'no problem', 'got it', 'understood', 'i see', 'alright',
  'sounds good', 'noted', 'absolutely', 'of course', 'certainly',
];

const HEDGING_PATTERNS: readonly string[] = [
  'i think', 'i believe', 'probably', 'maybe', 'might',
  'could be', 'in my opinion', 'seems', 'perhaps', 'likely',
  'i feel', 'i guess', 'it seems', 'it appears', 'not sure',
  'i suppose',
];

const INSTRUCTIONAL_PATTERNS: readonly string[] = [
  'you should', 'you need to', 'you can', 'you must', 'make sure',
  'here\'s how', 'here is how', 'follow these', 'try to',
  'remember to', 'be sure to', 'don\'t forget', 'important to',
];

const COMMITMENT_PATTERNS: readonly string[] = [
  'i will ',
  'i\'ll ',
  'i won\'t ',
  'i will not ',
  'i promise',
  'i\'m going to ',
  'i am going to ',
  'i shall ',
  'i commit to',
  'i\'ll make sure',
  'i will make sure',
  'i\'ll ensure',
  'i will ensure',
  'i\'ll keep',
  'i will keep',
  'i\'ll remember',
  'i will remember',
  'i won\'t forget',
  'i will not forget',
];

const COMMITMENT_EXCLUSION_PATTERNS: readonly string[] = [
  'i\'ll try',
  'i will try',
  'i can ',
  'i could ',
  'i might ',
  'i may ',
  'maybe',
  'perhaps',
  'do you want me to',
  'would you like me to',
  'shall i ',
  'should i ',
  'if you want',
  'if you\'d like',
];

// --- User Semantic Fact Detection ---

const USER_FACT_HEDGING_REJECTION: readonly string[] = [
  'i think', 'i guess', 'maybe', 'probably', 'sort of',
  'kind of', 'might', 'usually', 'sometimes',
];

const USER_FACT_IDENTITY_EXCLUSIONS: readonly string[] = [
  'bit ', 'little ', 'lot ', 'bad ', 'good ', 'real ', 'very ',
];

const USER_SEMANTIC_FACT_RULES: readonly { pattern: RegExp; distill: (m: RegExpMatchArray) => string }[] = [
  { pattern: /^i love\b(.+)/i,              distill: (m) => `User loves${m[1]}` },
  { pattern: /^i like\b(.+)/i,              distill: (m) => `User likes${m[1]}` },
  { pattern: /^i hate\b(.+)/i,              distill: (m) => `User hates${m[1]}` },
  { pattern: /^i dislike\b(.+)/i,           distill: (m) => `User dislikes${m[1]}` },
  { pattern: /^i prefer\b(.+)/i,            distill: (m) => `User prefers${m[1]}` },
  { pattern: /^my favou?rite\b(.+)/i,       distill: (m) => `User's favorite${m[1]}` },
  { pattern: /^i work (?:at|for)\b(.+)/i,   distill: (m) => `User works at${m[1]}` },
  { pattern: /^i work as\b(.+)/i,           distill: (m) => `User works as${m[1]}` },
  { pattern: /^my job is\b(.+)/i,           distill: (m) => `User's job is${m[1]}` },
  { pattern: /^i live in\b(.+)/i,           distill: (m) => `User lives in${m[1]}` },
  { pattern: /^i(?:'m| am) from\b(.+)/i,    distill: (m) => `User is from${m[1]}` },
  { pattern: /^i(?:'m| am) an?\\b(.+)/i,     distill: (m) => `User is ${m[0].match(/\ban\b/i) ? 'an' : 'a'}${m[1]}` },
];

// --- Assistant Memory Gate: Pattern Sets ---
// Evaluation order in detectAssistantMemorySignal():
//   1. ASSISTANT_USER_FACT_RULES (highest priority)
//   2. ASSISTANT_CONFIRMATION_RULES
//   3. ASSISTANT_CORRECTION_RULES
//   4. ASSISTANT_SUMMARY_RULES (lowest priority)
// Within each family: most specific → most general. First valid match wins.

const ASSISTANT_FILLER_PATTERNS: readonly string[] = [
  'let me think', 'let me walk through', 'let me work through',
  'interesting question', 'good question', 'great question',
  'that makes sense', 'that\'s a good point', 'that\'s a great point',
  'here\'s how i\'d approach', 'here\'s what i\'d suggest',
  'let me consider', 'i think we\'re in', 'i think we\'re on',
  'let me break this down', 'let\'s look at this',
  'here\'s my take', 'here\'s my thinking',
];

const ASSISTANT_NARRATIVE_INDICATORS: readonly string[] = [
  'smiled', 'nodded', 'sighed', 'whispered', 'murmured',
  'gazed', 'leaned', 'glanced', 'shrugged', 'paused',
  'gently', 'softly', 'quietly', 'slowly', 'carefully',
  'for a moment', 'looked away', 'eyes met',
  'neon', 'moonlight', 'caught in her', 'caught in his',
  'took a breath', 'let out a', 'turned away',
  'stepped closer', 'stepped back',
];

// Rules ordered most specific → most general.
const ASSISTANT_USER_FACT_RULES: readonly { pattern: RegExp; distill: (m: RegExpMatchArray) => string }[] = [
  { pattern: /\byour favou?rite (.+?) is (.+?)(?:[.,!]|$)/i,
    distill: (m) => `User's favorite ${m[1]} is ${m[2]}` },
  { pattern: /\byou(?:'re| are) allergic to (.+?)(?:[.,!]|$)/i,
    distill: (m) => `User is allergic to ${m[1]}` },
  { pattern: /\byou don't (?:like|enjoy|want) (.+?)(?:[.,!]|$)/i,
    distill: (m) => `User doesn't ${m[0].match(/like/i) ? 'like' : m[0].match(/enjoy/i) ? 'enjoy' : 'want'} ${m[1]}` },
  { pattern: /\byou work (at|for|as) (.+?)(?:[.,!]|$)/i,
    distill: (m) => `User works ${m[1]} ${m[2]}` },
  { pattern: /\byou live in (.+?)(?:[.,!]|$)/i,
    distill: (m) => `User lives in ${m[1]}` },
  { pattern: /\byou(?:'re| are) from (.+?)(?:[.,!]|$)/i,
    distill: (m) => `User is from ${m[1]}` },
  { pattern: /\byou(?:'re| are) (an? .+?)(?:[.,!]|$)/i,
    distill: (m) => `User is ${m[1]}` },
  { pattern: /\byou said (?:that )?(?:you )?(.+?)(?:[.!]|$)/i,
    distill: (m) => `User said ${m[1]}` },
  { pattern: /\byou mentioned (?:that )?(.+?)(?:[.!]|$)/i,
    distill: (m) => `User mentioned ${m[1]}` },
  { pattern: /\byou prefer (.+?)(?:[.,!]|$)/i,
    distill: (m) => `User prefers ${m[1]}` },
];

// Narrow confirmation rules: require confirmation token + substantive trailing clause.
// Bare confirmations ("That's correct.", "Right.") do NOT match.
const CONFIRMATION_TOKEN = '(?:yes|yeah|correct|right|exactly|that\'s (?:right|correct))';

const ASSISTANT_CONFIRMATION_RULES: readonly { pattern: RegExp; distill: (m: RegExpMatchArray) => string }[] = [
  { pattern: new RegExp(`\\b${CONFIRMATION_TOKEN}\\s*[—–,\\-]\\s*the (?:issue|problem) (?:was|is) (.+?)(?:[.!]|$)`, 'i'),
    distill: (m) => `The ${m[0].match(/issue/i) ? 'issue' : 'problem'} ${m[0].match(/\bwas\b/i) ? 'was' : 'is'} ${m[1]}` },
  { pattern: new RegExp(`\\b${CONFIRMATION_TOKEN}\\s*[—–,\\-]\\s*the (?:cause|root cause) (?:was|is) (.+?)(?:[.!]|$)`, 'i'),
    distill: (m) => `The ${m[0].match(/root cause/i) ? 'root cause' : 'cause'} ${m[0].match(/\bwas\b/i) ? 'was' : 'is'} ${m[1]}` },
  { pattern: new RegExp(`\\b${CONFIRMATION_TOKEN}\\s*[—–,\\-]\\s*(.{10,}?)(?:[.!]|$)`, 'i'),
    distill: (m) => m[1].trim() },
];

const ASSISTANT_CORRECTION_RULES: readonly { pattern: RegExp; distill: (m: RegExpMatchArray) => string }[] = [
  { pattern: /\bthe (?:cause|root cause) (?:was|is) (.+?)(?:[.!]|$)/i,
    distill: (m) => `The ${m[0].match(/root cause/i) ? 'root cause' : 'cause'} ${m[0].match(/\bwas\b/i) ? 'was' : 'is'} ${m[1]}` },
  { pattern: /\bthe fix (?:was|is) (.+?)(?:[.!]|$)/i,
    distill: (m) => `The fix ${m[0].match(/\bwas\b/i) ? 'was' : 'is'} ${m[1]}` },
  { pattern: /\byou were right (?:that )?(.+?)(?:[.!]|$)/i,
    distill: (m) => `User was right: ${m[1]}` },
  { pattern: /\bit turned out (?:that )?(.+?)(?:[.!]|$)/i,
    distill: (m) => m[1].trim() },
  { pattern: /\bthe (?:issue|problem) (?:was|is) (.+?)(?:[.!]|$)/i,
    distill: (m) => `The ${m[0].match(/issue/i) ? 'issue' : 'problem'} ${m[0].match(/\bwas\b/i) ? 'was' : 'is'} ${m[1]}` },
];

const ASSISTANT_SUMMARY_RULES: readonly { pattern: RegExp; distill: (m: RegExpMatchArray) => string }[] = [
  { pattern: /\bthe (?:main|short) (?:takeaway|point) is[,:]?\s*(.+?)(?:[.!]|$)/i,
    distill: (m) => m[1].trim() },
  { pattern: /\bthe key point is[,:]?\s*(.+?)(?:[.!]|$)/i,
    distill: (m) => m[1].trim() },
  { pattern: /\bto summarize[,:]?\s*(.+?)(?:[.!]|$)/i,
    distill: (m) => m[1].trim() },
  { pattern: /\bin summary[,:]?\s*(.+?)(?:[.!]|$)/i,
    distill: (m) => m[1].trim() },
  { pattern: /\bbottom line[,:]?\s*(.+?)(?:[.!]|$)/i,
    distill: (m) => m[1].trim() },
];

// --- Assistant Memory Gate: Helper Functions ---

function isValidDistillation(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 8) return false;
  if (trimmed.endsWith('...')) return false;
  if (/^[,;:\-—–.!?]/.test(trimmed)) return false;
  return true;
}

function stripConversationalPadding(content: string): string {
  let result = content;
  const padRe = /^(absolutely|sure|got it|of course|certainly|no problem|okay|ok|right|yes|yeah)\s*[—–\-!.,]\s*/i;
  while (padRe.test(result)) {
    result = result.replace(padRe, '');
  }
  return result || content; // fallback to original if somehow emptied
}

function isAssistantFiller(contentLower: string): string | null {
  for (const p of ASSISTANT_FILLER_PATTERNS) {
    if (contentLower.includes(p)) return p;
  }
  return null;
}

function hasNarrativeFluff(contentLower: string): boolean {
  let count = 0;
  for (const indicator of ASSISTANT_NARRATIVE_INDICATORS) {
    if (contentLower.includes(indicator)) {
      count++;
      if (count >= 3) return true;
    }
  }
  return false;
}

function diagnoseFailed(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length < 8) return 'distillation_too_short';
  if (trimmed.endsWith('...')) return 'distillation_trailing_ellipsis';
  if (/^[,;:\-—–.!?]/.test(trimmed)) return 'distillation_leading_punctuation';
  return 'distillation_unknown';
}

const NEAR_MISS_FACT_KEYWORDS = ['favorite', 'favourite', 'prefer', 'live in', 'work at', 'work for', 'work as', 'allergic'];
const NEAR_MISS_SUMMARY_KEYWORDS = ['summarize', 'key point', 'bottom line', 'takeaway', 'in summary'];

function evaluateAssistantSignals(content: string): SignalEvaluationResult {
  type RuleFamily = {
    rules: readonly { pattern: RegExp; distill: (m: RegExpMatchArray) => string }[];
    signalType: string;
    memoryType: MemoryType;
    importance: number;
    confidence: ConfidenceLevel;
    volatility: VolatilityLevel;
    reason: string;
  };

  const families: RuleFamily[] = [
    { rules: ASSISTANT_USER_FACT_RULES, signalType: 'user_fact_restatement',
      memoryType: 'semantic', importance: 0.7, confidence: 'explicit', volatility: 'factual',
      reason: 'stored_assistant_semantic_distilled' },
    { rules: ASSISTANT_CONFIRMATION_RULES, signalType: 'confirmation',
      memoryType: 'semantic', importance: 0.65, confidence: 'inferred', volatility: 'factual',
      reason: 'stored_assistant_confirmation_distilled' },
    { rules: ASSISTANT_CORRECTION_RULES, signalType: 'correction',
      memoryType: 'semantic', importance: 0.65, confidence: 'inferred', volatility: 'factual',
      reason: 'stored_assistant_conclusion_distilled' },
    { rules: ASSISTANT_SUMMARY_RULES, signalType: 'summary',
      memoryType: 'semantic', importance: 0.65, confidence: 'inferred', volatility: 'factual',
      reason: 'stored_assistant_summary_distilled' },
  ];

  let firstNearMiss: NearMissInfo | undefined;

  for (const family of families) {
    for (const rule of family.rules) {
      const match = content.match(rule.pattern);
      if (!match) continue;

      const distilled = rule.distill(match);

      if (!match[1] || match[1].trim().length === 0) {
        if (!firstNearMiss) {
          firstNearMiss = {
            nearMatch: family.signalType,
            pattern: rule.pattern.source,
            failedCondition: 'empty_capture',
          };
        }
        continue;
      }

      if (!isValidDistillation(distilled)) {
        if (!firstNearMiss) {
          firstNearMiss = {
            nearMatch: family.signalType,
            pattern: rule.pattern.source,
            failedCondition: diagnoseFailed(distilled),
          };
        }
        continue;
      }

      return {
        matched: true,
        signal: {
          signalType: family.signalType,
          distilledText: distilled,
          memoryType: family.memoryType,
          importance: family.importance,
          confidence: family.confidence,
          volatility: family.volatility,
          reason: family.reason,
        },
      };
    }
  }

  // Keyword heuristic fallback — only if no near-miss was captured
  if (!firstNearMiss) {
    const lower = content.toLowerCase();
    if (NEAR_MISS_FACT_KEYWORDS.some(kw => lower.includes(kw))) {
      firstNearMiss = {
        nearMatch: 'user_fact',
        pattern: 'keyword_heuristic',
        failedCondition: 'keyword_present_but_pattern_mismatch',
      };
    } else if (NEAR_MISS_SUMMARY_KEYWORDS.some(kw => lower.includes(kw))) {
      firstNearMiss = {
        nearMatch: 'summary',
        pattern: 'keyword_heuristic',
        failedCondition: 'keyword_present_but_pattern_mismatch',
      };
    }
  }

  return { matched: false, nearMiss: firstNearMiss };
}

function detectAssistantMemorySignal(content: string): AssistantSignalDetection | null {
  // Family evaluation order: user-fact > confirmation > correction > summary
  // Within each family: top-to-bottom, first valid distillation wins

  type RuleFamily = {
    rules: readonly { pattern: RegExp; distill: (m: RegExpMatchArray) => string }[];
    signalType: string;
    memoryType: MemoryType;
    importance: number;
    confidence: ConfidenceLevel;
    volatility: VolatilityLevel;
    reason: string;
  };

  const families: RuleFamily[] = [
    { rules: ASSISTANT_USER_FACT_RULES, signalType: 'user_fact_restatement',
      memoryType: 'semantic', importance: 0.7, confidence: 'explicit', volatility: 'factual',
      reason: 'stored_assistant_semantic_distilled' },
    { rules: ASSISTANT_CONFIRMATION_RULES, signalType: 'confirmation',
      memoryType: 'semantic', importance: 0.65, confidence: 'inferred', volatility: 'factual',
      reason: 'stored_assistant_confirmation_distilled' },
    { rules: ASSISTANT_CORRECTION_RULES, signalType: 'correction',
      memoryType: 'semantic', importance: 0.65, confidence: 'inferred', volatility: 'factual',
      reason: 'stored_assistant_conclusion_distilled' },
    { rules: ASSISTANT_SUMMARY_RULES, signalType: 'summary',
      memoryType: 'semantic', importance: 0.65, confidence: 'inferred', volatility: 'factual',
      reason: 'stored_assistant_summary_distilled' },
  ];

  for (const family of families) {
    for (const rule of family.rules) {
      const match = content.match(rule.pattern);
      if (!match) continue;

      const distilled = rule.distill(match);
      if (!isValidDistillation(distilled)) continue;

      return {
        signalType: family.signalType,
        distilledText: distilled,
        memoryType: family.memoryType,
        importance: family.importance,
        confidence: family.confidence,
        volatility: family.volatility,
        reason: family.reason,
      };
    }
  }

  return null;
}

const COMMITMENT_EMBEDDED_FACT_RE = /(?:remember|keep in mind|noted|got it) that (your .+|you .+)/i;

function distillCommitment(content: string): string {
  const stripped = stripConversationalPadding(content);

  // Try embedded user-fact extraction
  const factMatch = stripped.match(COMMITMENT_EMBEDDED_FACT_RE);
  if (factMatch) {
    let fact = factMatch[1].trim().replace(/[.!,]+$/, '');
    // Transform user references to third-person
    fact = fact
      .replace(/\byour favou?rite\b/gi, 'User\'s favorite')
      .replace(/\byour\b/gi, 'User\'s')
      .replace(/\byou(?:'re| are)\b/gi, 'User is')
      .replace(/\byou live\b/gi, 'User lives')
      .replace(/\byou work\b/gi, 'User works')
      .replace(/\byou prefer\b/gi, 'User prefers')
      .replace(/\byou(?:'ve| have)\b/gi, 'User has')
      .replace(/\byou\b/gi, 'user');
    if (isValidDistillation(fact)) return fact;
    // Fall through to safe third-person transformation
  }

  // Safe fallback: third-person transformation of full commitment text
  let result = stripped
    .replace(/\bI'll\b/g, 'Assistant will')
    .replace(/\bI will\b/g, 'Assistant will')
    .replace(/\bI'm going to\b/g, 'Assistant is going to')
    .replace(/\bI am going to\b/g, 'Assistant is going to')
    .replace(/\bI shall\b/g, 'Assistant will')
    .replace(/\bI won't\b/g, 'Assistant will not')
    .replace(/\bI will not\b/g, 'Assistant will not')
    .replace(/\bI commit to\b/g, 'Assistant commits to')
    .replace(/\bI promise\b/g, 'Assistant promises')
    .replace(/\bi'll\b/g, 'Assistant will')
    .replace(/\bi will\b/g, 'Assistant will')
    .replace(/\bi'm going to\b/g, 'Assistant is going to')
    .replace(/\bi am going to\b/g, 'Assistant is going to')
    .replace(/\bi shall\b/g, 'Assistant will')
    .replace(/\bi won't\b/g, 'Assistant will not')
    .replace(/\bi will not\b/g, 'Assistant will not')
    .replace(/\bi commit to\b/g, 'Assistant commits to')
    .replace(/\bi promise\b/g, 'Assistant promises')
    .replace(/\byou\b/gi, 'user');

  return result || content; // last-resort fallback to original
}

function isSelfReferential(contentLower: string): boolean {
  return SELF_REFERENTIAL_PATTERNS.some(p => contentLower.includes(p));
}

function isQuestion(content: string): boolean {
  return content.trimEnd().endsWith('?');
}

function isShortGreeting(contentLower: string): boolean {
  const wordCount = contentLower.split(/\s+/).length;
  if (wordCount > 5) return false;
  return GREETING_PATTERNS.some(p => contentLower.includes(p));
}

function isMetaConversational(contentLower: string): boolean {
  const wordCount = contentLower.split(/\s+/).length;
  if (wordCount > 8) return false;
  return META_CONVERSATIONAL_PATTERNS.some(p => contentLower.includes(p));
}

function containsHedging(contentLower: string): boolean {
  return HEDGING_PATTERNS.some(p => contentLower.includes(p));
}

function appearsInstructional(contentLower: string): boolean {
  return INSTRUCTIONAL_PATTERNS.some(p => contentLower.includes(p));
}

function isCommitment(contentLower: string, content: string): boolean {
  if (isQuestion(content)) return false;
  if (COMMITMENT_EXCLUSION_PATTERNS.some(p => contentLower.includes(p))) return false;
  return COMMITMENT_PATTERNS.some(p => contentLower.includes(p));
}

function detectUserSemanticFact(lower: string, raw: string): SemanticFactDetection | null {
  if (isQuestion(raw)) return null;
  if (USER_FACT_HEDGING_REJECTION.some(p => lower.includes(p))) return null;

  for (let i = 0; i < USER_SEMANTIC_FACT_RULES.length; i++) {
    const rule = USER_SEMANTIC_FACT_RULES[i];
    const match = raw.match(rule.pattern);
    if (!match) continue;

    const captured = match[1].trim();
    if (!captured) continue;

    // Rule 12 (last rule): identity pattern — reject transient adjective phrases
    if (i === USER_SEMANTIC_FACT_RULES.length - 1) {
      const capturedLower = captured.toLowerCase();
      if (USER_FACT_IDENTITY_EXCLUSIONS.some(ex => capturedLower.startsWith(ex))) continue;
    }

    return { distilledText: rule.distill(match), importance: 0.75 };
  }

  return null;
}

function classify(role: 'user' | 'assistant', content: string): ClassificationResult {
  const trimmed = content.trim();
  const lower = trimmed.toLowerCase();

  if (role === 'assistant') {
    if (trimmed.length < config.classifierMinSemanticLength) {
      return { memoryType: null, importance: 0, confidence: 'inferred', volatility: 'subjective',
               reason: 'rejected_assistant_too_short' };
    }

    if (isCommitment(lower, trimmed)) {
      return { memoryType: 'commitment', importance: 0.8, confidence: 'explicit', volatility: 'factual',
               distilledContent: distillCommitment(trimmed), reason: 'stored_assistant_commitment' };
    }

    if (isSelfReferential(lower)) {
      return { memoryType: 'self', importance: 0.6, confidence: 'inferred', volatility: 'subjective',
               reason: 'stored_assistant_self' };
    }

    if (isQuestion(trimmed)) {
      return { memoryType: null, importance: 0, confidence: 'inferred', volatility: 'subjective',
               reason: 'rejected_assistant_question' };
    }
    if (isShortGreeting(lower)) {
      return { memoryType: null, importance: 0, confidence: 'inferred', volatility: 'subjective',
               reason: 'rejected_assistant_greeting' };
    }
    if (isMetaConversational(lower)) {
      return { memoryType: null, importance: 0, confidence: 'inferred', volatility: 'subjective',
               reason: 'rejected_assistant_meta' };
    }

    // Assistant memory signal detection (replaces semantic catch-all)
    const evalResult = evaluateAssistantSignals(trimmed);
    if (evalResult.matched && evalResult.signal) {
      return {
        memoryType: evalResult.signal.memoryType,
        importance: evalResult.signal.importance,
        confidence: evalResult.signal.confidence,
        volatility: evalResult.signal.volatility,
        distilledContent: evalResult.signal.distilledText,
        reason: evalResult.signal.reason,
      };
    }

    // No strong signal — check for specific rejection categories
    const fillerMatch = isAssistantFiller(lower);
    if (fillerMatch) {
      return { memoryType: null, importance: 0, confidence: 'inferred', volatility: 'subjective',
               reason: 'rejected_assistant_filler', nearMiss: evalResult.nearMiss };
    }

    if (hasNarrativeFluff(lower)) {
      return { memoryType: null, importance: 0, confidence: 'inferred', volatility: 'subjective',
               reason: 'rejected_assistant_narrative_fluff', nearMiss: evalResult.nearMiss };
    }

    // Default: no signal found, reject
    return { memoryType: null, importance: 0, confidence: 'inferred', volatility: 'subjective',
             reason: 'rejected_assistant_no_memory_signal', nearMiss: evalResult.nearMiss };
  }

  if (role === 'user') {
    const factDetection = detectUserSemanticFact(lower, trimmed);
    if (factDetection) {
      return {
        memoryType: 'semantic',
        importance: factDetection.importance,
        confidence: 'explicit',
        volatility: 'factual',
        distilledContent: factDetection.distilledText,
      };
    }

    if (trimmed.length < config.classifierMinEpisodicLength) {
      return { memoryType: null, importance: 0, confidence: 'inferred', volatility: 'subjective' };
    }

    if (isQuestion(trimmed)) {
      return { memoryType: null, importance: 0, confidence: 'inferred', volatility: 'subjective' };
    }

    return { memoryType: 'episodic', importance: 0.4, confidence: 'inferred', volatility: 'subjective' };
  }

  return { memoryType: null, importance: 0, confidence: 'inferred', volatility: 'subjective' };
}

// --- Safety Valve ---

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'it', 'that', 'this',
  'to', 'of', 'in', 'for', 'and', 'or', 'but', 'i', 'you', 'my', 'your', 'we',
]);

const SAFETY_VALVE_NON_RESCUABLE = new Set([
  'rejected_assistant_too_short',
  'rejected_assistant_question',
  'rejected_assistant_greeting',
]);

function hasKeyTermOverlap(contentA: string, contentB: string, minOverlap: number): boolean {
  const tokenize = (s: string): Set<string> => {
    const tokens = s.toLowerCase().split(/\s+/).filter(t => t.length >= 3 && !STOP_WORDS.has(t));
    return new Set(tokens);
  };
  const setA = tokenize(contentA);
  const setB = tokenize(contentB);
  let count = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      count++;
      if (count >= minOverlap) return true;
    }
  }
  return false;
}

interface SafetyValveResult {
  override: boolean;
  similarity?: number;
  matchedMemoryId?: string;
}

const CONFIRMATION_TOKEN_RE = /\b(?:yes|yeah|correct|right|exactly|that's (?:right|correct))\b/i;

async function attemptHighSimilarityOverride(
  userId: string,
  personaId: string,
  content: string,
  result: ClassificationResult
): Promise<SafetyValveResult> {
  if (!config.safetyValveEnabled) return { override: false };
  if (result.reason && SAFETY_VALVE_NON_RESCUABLE.has(result.reason)) return { override: false };

  const embedding = await embed(content);
  const rawCandidates = await fetchCandidates(userId, personaId, embedding, 5);

  let bestId: string | null = null;
  let bestSimilarity = -1;
  let bestContent = '';

  for (const candidate of rawCandidates) {
    const candidateEmbedding = parseVector(candidate.embedding as string);
    const similarity = cosineSimilarity(embedding, candidateEmbedding);
    if (similarity > config.safetyValveSimilarityThreshold && similarity > bestSimilarity) {
      bestId = candidate.id as string;
      bestSimilarity = similarity;
      bestContent = candidate.content as string;
    }
  }

  if (bestId === null) return { override: false };

  if (!hasKeyTermOverlap(content, bestContent, config.safetyValveMinKeyTermOverlap)) {
    recordOverride(true);
    return { override: false };
  }

  if (CONFIRMATION_TOKEN_RE.test(content) || bestSimilarity > 0.95) {
    recordOverride(false);
    return { override: true, similarity: bestSimilarity, matchedMemoryId: bestId };
  }

  return { override: false };
}

// --- Contradiction Helper ---

const CONTRADICTION_ELIGIBLE_TYPES = new Set<MemoryType>(['semantic', 'self']);

function parseVector(vectorStr: string): number[] {
  return vectorStr
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map(Number);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dot / denominator;
}

// --- Public Interface ---

export async function ingest(input: IngestionInput): Promise<IngestionAck> {
  if (!input.internal_user_id) throw new Error('Missing required field: internal_user_id');
  if (!input.persona_id) throw new Error('Missing required field: persona_id');
  if (!input.session_id) throw new Error('Missing required field: session_id');
  if (!input.role) throw new Error('Missing required field: role');
  if (!input.content) throw new Error('Missing required field: content');

  const exchange = await insertExchange(
    input.internal_user_id,
    input.persona_id,
    input.session_id,
    input.role,
    input.content,
    input.metadata
  );

  let queued = false;
  try {
    await ingestionQueue.add('classify-turn', {
      exchangeId: exchange.id,
      userId: input.internal_user_id,
      personaId: input.persona_id,
    } satisfies ClassifyTurnData);
    queued = true;
  } catch {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'enqueue_failed',
        jobType: 'classify-turn',
        exchangeId: exchange.id,
        timestamp: new Date().toISOString(),
      })
    );
  }

  return {
    exchange_id: exchange.id,
    queued,
  };
}

export async function processJob(job: Job): Promise<void> {
  switch (job.name) {
    case 'classify-turn':
      await handleClassifyTurn(job.data as ClassifyTurnData);
      break;
    case 'embed-and-promote':
      await handleEmbedAndPromote(job.data as EmbedAndPromoteData);
      break;
    case 'bookkeeping':
      await handleBookkeeping(job.data as BookkeepingData);
      break;
    case 'prune-scope':
      console.log(
        JSON.stringify({
          jobType: 'prune-scope',
          status: 'stub',
          scope: job.data,
        })
      );
      break;
    case 'summarize-session':
      console.log(
        JSON.stringify({
          jobType: 'summarize-session',
          status: 'stub',
          sessionId: (job.data as { sessionId: string }).sessionId,
        })
      );
      break;
    default:
      throw new Error(`Unknown job type: ${job.name}`);
  }
}

// --- Enqueue Helpers ---

export async function enqueueBookkeeping(
  memoryIds: string[],
  userId: string,
  personaId: string
): Promise<void> {
  await ingestionQueue.add('bookkeeping', {
    memoryIds,
    userId,
    personaId,
  } satisfies BookkeepingData);
}

export async function enqueuePrune(scope: PruneScope): Promise<void> {
  await ingestionQueue.add('prune-scope', {
    internal_user_id: scope.internal_user_id,
    persona_id: scope.persona_id,
  });
}

export async function enqueueSummarize(sessionId: string): Promise<void> {
  await ingestionQueue.add('summarize-session', {
    sessionId,
  });
}

// --- Job Handlers ---

async function handleClassifyTurn(data: ClassifyTurnData): Promise<void> {
  const exchange = await getExchangeById(data.exchangeId);
  if (!exchange) {
    throw new Error(`Exchange not found: ${data.exchangeId}`);
  }

  const result = classify(exchange.role, exchange.content);
  const summary = exchange.content.length > 120 ? exchange.content.slice(0, 120) + '...' : exchange.content;

  if (result.memoryType === null) {
    // Safety valve: attempt high-similarity override for assistant messages
    if (exchange.role === 'assistant') {
      const override = await attemptHighSimilarityOverride(
        data.userId, data.personaId, exchange.content, result
      );
      if (override.override) {
        recordClassification('assistant', 'high_similarity_confirmation_override', true);
        pushIngestionDebug({
          timestamp: new Date().toISOString(),
          userId: data.userId,
          personaId: data.personaId,
          exchangeId: exchange.id,
          role: exchange.role,
          contentSummary: summary,
          classification: {
            memoryType: 'semantic',
            importance: 0.5,
            confidence: 'inferred',
            volatility: 'subjective',
          },
          discarded: false,
          classificationReason: 'high_similarity_confirmation_override',
          overrideApplied: true,
          overrideReason: 'high_similarity_confirmation_override',
          overrideSimilarity: override.similarity,
          nearMiss: result.nearMiss,
        });
        await ingestionQueue.add('embed-and-promote', {
          exchangeId: exchange.id,
          userId: data.userId,
          personaId: data.personaId,
          content: exchange.content,
          memoryType: 'semantic' as MemoryType,
          importance: 0.5,
          confidence: 'inferred' as ConfidenceLevel,
          volatility: 'subjective' as VolatilityLevel,
        } satisfies EmbedAndPromoteData);
        return;
      }
    }

    recordClassification(exchange.role, result.reason ?? 'unknown', false);
    pushIngestionDebug({
      timestamp: new Date().toISOString(),
      userId: data.userId,
      personaId: data.personaId,
      exchangeId: exchange.id,
      role: exchange.role,
      contentSummary: summary,
      classification: {
        memoryType: null,
        importance: result.importance,
        confidence: result.confidence,
        volatility: result.volatility,
      },
      discarded: true,
      discardReason: result.reason ?? 'classification returned null memoryType',
      classificationReason: result.reason,
      nearMiss: result.nearMiss,
    });
    return;
  }

  recordClassification(exchange.role, result.reason ?? 'unknown', true);
  pushIngestionDebug({
    timestamp: new Date().toISOString(),
    userId: data.userId,
    personaId: data.personaId,
    exchangeId: exchange.id,
    role: exchange.role,
    contentSummary: summary,
    classification: {
      memoryType: result.memoryType,
      importance: result.importance,
      confidence: result.confidence,
      volatility: result.volatility,
    },
    discarded: false,
    classificationReason: result.reason,
  });

  await ingestionQueue.add('embed-and-promote', {
    exchangeId: exchange.id,
    userId: data.userId,
    personaId: data.personaId,
    content: result.distilledContent ?? exchange.content,
    memoryType: result.memoryType,
    importance: result.importance,
    confidence: result.confidence,
    volatility: result.volatility,
  } satisfies EmbedAndPromoteData);
}

async function handleEmbedAndPromote(data: EmbedAndPromoteData): Promise<void> {
  const embedding = await embed(data.content);

  let lineageParentId: string | null = null;

  // Contradiction check: only for semantic and self types
  if (CONTRADICTION_ELIGIBLE_TYPES.has(data.memoryType)) {
    const candidates = await findContradictionCandidates(
      data.userId,
      data.personaId,
      data.memoryType as 'semantic' | 'self'
    );

    let bestId: string | null = null;
    let bestSimilarity = -1;

    for (const candidate of candidates) {
      const candidateEmbedding = parseVector(candidate.embedding);
      const similarity = cosineSimilarity(embedding, candidateEmbedding);
      if (similarity > config.contradictionSimilarityThreshold && similarity > bestSimilarity) {
        bestId = candidate.id;
        bestSimilarity = similarity;
      }
    }

    if (bestId !== null) {
      await markSuperseded(bestId, data.userId, data.personaId);
      lineageParentId = bestId;
    }
  }

  const memoryId = await insertConfirmedMemory(
    data.userId,
    data.personaId,
    data.memoryType,
    data.content,
    embedding,
    data.importance,
    data.confidence,
    data.volatility,
    lineageParentId
  );

  // Update the most recent matching debug event with insert result
  for (let i = ingestionDebugBuffer.length - 1; i >= 0; i--) {
    if (ingestionDebugBuffer[i].exchangeId === data.exchangeId && !ingestionDebugBuffer[i].discarded) {
      ingestionDebugBuffer[i].inserted = {
        memoryId,
        memoryType: data.memoryType,
        status: 'confirmed',
      };
      break;
    }
  }

  await invalidateRetrievalCache(data.userId, data.personaId);
}

async function handleBookkeeping(data: BookkeepingData): Promise<void> {
  const cooldownMs = config.cooldownDurationSeconds * 1000;
  const cooldownUntil = new Date(Date.now() + cooldownMs);

  for (const memoryId of data.memoryIds) {
    await updateBookkeeping(memoryId, cooldownUntil);
    await setCooldown(memoryId, cooldownMs);
  }

  await invalidateRetrievalCache(data.userId, data.personaId);
}

// --- Service Delegation Functions ---

export async function performUpdate(
  input: UpdateMemoryInput
): Promise<UpdateMemoryResult> {
  const updated = await updateMemoryByScope(
    input.memory_id,
    input.internal_user_id,
    input.persona_id,
    input.feedback,
    input.inhibit
  );

  if (updated) {
    await invalidateRetrievalCache(input.internal_user_id, input.persona_id);
  }

  return { memory_id: input.memory_id, updated };
}

export async function performDeleteUserData(userId: string): Promise<void> {
  const { personaIds, memoryIds } = await deleteAllUserDataFromDb(userId);
  await deleteUserRedisState(userId, personaIds, memoryIds);
}
