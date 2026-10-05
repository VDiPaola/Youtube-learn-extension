import type { StoredActivity, StoredVideo, Topic } from '@/lib/db';
import type { BankContents } from './manage';
import { topicPath, topicsById } from './topics';

export const ALL_TOPICS = 'all';

export interface TopicRow {
  topic: Topic;
  path: string;
  depth: 0 | 1;
  /** Activities in the topic and, for a parent, its subtopics. */
  count: number;
  due: number;
}

export interface VideoGroup {
  videoId: string;
  video: StoredVideo | undefined;
  activities: StoredActivity[];
}

const byName = (a: Topic, b: Topic) => a.name.localeCompare(b.name);

/** Topics in display order: each top-level topic followed by its subtopics, alphabetically. */
export function topicRows(bank: BankContents, now: number): TopicRow[] {
  const byId = topicsById(bank.topics);
  const own = new Map<string, { count: number; due: number }>();
  for (const activity of bank.activities) {
    const stats = own.get(activity.topicId) ?? { count: 0, due: 0 };
    stats.count++;
    if (!activity.suspended && activity.due <= now) stats.due++;
    own.set(activity.topicId, stats);
  }
  const statsOf = (topic: Topic) => own.get(topic.id) ?? { count: 0, due: 0 };

  const rows: TopicRow[] = [];
  const isTopLevel = (topic: Topic) => !topic.parentId || !byId.has(topic.parentId);
  for (const parent of bank.topics.filter(isTopLevel).sort(byName)) {
    const children = bank.topics.filter((t) => t.parentId === parent.id).sort(byName);
    const total = [parent, ...children].map(statsOf);
    rows.push({
      topic: parent,
      path: parent.name,
      depth: 0,
      count: total.reduce((sum, s) => sum + s.count, 0),
      due: total.reduce((sum, s) => sum + s.due, 0),
    });
    for (const child of children) {
      rows.push({ topic: child, path: topicPath(child, byId), depth: 1, ...statsOf(child) });
    }
  }
  return rows;
}

/** Topic IDs a selection covers: the topic and its subtopics, or null for all topics. */
export function selectedTopicIds(topics: readonly Topic[], selected: string): Set<string> | null {
  if (selected === ALL_TOPICS) return null;
  return new Set([selected, ...topics.filter((t) => t.parentId === selected).map((t) => t.id)]);
}

/**
 * Activities in the selected topics that contain every word of the query, newest video first,
 * then in video order. Matching ignores case and accents.
 */
export function filterActivities(
  bank: BankContents,
  selected: string,
  query: string,
): StoredActivity[] {
  const topicIds = selectedTopicIds(bank.topics, selected);
  const videos = new Map(bank.videos.map((video) => [video.id, video]));
  const words = foldText(query).split(/\s+/).filter(Boolean);
  const matches = bank.activities.filter((activity) => {
    if (topicIds && !topicIds.has(activity.topicId)) return false;
    if (words.length === 0) return true;
    const text = foldText(
      [
        activity.prompt,
        activity.answer,
        activity.explanation,
        ...activity.options,
        videos.get(activity.videoId)?.title ?? '',
      ].join(' '),
    );
    return words.every((word) => text.includes(word));
  });
  const addedAt = (activity: StoredActivity) =>
    videos.get(activity.videoId)?.activitiesGeneratedAt ?? activity.createdAt;
  return matches.sort(
    (a, b) =>
      addedAt(b) - addedAt(a) ||
      a.videoId.localeCompare(b.videoId) ||
      a.sourceStartSec - b.sourceStartSec,
  );
}

/** Groups consecutive activities by video, keeping their order. */
export function groupByVideo(
  activities: readonly StoredActivity[],
  videos: readonly StoredVideo[],
): VideoGroup[] {
  const byId = new Map(videos.map((video) => [video.id, video]));
  const groups: VideoGroup[] = [];
  for (const activity of activities) {
    const last = groups.at(-1);
    if (last?.videoId === activity.videoId) last.activities.push(activity);
    else
      groups.push({
        videoId: activity.videoId,
        video: byId.get(activity.videoId),
        activities: [activity],
      });
  }
  return groups;
}

function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
