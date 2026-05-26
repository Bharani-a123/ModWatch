import { RedisClient } from '@devvit/public-api';

export interface WarningEntry {
  id: string;              // "warn_{Date.now()}"
  warnedBy: string;
  warnedAt: number;
  reason: string;
  severity: 'minor' | 'serious' | 'final warning';
  linkedPostId?: string;
  shiftId?: string;
}

const INDEX_KEY = 'warnings:index';
const KEY_PREFIX = 'warnings:';

export async function getWarnings(
  redis: RedisClient,
  targetUsername: string
): Promise<WarningEntry[]> {
  const normalized = targetUsername.toLowerCase().trim();
  const raw = await redis.get(`${KEY_PREFIX}${normalized}`);
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw) as WarningEntry[];
  } catch {
    return [];
  }
}

export async function getAllWarnedUsers(redis: RedisClient): Promise<string[]> {
  const raw = await redis.get(INDEX_KEY);
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export async function addWarning(
  redis: RedisClient,
  targetUsername: string,
  entry: Omit<WarningEntry, 'id' | 'warnedAt'>
): Promise<WarningEntry[]> {
  const normalized = targetUsername.toLowerCase().trim();
  const id = `warn_${Date.now()}`;
  const warnedAt = Date.now();
  const newEntry: WarningEntry = {
    ...entry,
    id,
    warnedAt,
  };

  const existing = await getWarnings(redis, normalized);
  // Prepend to list, cap at 50
  const updated = [newEntry, ...existing].slice(0, 50);

  // Write warning list
  await redis.set(`${KEY_PREFIX}${normalized}`, JSON.stringify(updated));

  // Update index
  const index = await getAllWarnedUsers(redis);
  if (!index.includes(normalized)) {
    index.push(normalized);
    index.sort();
    await redis.set(INDEX_KEY, JSON.stringify(index));
  }

  return updated;
}

export async function clearWarnings(
  redis: RedisClient,
  targetUsername: string
): Promise<void> {
  const normalized = targetUsername.toLowerCase().trim();
  
  // Delete user's warnings
  await redis.del(`${KEY_PREFIX}${normalized}`);

  // Update index
  const index = await getAllWarnedUsers(redis);
  const updatedIndex = index.filter((u) => u !== normalized);
  await redis.set(INDEX_KEY, JSON.stringify(updatedIndex));
}

export function getWarningSummary(warnings: WarningEntry[]): {
  total: number;
  lastSeverity: string;
  shouldEscalate: boolean;
} {
  const total = warnings.length;
  const lastWarn = warnings[0];
  const lastSeverity = lastWarn ? lastWarn.severity : 'none';
  
  // shouldEscalate = true if 3+ warnings OR any 'final warning' severity
  const hasFinal = warnings.some((w) => w.severity === 'final warning');
  const shouldEscalate = total >= 3 || hasFinal;

  return {
    total,
    lastSeverity,
    shouldEscalate,
  };
}
