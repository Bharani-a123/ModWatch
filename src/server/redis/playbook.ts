type RedisClient = typeof import('@devvit/redis').redis;
import type { PlaybookEntry } from '../../shared/types.js';
import { getJson, parseStringList, setJson } from '../lib/redis-json.js';

const indexKey = 'playbook:index';
const playbookKey = (tag: string): string => `playbook:${tag}`;

export async function getPlaybookEntry(
  redis: RedisClient,
  tag: string
): Promise<PlaybookEntry | null> {
  return await getJson<PlaybookEntry>(redis, playbookKey(tag));
}

export async function getAllPlaybookEntries(
  redis: RedisClient
): Promise<PlaybookEntry[]> {
  const tagsRaw = await redis.get(indexKey);
  const tags = parseStringList(tagsRaw);
  const entries = await Promise.all(
    tags.map(async (tag) => await getPlaybookEntry(redis, tag))
  );
  return entries
    .filter((entry): entry is PlaybookEntry => entry !== null)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function upsertPlaybookEntry(
  redis: RedisClient,
  entry: Omit<PlaybookEntry, 'updatedAt'>
): Promise<PlaybookEntry> {
  const existing = await getPlaybookEntry(redis, entry.tag);
  const next: PlaybookEntry = {
    ...entry,
    createdBy: existing?.createdBy ?? entry.createdBy,
    updatedAt: Date.now(),
  };
  const tags = new Set(parseStringList(await redis.get(indexKey)));
  tags.add(entry.tag);
  await redis.set(indexKey, JSON.stringify([...tags].sort()));
  await setJson(redis, playbookKey(entry.tag), next);
  return next;
}

export async function deletePlaybookEntry(
  redis: RedisClient,
  tag: string
): Promise<void> {
  const tags = parseStringList(await redis.get(indexKey)).filter(
    (entry) => entry !== tag
  );
  await redis.set(indexKey, JSON.stringify(tags));
  await redis.del(playbookKey(tag));
}
