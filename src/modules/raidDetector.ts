import { TriggerContext, RedisClient } from '@devvit/public-api';
import { getOnlineMods } from '../redis/presence.js';
import { addIncident } from '../redis/incidents.js';

export async function checkForRaidPattern(
  context: TriggerContext,
  modUsername: string
): Promise<void> {
  const { redis, reddit } = context;

  // 1. Calculate windowKey (10-minute windows)
  const windowKey = Math.floor(Date.now() / 600000);

  // 2. Increment rolling counter
  const counterKey = `raid:counter:${modUsername}:${windowKey}`;
  const currentStr = await redis.get(counterKey);
  const currentCount = parseInt(currentStr || '0', 10);
  const newCount = currentCount + 1;

  // Write back with 10 minutes (600s) TTL
  await redis.set(counterKey, String(newCount), {
    expiration: new Date(Date.now() + 600 * 1000),
  });

  // 3. Read current count for this window across ALL mods
  const subreddit = await reddit.getCurrentSubreddit();
  const allMods = await reddit.getModerators({ subredditName: subreddit.name }).all();
  const usernames = allMods
    .map((m) => m.username)
    .filter((u): u is string => u !== undefined && u !== null);

  const counts = await Promise.all(
    usernames.map((u) => redis.get(`raid:counter:${u}:${windowKey}`))
  );

  const totalRemovals = counts
    .map((c) => parseInt(c || '0', 10))
    .reduce((a, b) => a + b, 0);

  // 4. Threshold checks
  if (totalRemovals < 5) {
    return; // Do not alert on first removal or if total < 5
  }

  // Check dedup key
  const dedupKey = `raid:alerted:${windowKey}`;
  const alreadyAlerted = await redis.get(dedupKey);
  if (alreadyAlerted) {
    return; // Skip already alerted this window
  }

  // Set dedup key with 10 minutes (600s) TTL
  await redis.set(dedupKey, 'true', {
    expiration: new Date(Date.now() + 600 * 1000),
  });

  // 5. Auto-create incident
  const severity = totalRemovals >= 10 ? ('high' as const) : ('medium' as const);
  const detail = `${totalRemovals} posts removed in the last 10 minutes — possible coordinated attack. Check new accounts posting similar content.`;

  await addIncident(redis as unknown as RedisClient, {
    title: '🚨 Possible raid detected',
    detail,
    severity,
    createdBy: 'ModWatch (auto)',
  });

  // 6. Send coverage alert if no backup mod is online
  const onlineMods = await getOnlineMods(redis as unknown as RedisClient, usernames);
  const backupMods = onlineMods.filter((m) => m.modUsername !== modUsername);

  if (backupMods.length === 0) {
    // Get direct link to ModWatch dashboard post
    const postId = await redis.get('dashboard:postId');
    const dashboardPostUrl = postId
      ? `https://reddit.com/comments/${postId.replace(/^t3_/, '')}`
      : `https://reddit.com/r/${subreddit.name}`;

    const subject = `🚨 URGENT: Raid Alert - Backup Needed`;
    const text = [
      `ModWatch auto raid alert generated for r/${subreddit.name}:`,
      '',
      `A possible raid is in progress (${totalRemovals} removals in the last 10 minutes).`,
      `u/${modUsername} is currently the only active moderator online.`,
      '',
      `No backup moderators are currently online to assist.`,
      '',
      `Claim a shift or assist: ${dashboardPostUrl}`,
    ].join('\n');

    await reddit.sendPrivateMessage({
      to: subreddit.name,
      subject,
      text,
    });
  }
}
