import { RedisClient } from '@devvit/public-api';

export interface PlaybookEntry {
  tag: string;        // unique slug e.g. "friday-raids"
  title: string;
  body: string;       // full detail, markdown supported
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
}

const INDEX_KEY = 'playbook:index';
const ENTRY_KEY_PREFIX = 'playbook:';

export async function getPlaybookEntry(
  redis: RedisClient,
  tag: string
): Promise<PlaybookEntry | null> {
  const raw = await redis.get(`${ENTRY_KEY_PREFIX}${tag}`);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as PlaybookEntry;
  } catch {
    return null;
  }
}

export async function getAllPlaybookEntries(
  redis: RedisClient
): Promise<PlaybookEntry[]> {
  const indexRaw = await redis.get(INDEX_KEY);
  if (!indexRaw) {
    return [];
  }
  let tags: string[];
  try {
    tags = JSON.parse(indexRaw) as string[];
  } catch {
    return [];
  }

  const entries = await Promise.all(
    tags.map(async (tag) => {
      return await getPlaybookEntry(redis, tag);
    })
  );

  const filtered = entries.filter((e): e is PlaybookEntry => e !== null);
  
  // Sort alphabetically by tag
  return filtered.sort((a, b) => a.tag.localeCompare(b.tag));
}

export async function upsertPlaybookEntry(
  redis: RedisClient,
  entry: Omit<PlaybookEntry, 'updatedAt'>
): Promise<PlaybookEntry> {
  const savedEntry: PlaybookEntry = {
    ...entry,
    updatedAt: Date.now(),
  };

  // 1. Write the playbook entry
  await redis.set(`${ENTRY_KEY_PREFIX}${entry.tag}`, JSON.stringify(savedEntry));

  // 2. Update index
  const indexRaw = await redis.get(INDEX_KEY);
  let tags: string[] = [];
  if (indexRaw) {
    try {
      tags = JSON.parse(indexRaw) as string[];
    } catch {
      tags = [];
    }
  }

  if (!tags.includes(entry.tag)) {
    tags.push(entry.tag);
    // Maintain index sort
    tags.sort();
    await redis.set(INDEX_KEY, JSON.stringify(tags));
  }

  return savedEntry;
}

export async function deletePlaybookEntry(
  redis: RedisClient,
  tag: string
): Promise<void> {
  // 1. Delete the entry key
  await redis.del(`${ENTRY_KEY_PREFIX}${tag}`);

  // 2. Remove tag from index
  const indexRaw = await redis.get(INDEX_KEY);
  if (indexRaw) {
    try {
      const tags = JSON.parse(indexRaw) as string[];
      const updatedTags = tags.filter((t) => t !== tag);
      await redis.set(INDEX_KEY, JSON.stringify(updatedTags));
    } catch {
      // Ignore parse failure
    }
  }
}
