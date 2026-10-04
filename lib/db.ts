import { Dexie, type EntityTable } from 'dexie';
import type { FsrsCard, FsrsLog } from '@/lib/knowledge/scheduler';
import type { Activity, ActivitySet } from '@/lib/learn/schema';
import type { ProviderId } from '@/lib/settings';

export interface CachedActivities {
  videoId: string;
  title: string;
  set: ActivitySet;
  providerId: ProviderId;
  model: string;
  createdAt: number;
}

export interface StoredVideo {
  /** YouTube video ID. */
  id: string;
  title: string;
  channelId: string;
  channelName: string;
  durationSec: number;
  activitiesGeneratedAt: number;
}

export interface Topic {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
}

export interface StoredActivity extends Activity {
  id: string;
  videoId: string;
  topicId: string;
  fsrs: FsrsCard;
  /** Copy of `fsrs.due` in epoch ms, for the due index. */
  due: number;
  /** 0 or 1: IndexedDB cannot index booleans. */
  suspended: 0 | 1;
  createdAt: number;
  updatedAt: number;
}

export interface ReviewLogEntry {
  id: string;
  activityId: string;
  rating: number;
  reviewedAt: number;
  fsrsLog: FsrsLog;
}

export class LearnDatabase extends Dexie {
  quizCache!: EntityTable<CachedActivities, 'videoId'>;
  videos!: EntityTable<StoredVideo, 'id'>;
  topics!: EntityTable<Topic, 'id'>;
  activities!: EntityTable<StoredActivity, 'id'>;
  reviewLogs!: EntityTable<ReviewLogEntry, 'id'>;

  constructor(name = 'youtube-learn') {
    super(name);
    this.version(1).stores({ quizCache: 'videoId, createdAt' });
    // Version 2 replaced flashcard quizzes with learning activities; old entries are regenerated.
    this.version(2)
      .stores({ quizCache: 'videoId, createdAt' })
      .upgrade((tx) => tx.table('quizCache').clear());
    // Version 3 adds the knowledge bank. Only new tables, so cached activity sets are kept.
    this.version(3).stores({
      videos: 'id',
      topics: 'id, name',
      activities: 'id, videoId, topicId, [suspended+due]',
      reviewLogs: 'id, activityId, reviewedAt',
    });
  }
}

export const db = new LearnDatabase();
