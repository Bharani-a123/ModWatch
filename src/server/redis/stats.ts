type RedisClient = typeof import('@devvit/redis').redis;
import type { ModStats, StatName } from '../../shared/types.js';
import { getWeekKey } from '../../shared/time.js';
import { getJson, setJson } from '../lib/redis-json.js';

const statKey = (modUsername: string, weekKey: string): string =>
  `stats:${modUsername}:${weekKey}`;

function emptyStats(modUsername: string, weekKey: string): ModStats {
  return {
    modUsername,
    weekKey,
    removes: 0,
    approvals: 0,
    bans: 0,
    warnings: 0,
    handovers: 0,
    lastActive: Date.now(),
    timeWorked: 0,
  };
}

export async function incrementStat(
  redis: RedisClient,
  modUsername: string,
  stat: StatName
): Promise<void> {
  const weekKey = getWeekKey(new Date());
  const key = statKey(modUsername, weekKey);
  const current =
    (await getJson<ModStats>(redis, key)) ?? emptyStats(modUsername, weekKey);
  current[stat] += 1;
  current.lastActive = Date.now();
  await setJson(redis, key, current, 90 * 24 * 60 * 60);
}

export async function getWeeklyStats(
  redis: RedisClient,
  modUsernames: string[],
  weekKey: string
): Promise<ModStats[]> {
  if (modUsernames.length === 0) {
    return [];
  }
  const values = await redis.mGet(
    modUsernames.map((modUsername) => statKey(modUsername, weekKey))
  );
  return modUsernames
    .map((modUsername, index) => {
      const value = values[index];
      return value
        ? (JSON.parse(value) as ModStats)
        : emptyStats(modUsername, weekKey);
    })
    .sort((left, right) => right.lastActive - left.lastActive);
}

export async function addTimeWorked(
  redis: RedisClient,
  modUsername: string,
  durationMs: number
): Promise<void> {
  const weekKey = getWeekKey(new Date());
  const key = statKey(modUsername, weekKey);
  const current =
    (await getJson<ModStats>(redis, key)) ?? emptyStats(modUsername, weekKey);
  if (current.timeWorked === undefined) {
    current.timeWorked = 0;
  }
  current.timeWorked += durationMs;
  current.lastActive = Date.now();
  await setJson(redis, key, current, 90 * 24 * 60 * 60);
}

export { getWeekKey };
