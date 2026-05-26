type RedisClient = typeof import('@devvit/redis').redis;
import type { WarningEntry } from '../../shared/types.js';
import { getJson, setJson } from '../lib/redis-json.js';

const warningKey = (targetUsername: string): string =>
  `warnings:${targetUsername.toLowerCase()}`;
const warningIndexKey = 'warnings:index';

async function getWarningIndex(redis: RedisClient): Promise<string[]> {
  return (await getJson<string[]>(redis, warningIndexKey)) ?? [];
}

async function setWarningIndex(
  redis: RedisClient,
  usernames: string[]
): Promise<void> {
  await setJson(redis, warningIndexKey, [...new Set(usernames)].sort());
}

export async function addWarning(
  redis: RedisClient,
  targetUsername: string,
  entry: Omit<WarningEntry, 'warnedAt'>
): Promise<WarningEntry[]> {
  const existing = await getWarnings(redis, targetUsername);
  const next = [{ ...entry, warnedAt: Date.now() }, ...existing].slice(0, 50);
  await setJson(redis, warningKey(targetUsername), next);
  await setWarningIndex(redis, [
    ...(await getWarningIndex(redis)),
    targetUsername.toLowerCase(),
  ]);
  return next;
}

export async function getWarnings(
  redis: RedisClient,
  targetUsername: string
): Promise<WarningEntry[]> {
  return (
    (await getJson<WarningEntry[]>(redis, warningKey(targetUsername))) ?? []
  );
}

export async function clearWarnings(
  redis: RedisClient,
  targetUsername: string
): Promise<void> {
  await redis.del(warningKey(targetUsername));
  await setWarningIndex(
    redis,
    (await getWarningIndex(redis)).filter(
      (entry) => entry !== targetUsername.toLowerCase()
    )
  );
}

export async function listWarningUsers(redis: RedisClient): Promise<string[]> {
  return await getWarningIndex(redis);
}
