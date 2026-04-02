import type { ChatCompletionProvider } from './types';
import type { HarnessConfig } from '../config';
import { OpenRouterProvider } from './openrouter';
import { NanoGPTProvider } from './nanogpt';

export function createLLMProvider(config: HarnessConfig): ChatCompletionProvider {
  if (config.llmProvider === 'openrouter') {
    return new OpenRouterProvider(
      config.openrouterApiKey,
      config.openrouterBaseUrl,
      config.openrouterModel,
      config.llmTemperature,
      config.llmMaxTokens
    );
  }

  return new NanoGPTProvider(
    config.nanogptApiKey,
    config.nanogptBaseUrl,
    config.nanogptModel,
    config.llmTemperature,
    config.llmMaxTokens
  );
}
