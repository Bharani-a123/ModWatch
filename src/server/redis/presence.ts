type RedisClient = typeof import('@devvit/redis').redis;

const presenceKey = (modUsername: string): string => `presence:${modUsername}`;
const startKey = (modUsername: string): string => `presence:start:${modUsername}`;

export async function heartbeat(
  redis: RedisClient,
  modUsername: string
): Promise<void> {
  const existingStart = await redis.get(startKey(modUsername));
  const startTime = existingStart ?? Date.now().toString();

  await Promise.all([
    redis.set(presenceKey(modUsername), '1', {
      expiration: new Date(Date.now() + 90_000),
    }),
    redis.set(startKey(modUsername), startTime, {
      expiration: new Date(Date.now() + 90_000),
    }),
  ]);
}

export async function getOnlineMods(
  redis: RedisClient,
  knownMods: string[]
): Promise<string[]> {
  const values = await Promise.all(
    knownMods.map(async (modUsername) => ({
      modUsername,
      online: await redis.get(presenceKey(modUsername)),
    }))
  );

  return values
    .filter((entry) => entry.online !== null)
    .map((entry) => entry.modUsername);
}

export async function getSessionStart(
  redis: RedisClient,
  modUsername: string
): Promise<number | null> {
  const value = await redis.get(startKey(modUsername));
  return value ? Number(value) : null;
}

export async function goOffline(
  redis: RedisClient,
  modUsername: string
): Promise<void> {
  await Promise.all([
    redis.del(presenceKey(modUsername)),
    redis.del(startKey(modUsername)),
  ]);
}
