import { RedisClient } from '@devvit/public-api';

export interface ModStats {
  modUsername: string;
  weekKey: string;       // "YYYY-WW" ISO week format
  removes: number;
  approvals: number;
  bans: number;
  warnings: number;
  handovers: number;
  lastActive: number;    // Unix ms
}

const STATS_KEY_PREFIX = 'stats:';

export function getWeekKey(date: Date): string {
  // Use UTC to ensure timezone independence
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  
  // Find Thursday of the current week (ISO day 4)
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  
  // Get Jan 4 of the calculated year
  const year = target.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  
  // Thursday of Jan 4 week
  const jan4Thursday = new Date(jan4.getTime());
  jan4Thursday.setUTCDate(jan4Thursday.getUTCDate() + 4 - jan4Day);

  const diffMs = target.getTime() - jan4Thursday.getTime();
  const weekNum = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
  
  const ww = weekNum.toString().padStart(2, '0');
  return `${year}-${ww}`;
}

export function getTotalActions(stats: ModStats): number {
  return stats.removes + stats.approvals + stats.bans + stats.warnings + stats.handovers;
}

export async function incrementStat(
  redis: RedisClient,
  modUsername: string,
  stat: keyof Pick<ModStats, 'removes'|'approvals'|'bans'|'warnings'|'handovers'>
): Promise<void> {
  const week = getWeekKey(new Date());
  const key = `${STATS_KEY_PREFIX}${modUsername}:${week}`;
  
  // Read-modify-write pattern
  const raw = await redis.get(key);
  let current: ModStats;
  
  if (raw) {
    try {
      current = JSON.parse(raw) as ModStats;
    } catch {
      current = createZeroedStats(modUsername, week);
    }
  } else {
    current = createZeroedStats(modUsername, week);
  }

  current[stat] = (current[stat] || 0) + 1;
  current.lastActive = Date.now();

  // Write back. TTL: 90 days
  await redis.set(key, JSON.stringify(current), {
    expiration: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
  });
}

export async function getWeeklyStats(
  redis: RedisClient,
  modUsernames: string[],
  weekKey: string
): Promise<ModStats[]> {
  const statsList = await Promise.all(
    modUsernames.map(async (username) => {
      const key = `${STATS_KEY_PREFIX}${username}:${weekKey}`;
      const raw = await redis.get(key);
      if (raw) {
        try {
          return JSON.parse(raw) as ModStats;
        } catch {
          return createZeroedStats(username, weekKey);
        }
      }
      return createZeroedStats(username, weekKey);
    })
  );

  // Sort by total actions descending
  return statsList.sort((a, b) => getTotalActions(b) - getTotalActions(a));
}

function createZeroedStats(modUsername: string, weekKey: string): ModStats {
  return {
    modUsername,
    weekKey,
    removes: 0,
    approvals: 0,
    bans: 0,
    warnings: 0,
    handovers: 0,
    lastActive: 0, // 0 signifies "Never this week"
  };
}
