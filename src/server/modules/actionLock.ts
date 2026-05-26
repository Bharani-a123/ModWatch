type RedisClient = typeof import('@devvit/redis').redis;

const lockKey = (thingId: string): string => `lock:${thingId}`;

export async function acquireLock(
  redis: RedisClient,
  thingId: string,
  modUsername: string
): Promise<boolean> {
  const result = await redis.set(lockKey(thingId), modUsername, {
    nx: true,
    expiration: new Date(Date.now() + 30_000),
  });
  return result !== null;
}

export async function releaseLock(
  redis: RedisClient,
  thingId: string
): Promise<void> {
  await redis.del(lockKey(thingId));
}

export async function getLockHolder(
  redis: RedisClient,
  thingId: string
): Promise<string | null> {
  return (await redis.get(lockKey(thingId))) ?? null;
}
