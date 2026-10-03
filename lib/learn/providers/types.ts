import type { ActivitySet } from '../schema';

export interface QuizRequest {
  system: string;
  prompt: string;
}

export interface QuizProvider {
  generate(request: QuizRequest): Promise<ActivitySet>;
  listModels(): Promise<string[]>;
}

export type FetchLike = typeof fetch;
