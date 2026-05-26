type RedisClient = typeof import('@devvit/redis').redis;
type RedditClient = typeof import('@devvit/reddit').reddit;
import { getCurrentDateAndSlot, slotIndexToTime, addDays } from '../../shared/time.js';
import { getModeratorNames } from '../lib/mods.js';
import { getOnlineMods } from '../redis/presence.js';
import { getShift } from '../redis/shifts.js';

export async function checkCoverageAndAlert(
  reddit: RedditClient,
  redis: RedisClient,
  subredditName: string
): Promise<void> {
  const { date, slotIndex } = getCurrentDateAndSlot(new Date());
  const current = await getShift(redis, date, slotIndex);

  const nextDate = slotIndex === 47 ? addDays(date, 1) : date;
  const nextSlotIndex = slotIndex === 47 ? 0 : slotIndex + 1;
  const next = await getShift(redis, nextDate, nextSlotIndex);
  const moderators = await getModeratorNames(reddit, subredditName);
  const onlineMods = await getOnlineMods(redis, moderators);

  if (current || next || onlineMods.length > 0) {
    return;
  }

  await reddit.sendPrivateMessage({
    to: `/r/${subredditName}`,
    subject: `ModWatch: No coverage for ${slotIndexToTime(slotIndex)}`,
    text: [
      `ModWatch detected no claimed coverage for ${slotIndexToTime(slotIndex)} or the next slot.`,
      '',
      'No moderators are currently marked online.',
      '',
      'Please open the ModWatch dashboard and claim a shift if someone can cover.',
    ].join('\n'),
  });
}
