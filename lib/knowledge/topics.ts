import type { LearnDatabase, Topic } from '@/lib/db';

export const FALLBACK_TOPIC = 'General';
const PATH_SEPARATOR = '>';

export function cleanTopicName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** Splits "Parent > Child" into its parts. Topics nest one level, so only the first and last count. */
export function splitTopicPath(name: string): string[] {
  const parts = name.split(PATH_SEPARATOR).map(cleanTopicName).filter(Boolean);
  return parts.length > 2 ? [parts[0]!, parts.at(-1)!] : parts;
}

export function sameTopicName(a: string, b: string): boolean {
  return cleanTopicName(a).toLowerCase() === cleanTopicName(b).toLowerCase();
}

export function topicPath(topic: Topic, byId: ReadonlyMap<string, Topic>): string {
  const parent = topic.parentId ? byId.get(topic.parentId) : undefined;
  return parent ? `${parent.name} > ${topic.name}` : topic.name;
}

export function topicsById(topics: readonly Topic[]): Map<string, Topic> {
  return new Map(topics.map((topic) => [topic.id, topic]));
}

/**
 * Finds a topic by name, "Parent > Child" path, or a former name kept as an alias after a rename
 * or merge. Current names win over aliases.
 */
export function findTopic(topics: readonly Topic[], name: string): Topic | undefined {
  const parts = splitTopicPath(name);
  const leaf = parts.at(-1);
  if (!leaf) return undefined;
  const parent = parts.length > 1 ? findTopic(topics, parts[0]!) : undefined;

  const byName = topics.filter((topic) => sameTopicName(topic.name, leaf));
  const byAlias = topics.filter((topic) =>
    (topic.aliases ?? []).some((alias) => sameTopicName(alias, leaf)),
  );
  for (const matches of [byName, byAlias]) {
    const match = matches.find((topic) => topic.parentId === parent?.id) ?? matches[0];
    if (match) return match;
  }
  return undefined;
}

/** Returns the ID of the matching topic, creating it (and a missing parent) when none matches. */
export async function resolveTopicId(
  db: LearnDatabase,
  name: string,
  now: number,
  newId: () => string,
): Promise<string> {
  const topics = await db.topics.toArray();
  const parts = splitTopicPath(name);
  if (parts.length === 0) parts.push(FALLBACK_TOPIC);
  const existing = findTopic(topics, parts.join(' > '));
  if (existing) return existing.id;

  let parentId: string | null = null;
  if (parts.length > 1) {
    const parent = findTopic(topics, parts[0]!);
    if (parent) {
      parentId = parent.parentId ?? parent.id;
    } else {
      parentId = newId();
      await db.topics.add({ id: parentId, name: parts[0]!, parentId: null, createdAt: now });
    }
  }
  const id = newId();
  await db.topics.add({ id, name: parts.at(-1)!, parentId, createdAt: now });
  return id;
}

/** Topic paths for the generation prompt, newest first. */
export function topicNamesForPrompt(topics: readonly Topic[]): string[] {
  const byId = topicsById(topics);
  return [...topics]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((topic) => topicPath(topic, byId));
}

/** Returns a message when `name` cannot be used for a new or renamed topic. */
export function topicNameProblem(
  name: string,
  topics: readonly Topic[],
  exceptId?: string,
): string | null {
  const cleaned = cleanTopicName(name);
  if (!cleaned) return 'Enter a topic name.';
  if (cleaned.includes(PATH_SEPARATOR)) return 'Topic names cannot contain ">".';
  const taken = topics.find((topic) => topic.id !== exceptId && sameTopicName(topic.name, cleaned));
  return taken
    ? `A topic named "${taken.name}" already exists. Use Merge to combine topics.`
    : null;
}
