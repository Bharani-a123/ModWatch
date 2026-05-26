type RedisClient = typeof import('@devvit/redis').redis;

export async function getJson<T>(
  redis: RedisClient,
  key: string
): Promise<T | null> {
  const raw = await redis.get(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function setJson(
  redis: RedisClient,
  key: string,
  value: unknown,
  ttlSeconds?: number
): Promise<void> {
  await redis.set(key, JSON.stringify(value));
  if (ttlSeconds) {
    await redis.expire(key, ttlSeconds);
  }
}

export function parseStringList(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}
