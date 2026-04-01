// ============================================================
// config — Typed Config singleton with startup validation
// Nexus Recall Phase 1 — S01 Foundation
// ============================================================

export type EmbeddingProvider = 'openrouter' | 'nanogpt';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Config {
  // Database
  databaseUrl: string;
  databasePoolSize: number;

  // Redis
  redisUrl: string;

  // Embedding provider
  embeddingProvider: EmbeddingProvider;
  embeddingModel: string;
  openrouterApiKey: string;
  nanogptApiKey: string;

  // Embedding cache
  embeddingCacheTtlSeconds: number;

  // Retrieval
  retrievalTopN: number;
  similarityThresholdSemantic: number;
  similarityThresholdEpisodic: number;
  similarityThresholdSelf: number;
  similarityThresholdCommitment: number;
  retrievalCacheTtlTask: number;
  retrievalCacheTtlConv: number;
  retrievalCacheTtlEmotional: number;

  // Cooldown
  cooldownDurationSeconds: number;

  // Working memory
  workingMemoryMaxTurns: number;
  workingMemoryTtlSeconds: number;

  // Classification
  classifierMinSemanticLength: number;
  classifierMinEpisodicLength: number;

  // Ingestion / lifecycle
  exchangeRetentionDays: number;

  // Observability
  logLevel: LogLevel;
}

class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new ConfigValidationError(
      `Missing required environment variable: ${name}`
    );
  }
  return value;
}

function requireEnvConditional(name: string, condition: boolean): string {
  if (!condition) {
    return '';
  }
  return requireEnv(name);
}

function parsePositiveInt(name: string, raw: string | undefined, defaultValue: number): number {
  if (raw === undefined || raw === '') {
    return defaultValue;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigValidationError(
      `Invalid value for ${name}: expected a positive integer, got "${raw}"`
    );
  }
  return parsed;
}

function parseFloatInRange(name: string, raw: string | undefined, defaultValue: number): number {
  if (raw === undefined || raw === '') {
    return defaultValue;
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed <= 0 || parsed >= 1) {
    throw new ConfigValidationError(
      `Invalid value for ${name}: expected a float in (0, 1), got "${raw}"`
    );
  }
  return parsed;
}

function parseEmbeddingProvider(raw: string): EmbeddingProvider {
  if (raw !== 'openrouter' && raw !== 'nanogpt') {
    throw new ConfigValidationError(
      `Invalid EMBEDDING_PROVIDER: must be exactly "openrouter" or "nanogpt", got "${raw}"`
    );
  }
  return raw;
}

function parseLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined || raw === '') {
    return 'info';
  }
  if (raw !== 'debug' && raw !== 'info' && raw !== 'warn' && raw !== 'error') {
    throw new ConfigValidationError(
      `Invalid LOG_LEVEL: must be one of "debug", "info", "warn", "error", got "${raw}"`
    );
  }
  return raw;
}

function validateDatabaseUrl(url: string): string {
  if (!url.startsWith('postgres://') && !url.startsWith('postgresql://')) {
    throw new ConfigValidationError(
      `Invalid DATABASE_URL: must begin with "postgres://" or "postgresql://", got "${url.substring(0, 20)}..."`
    );
  }
  return url;
}

function validateRedisUrl(url: string): string {
  if (!url.startsWith('redis://') && !url.startsWith('rediss://')) {
    throw new ConfigValidationError(
      `Invalid REDIS_URL: must begin with "redis://" or "rediss://", got "${url.substring(0, 20)}..."`
    );
  }
  return url;
}

