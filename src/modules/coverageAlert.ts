import { TriggerContext } from '@devvit/public-api';
import { getOnlineMods } from '../redis/presence.js';
import { ModShift, slotIndexToTime } from '../redis/shifts.js';

const LAST_SENT_KEY = 'alert:lastSent';

const getSlotDateAndIndex = (baseDateStr: string, slot: number) => {
  if (slot < 48) {
    return { date: baseDateStr, slotIndex: slot };
  }
  
  // Wrap to the next day in UTC
  const parts = baseDateStr.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]) - 1;
  const d = Number(parts[2]);
  
  const targetDate = new Date(Date.UTC(y, m, d + Math.floor(slot / 48)));
  const adjustedDateStr = targetDate.toISOString().split('T')[0] || '';
  const adjustedSlotIndex = slot % 48;
  
  return { date: adjustedDateStr, slotIndex: adjustedSlotIndex };
};

const getShift = async (
  redis: TriggerContext['redis'],
  date: string,
  slotIndex: number
): Promise<ModShift | null> => {
  const raw = await redis.get(`shifts:${date}:${slotIndex}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ModShift;
  } catch {
    return null;
  }
};

export async function checkCoverageAndAlert(context: TriggerContext): Promise<void> {
  const { redis, reddit } = context;

  // 1. Get current UTC date and slot index
  const now = new Date();
  const currentSlot = Math.floor((now.getUTCHours() * 60 + now.getUTCMinutes()) / 30);
  const dateStr = now.toISOString().split('T')[0] || '';

  // 2. Check current AND next 2 slots for coverage
  const slot0Info = getSlotDateAndIndex(dateStr, currentSlot);
  const slot1Info = getSlotDateAndIndex(dateStr, currentSlot + 1);
  const slot2Info = getSlotDateAndIndex(dateStr, currentSlot + 2);

  const slots = await Promise.all([
    getShift(redis, slot0Info.date, slot0Info.slotIndex),
    getShift(redis, slot1Info.date, slot1Info.slotIndex),
    getShift(redis, slot2Info.date, slot2Info.slotIndex),
  ]);

  const slotsData = [
    { ...slot0Info, time: slotIndexToTime(slot0Info.slotIndex), covered: !!slots[0] },
    { ...slot1Info, time: slotIndexToTime(slot1Info.slotIndex), covered: !!slots[1] },
    { ...slot2Info, time: slotIndexToTime(slot2Info.slotIndex), covered: !!slots[2] },
  ];

  const uncoveredCount = slotsData.filter((s) => !s.covered).length;

  // 3. Get online mods
  const subreddit = await reddit.getCurrentSubreddit();
  const modsList = await reddit.getModerators({ subredditName: subreddit.name }).all();
  const modUsernames = modsList
    .map((m) => m.username)
    .filter((u): u is string => u !== undefined && u !== null);

  const onlineMods = await getOnlineMods(redis, modUsernames);

  // 4. Alert conditions
  let alertSubject = '';
  if (uncoveredCount >= 2 && onlineMods.length === 0) {
    alertSubject = '⚠️ URGENT: No mod coverage for next 1.5 hours';
  } else if (uncoveredCount >= 1 && onlineMods.length === 0) {
    alertSubject = '⚠️ No mod coverage for next 30 minutes';
  } else if (uncoveredCount === 3 && onlineMods.length <= 1) {
    alertSubject = '📋 Heads up: next 1.5 hours is understaffed';
  }

  // If no conditions met, return
  if (!alertSubject) {
    return;
  }

  // 5. Rate limit alerts — check alert:lastSent before sending
  const lastSent = await redis.get(LAST_SENT_KEY);
  if (lastSent) {
    // Skip sending to prevent spam
    return;
  }

  // Write alert:lastSent = "1" with 30 minutes TTL
  await redis.set(LAST_SENT_KEY, '1', {
    expiration: new Date(Date.now() + 30 * 60 * 1000),
  });

  // Get direct link to ModWatch dashboard post
  const postId = await redis.get('dashboard:postId');
  const dashboardPostUrl = postId
    ? `https://reddit.com/comments/${postId.replace(/^t3_/, '')}`
    : `https://reddit.com/r/${subreddit.name}`;

  // Formulate uncovered slots listing
  const uncoveredList = slotsData
    .filter((s) => !s.covered)
    .map((s) => `- Slot: ${s.date} ${s.time}`)
    .join('\n');

  // 6. Send modmail
  const alertBody = [
    `ModWatch alert generated for r/${subreddit.name}:`,
    '',
    `Uncovered slot(s) detected:`,
    uncoveredList,
    '',
    `Current online moderators count: ${onlineMods.length}`,
    '',
    `Claim a shift: ${dashboardPostUrl}`,
  ].join('\n');

  await reddit.sendPrivateMessage({
    to: subreddit.name,
    subject: alertSubject,
    text: alertBody,
  });
}
