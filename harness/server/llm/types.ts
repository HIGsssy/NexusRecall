export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionProvider {
  streamComplete(messages: ChatMessage[]): AsyncIterable<string>;
}
