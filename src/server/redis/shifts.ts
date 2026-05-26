type RedisClient = typeof import('@devvit/redis').redis;
import type { ModShift } from '../../shared/types.js';
import { allSlotIndexes, shiftId, slotIndexToTime } from '../../shared/time.js';

const shiftKey = (date: string, slotIndex: number): string =>
  `shifts:${date}:${slotIndex}`;

export async function getShift(
  redis: RedisClient,
  date: string,
  slotIndex: number
): Promise<ModShift | null> {
  const value = await redis.get(shiftKey(date, slotIndex));
  return value ? (JSON.parse(value) as ModShift) : null;
}

export async function getShiftsForDate(
  redis: RedisClient,
  date: string
): Promise<ModShift[]> {
  const values = await redis.mGet(
    allSlotIndexes().map((slotIndex) => shiftKey(date, slotIndex))
  );
  return values
    .filter((value: string | null): value is string => value !== null)
    .map((value: string) => JSON.parse(value) as ModShift)
    .sort(
      (left: ModShift, right: ModShift) => left.slotIndex - right.slotIndex
    );
}

export async function claimShift(
  redis: RedisClient,
  date: string,
  slotIndex: number,
  modUsername: string,
  notes?: string
): Promise<ModShift> {
  const shift: ModShift = {
    shiftId: shiftId(date, slotIndex),
    date,
    slotIndex,
    modUsername,
    claimedAt: Date.now(),
    ...(notes ? { notes } : {}),
  };
  const key = shiftKey(date, slotIndex);
  const result = await redis.set(key, JSON.stringify(shift), { nx: true });

  if (result === null) {
    const existing = await getShift(redis, date, slotIndex);
    throw new Error(
      `Slot already claimed by ${existing?.modUsername ?? 'another mod'}`
    );
  }

  return shift;
}

export async function releaseShift(
  redis: RedisClient,
  date: string,
  slotIndex: number,
  requestingMod: string,
  isHeadMod: boolean
): Promise<void> {
  const existing = await getShift(redis, date, slotIndex);
  if (!existing) {
    return;
  }

  if (!isHeadMod && existing.modUsername !== requestingMod) {
    throw new Error('Only the assigned mod or head mod can release this slot.');
  }

  await redis.del(shiftKey(date, slotIndex));
}

export async function getUncoveredSlots(
  redis: RedisClient,
  date: string
): Promise<number[]> {
  const shifts = await getShiftsForDate(redis, date);
  const claimed = new Set(shifts.map((shift) => shift.slotIndex));
  return allSlotIndexes().filter((slotIndex) => !claimed.has(slotIndex));
}

export { slotIndexToTime };
