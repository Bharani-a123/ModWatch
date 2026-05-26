type RedisClient = typeof import('@devvit/redis').redis;
import type { HandoverNote } from '../../shared/types.js';
import { getPreviousShift, shiftId } from '../../shared/time.js';

const handoverKey = (value: string): string => `handover:${value}`;

export async function saveHandover(
  redis: RedisClient,
  note: HandoverNote
): Promise<void> {
  await redis.set(handoverKey(note.shiftId), JSON.stringify(note), {
    expiration: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
}

export async function getHandover(
  redis: RedisClient,
  value: string
): Promise<HandoverNote | null> {
  const raw = await redis.get(handoverKey(value));
  return raw ? (JSON.parse(raw) as HandoverNote) : null;
}

export async function getLatestHandover(
  redis: RedisClient,
  currentDate: string,
  currentSlotIndex: number
): Promise<HandoverNote | null> {
  let lookup = { date: currentDate, slotIndex: currentSlotIndex };

  for (let index = 0; index < 3; index += 1) {
    lookup = getPreviousShift(lookup.date, lookup.slotIndex);
    const note = await getHandover(
      redis,
      shiftId(lookup.date, lookup.slotIndex)
    );
    if (note) {
      return note;
    }
  }

  return null;
}
