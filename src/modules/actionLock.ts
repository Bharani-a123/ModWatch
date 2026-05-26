import { RedisClient } from '@devvit/public-api';

const getLockKey = (thingId: string): string => `lock:${thingId}`;

export async function acquireLock(
  redis: RedisClient,
  thingId: string,
  modUsername: string
): Promise<boolean> {
  const key = getLockKey(thingId);
  const result = await redis.set(key, modUsername, {
    nx: true,
    expiration: new Date(Date.now() + 30000), // 30-second lock TTL
  });
  return result !== null && result !== undefined;
}

export async function releaseLock(redis: RedisClient, thingId: string): Promise<void> {
  const key = getLockKey(thingId);
  await redis.del(key);
}

export async function getLockHolder(redis: RedisClient, thingId: string): Promise<string | null> {
  const key = getLockKey(thingId);
  const val = await redis.get(key);
  return val ?? null;
}
