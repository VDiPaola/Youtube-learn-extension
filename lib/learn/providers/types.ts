import type { ActivitySet } from '../schema';

export interface QuizRequest {
  system: string;
  prompt: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
}

export interface QuizProvider {
  generate(request: QuizRequest): Promise<ActivitySet>;
  /** Returns a plain text reply to the last user message. */
  chat(request: ChatRequest): Promise<string>;
  listModels(): Promise<string[]>;
}

export type FetchLike = typeof fetch;
