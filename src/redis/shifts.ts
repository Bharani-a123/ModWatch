import { RedisClient } from '@devvit/public-api';

export interface ModShift {
  shiftId: string;       // format: "YYYY-MM-DD:slotIndex"
  date: string;          // "YYYY-MM-DD"
  slotIndex: number;     // 0-47 (48 half-hour slots per day)
  modUsername: string;
  claimedAt: number;     // Unix ms
}

const getShiftKey = (date: string, slotIndex: number): string => `shifts:${date}:${slotIndex}`;

export async function claimShift(
  redis: RedisClient,
  date: string,
  slotIndex: number,
  modUsername: string
): Promise<ModShift> {
  const key = getShiftKey(date, slotIndex);
  const shift: ModShift = {
    shiftId: `${date}:${slotIndex}`,
    date,
    slotIndex,
    modUsername,
    claimedAt: Date.now(),
  };

  const success = await redis.set(key, JSON.stringify(shift), { nx: true, expiration: new Date(Date.now() + 86400 * 1000) });
  if (success === null || success === undefined || !success) {
    const existingStr = await redis.get(key);
    const existing = existingStr ? (JSON.parse(existingStr) as ModShift) : null;
    const existingMod = existing ? existing.modUsername : 'another mod';
    throw new Error("Slot already claimed by " + existingMod);
  }

  return shift;
}

export async function releaseShift(
  redis: RedisClient,
  date: string,
  slotIndex: number,
  requestingMod: string
): Promise<void> {
  const key = getShiftKey(date, slotIndex);
  const existingStr = await redis.get(key);
  if (!existingStr) {
    return;
  }

  const existing = JSON.parse(existingStr) as ModShift;
  if (existing.modUsername !== requestingMod) {
    throw new Error("Only the claiming mod can release this slot");
  }

  await redis.del(key);
}

export async function getShiftsForDate(
  redis: RedisClient,
  date: string
): Promise<ModShift[]> {
  const keys = Array.from({ length: 48 }, (_, i) => getShiftKey(date, i));
  const values = await Promise.all(keys.map((key) => redis.get(key)));
  
  return values
    .filter((val): val is string => val !== null && val !== undefined)
    .map((val) => JSON.parse(val) as ModShift)
    .sort((a, b) => a.slotIndex - b.slotIndex);
}

export async function getUncoveredSlots(
  redis: RedisClient,
  date: string
): Promise<number[]> {
  const keys = Array.from({ length: 48 }, (_, i) => getShiftKey(date, i));
  const values = await Promise.all(keys.map((key) => redis.get(key)));
  const uncovered: number[] = [];
  
  for (let i = 0; i < 48; i++) {
    if (values[i] === null || values[i] === undefined) {
      uncovered.push(i);
    }
  }
  
  return uncovered;
}

export function slotIndexToTime(slotIndex: number): string {
  const startTotalMinutes = slotIndex * 30;
  const startHour = Math.floor(startTotalMinutes / 60);
  const startMin = startTotalMinutes % 60;
  
  const endTotalMinutes = startTotalMinutes + 30;
  const endHour = Math.floor(endTotalMinutes / 60);
  const endMin = endTotalMinutes % 60;
  
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(startHour)}:${pad(startMin)}-${pad(endHour)}:${pad(endMin)}`;
}

export function getCurrentSlotIndex(): number {
  const now = new Date();
  return Math.floor((now.getUTCHours() * 60 + now.getUTCMinutes()) / 30);
}
