import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root (works whether cwd is harness/ or project root)
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });

export type LLMProvider = 'openrouter' | 'nanogpt';

export interface HarnessConfig {
  nexusRecallUrl: string;
  harnessPort: number;
  llmProvider: LLMProvider;
  openrouterApiKey: string;
  openrouterBaseUrl: string;
  openrouterModel: string;
  nanogptApiKey: string;
  nanogptBaseUrl: string;
  nanogptModel: string;
  llmTemperature: number;
  llmMaxTokens: number;
  defaultPersonaPrompt: string;
  debug: boolean;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function requireEnvConditional(name: string, condition: boolean): string {
  if (!condition) return '';
  return requireEnv(name);
}

function loadHarnessConfig(): HarnessConfig {
  const llmProvider = process.env['LLM_PROVIDER'] as LLMProvider;
  if (llmProvider !== 'openrouter' && llmProvider !== 'nanogpt') {
    throw new Error(
      `Invalid LLM_PROVIDER: must be "openrouter" or "nanogpt", got "${process.env['LLM_PROVIDER'] ?? ''}"`
    );
  }

  const openrouterApiKey = requireEnvConditional('LLM_OPENROUTER_API_KEY', llmProvider === 'openrouter');
  const openrouterModel = requireEnvConditional('LLM_OPENROUTER_MODEL', llmProvider === 'openrouter');
  const nanogptApiKey = requireEnvConditional('LLM_NANOGPT_API_KEY', llmProvider === 'nanogpt');
  const nanogptModel = requireEnvConditional('LLM_NANOGPT_MODEL', llmProvider === 'nanogpt');

  return {
    nexusRecallUrl: process.env['NEXUS_RECALL_URL'] || 'http://localhost:3200',
    harnessPort: parseInt(process.env['HARNESS_PORT'] || '3100', 10),
    llmProvider,
    openrouterApiKey,
    openrouterBaseUrl: process.env['LLM_OPENROUTER_BASE_URL'] || 'https://openrouter.ai/api/v1',
    openrouterModel,
    nanogptApiKey,
    nanogptBaseUrl: process.env['LLM_NANOGPT_BASE_URL'] || 'https://nano-gpt.com/api/v1',
    nanogptModel,
    llmTemperature: parseFloat(process.env['LLM_TEMPERATURE'] || '0.7'),
    llmMaxTokens: parseInt(process.env['LLM_MAX_TOKENS'] || '1024', 10),
    defaultPersonaPrompt: process.env['DEFAULT_PERSONA_PROMPT'] || '',
    debug: process.env['HARNESS_DEBUG'] === 'true',
  };
}

export const harnessConfig = loadHarnessConfig();