function loadConfig(): Config {
  const databaseUrl = validateDatabaseUrl(requireEnv('DATABASE_URL'));
  const redisUrl = validateRedisUrl(requireEnv('REDIS_URL'));

  const embeddingProvider = parseEmbeddingProvider(requireEnv('EMBEDDING_PROVIDER'));
  const embeddingModel = requireEnv('EMBEDDING_MODEL');

  const openrouterApiKey = requireEnvConditional(
    'OPENROUTER_API_KEY',
    embeddingProvider === 'openrouter'
  );
  const nanogptApiKey = requireEnvConditional(
    'NANOGPT_API_KEY',
    embeddingProvider === 'nanogpt'
  );

  const databasePoolSize = parsePositiveInt('DATABASE_POOL_SIZE', process.env['DATABASE_POOL_SIZE'], 10);
  const embeddingCacheTtlSeconds = parsePositiveInt('EMBEDDING_CACHE_TTL_SECONDS', process.env['EMBEDDING_CACHE_TTL_SECONDS'], 300);
  const retrievalTopN = parsePositiveInt('RETRIEVAL_TOP_N', process.env['RETRIEVAL_TOP_N'], 20);
  const retrievalCacheTtlTask = parsePositiveInt('RETRIEVAL_CACHE_TTL_TASK', process.env['RETRIEVAL_CACHE_TTL_TASK'], 30);
  const retrievalCacheTtlConv = parsePositiveInt('RETRIEVAL_CACHE_TTL_CONV', process.env['RETRIEVAL_CACHE_TTL_CONV'], 60);
  const retrievalCacheTtlEmotional = parsePositiveInt('RETRIEVAL_CACHE_TTL_EMOTIONAL', process.env['RETRIEVAL_CACHE_TTL_EMOTIONAL'], 120);
  const cooldownDurationSeconds = parsePositiveInt('COOLDOWN_DURATION_SECONDS', process.env['COOLDOWN_DURATION_SECONDS'], 300);
  const workingMemoryMaxTurns = parsePositiveInt('WORKING_MEMORY_MAX_TURNS', process.env['WORKING_MEMORY_MAX_TURNS'], 10);
  const workingMemoryTtlSeconds = parsePositiveInt('WORKING_MEMORY_TTL_SECONDS', process.env['WORKING_MEMORY_TTL_SECONDS'], 1800);
  const classifierMinSemanticLength = parsePositiveInt('CLASSIFIER_MIN_SEMANTIC_LENGTH', process.env['CLASSIFIER_MIN_SEMANTIC_LENGTH'], 20);
  const classifierMinEpisodicLength = parsePositiveInt('CLASSIFIER_MIN_EPISODIC_LENGTH', process.env['CLASSIFIER_MIN_EPISODIC_LENGTH'], 50);
  const exchangeRetentionDays = parsePositiveInt('EXCHANGE_RETENTION_DAYS', process.env['EXCHANGE_RETENTION_DAYS'], 90);

  const similarityThresholdSemantic = parseFloatInRange('SIMILARITY_THRESHOLD_SEMANTIC', process.env['SIMILARITY_THRESHOLD_SEMANTIC'], 0.75);
  const similarityThresholdEpisodic = parseFloatInRange('SIMILARITY_THRESHOLD_EPISODIC', process.env['SIMILARITY_THRESHOLD_EPISODIC'], 0.70);
  const similarityThresholdSelf = parseFloatInRange('SIMILARITY_THRESHOLD_SELF', process.env['SIMILARITY_THRESHOLD_SELF'], 0.72);
  const similarityThresholdCommitment = parseFloatInRange('SIMILARITY_THRESHOLD_COMMITMENT', process.env['SIMILARITY_THRESHOLD_COMMITMENT'], 0.60);

  const logLevel = parseLogLevel(process.env['LOG_LEVEL']);

  return {
    databaseUrl,
    databasePoolSize,
    redisUrl,
    embeddingProvider,
    embeddingModel,
    openrouterApiKey,
    nanogptApiKey,
    embeddingCacheTtlSeconds,
    retrievalTopN,
    similarityThresholdSemantic,
    similarityThresholdEpisodic,
    similarityThresholdSelf,
    similarityThresholdCommitment,
    retrievalCacheTtlTask,
    retrievalCacheTtlConv,
    retrievalCacheTtlEmotional,
    cooldownDurationSeconds,
    workingMemoryMaxTurns,
    workingMemoryTtlSeconds,
    classifierMinSemanticLength,
    classifierMinEpisodicLength,
    exchangeRetentionDays,
    logLevel,
  };
}

export const config: Config = loadConfig();
