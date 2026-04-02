import type { ChatMessage, ChatCompletionProvider } from './types';

export class OpenRouterProvider implements ChatCompletionProvider {
  constructor(
    private apiKey: string,
    private baseUrl: string,
    private model: string,
    private temperature: number,
    private maxTokens: number
  ) {}

  async *streamComplete(messages: ChatMessage[]): AsyncIterable<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        stream: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenRouter returned ${res.status}: ${text}`);
    }

    if (!res.body) {
      throw new Error('OpenRouter response has no body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop()!;

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) yield content;
          } catch {
            // skip unparseable lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
