import { Dexie, type EntityTable } from 'dexie';
import type { ActivitySet } from '@/lib/learn/schema';
import type { ProviderId } from '@/lib/settings';

export interface CachedActivities {
  videoId: string;
  title: string;
  set: ActivitySet;
  providerId: ProviderId;
  model: string;
  createdAt: number;
}

export class LearnDatabase extends Dexie {
  quizCache!: EntityTable<CachedActivities, 'videoId'>;

  constructor(name = 'youtube-learn') {
    super(name);
    this.version(1).stores({ quizCache: 'videoId, createdAt' });
    // Version 2 replaced flashcard quizzes with learning activities; old entries are regenerated.
    this.version(2)
      .stores({ quizCache: 'videoId, createdAt' })
      .upgrade((tx) => tx.table('quizCache').clear());
  }
}

export const db = new LearnDatabase();
