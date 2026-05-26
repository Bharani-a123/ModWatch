import { RedisClient } from '@devvit/public-api';

export interface HandoverNote {
  shiftId: string;
  fromMod: string;
  writtenAt: number;
  freeText: string;          // "What happened this shift?"
  usersToWatch: string[];    // parsed from comma-separated input
  openIncidents: string;     // free text
  urgentNote: string;        // "Anything urgent for next mod?"
}

export async function saveHandover(redis: RedisClient, note: HandoverNote): Promise<void> {
  const key = `handover:${note.shiftId}`;
  
  // Save note with 7-day expiration
  await redis.set(key, JSON.stringify(note), {
    expiration: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  // Append shiftId to a JSON-serialized list to index it (supports all Redis clients)
  const indexKey = "handover:index";
  const indexStr = await redis.get(indexKey);
  const index: string[] = indexStr ? (JSON.parse(indexStr) as string[]) : [];

  if (!index.includes(note.shiftId)) {
    index.push(note.shiftId);
    // Cap at most recent 100 entries to prevent key size bloat
    const capped = index.slice(-100);
    await redis.set(indexKey, JSON.stringify(capped));
  }
}

export async function getHandover(redis: RedisClient, shiftId: string): Promise<HandoverNote | null> {
  const raw = await redis.get(`handover:${shiftId}`);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as HandoverNote;
  } catch {
    return null;
  }
}

export async function getLatestHandover(redis: RedisClient): Promise<HandoverNote | null> {
  // Fetch shift IDs from JSON index
  const indexKey = "handover:index";
  const indexStr = await redis.get(indexKey);
  const index: string[] = indexStr ? (JSON.parse(indexStr) as string[]) : [];

  if (index.length === 0) {
    return null;
  }

  // Iterate backwards through the last 5 shifts (most recent first)
  const lastFive = index.slice(-5).reverse();
  for (const id of lastFive) {
    const note = await getHandover(redis, id);
    if (note) {
      return note;
    }
  }

  return null;
}
