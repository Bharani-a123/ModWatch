import { RedisClient } from '@devvit/public-api';

export interface PresenceRecord {
  modUsername: string;
  onlineSince: number;    // Unix ms when they came online
  currentShift?: string | undefined;  // slotIndexToTime result or undefined
}

const getPresenceKey = (modUsername: string): string => `presence:${modUsername}`;

export async function heartbeat(
  redis: RedisClient,
  modUsername: string,
  shiftInfo?: string
): Promise<void> {
  const key = getPresenceKey(modUsername);
  const existingStr = await redis.get(key);
  
  let onlineSince = Date.now();
  if (existingStr) {
    try {
      const existing = JSON.parse(existingStr) as PresenceRecord;
      onlineSince = existing.onlineSince;
    } catch {
      // Fallback if parsing fails
    }
  }

  const record: PresenceRecord = {
    modUsername,
    onlineSince,
    currentShift: shiftInfo,
  };

  // Heartbeat expires in 90 seconds (ex: 90 equivalent)
  await redis.set(key, JSON.stringify(record), {
    expiration: new Date(Date.now() + 90 * 1000),
  });
}

export async function getOnlineMods(
  redis: RedisClient,
  allModUsernames: string[]
): Promise<PresenceRecord[]> {
  const keys = allModUsernames.map((username) => getPresenceKey(username));
  const values = await Promise.all(keys.map((key) => redis.get(key)));

  return values
    .filter((val): val is string => val !== null && val !== undefined)
    .map((val) => JSON.parse(val) as PresenceRecord);
}

export async function goOffline(redis: RedisClient, modUsername: string): Promise<void> {
  const key = getPresenceKey(modUsername);
  await redis.del(key);
}

export function getSessionDuration(onlineSince: number): string {
  const diffMs = Math.max(0, Date.now() - onlineSince);
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 60) {
    return `${diffMins}m`;
  }
  
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  
  if (mins === 0) {
    return `${hours}h`;
  }
  
  return `${hours}h ${mins}m`;
}
