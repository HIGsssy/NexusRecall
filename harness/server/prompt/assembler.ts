import type { ChatMessage } from '../llm/types';
import type { MemoryObject } from '../nexus-types';

export interface AssemblerInput {
  personaPrompt: string;
  memories: MemoryObject[];
  history: ChatMessage[];
  userMessage: string;
}

export function assemblePrompt(input: AssemblerInput): ChatMessage[] {
  const { personaPrompt, memories, history, userMessage } = input;

  const messages: ChatMessage[] = [];

  // System prompt: persona + retrieved memories
  let system = personaPrompt;

  if (memories.length > 0) {
    system += '\n\n## Relevant Memories\n';
    for (const m of memories) {
      system += `- [${m.memory_type}] (importance=${m.importance}, score=${m.score.toFixed(3)}): ${m.content}\n`;
    }
  }

  messages.push({ role: 'system', content: system });

  // Conversation history (kept as-is)
  for (const msg of history) {
    messages.push(msg);
  }

  // Current user message
  messages.push({ role: 'user', content: userMessage });

  return messages;
}
