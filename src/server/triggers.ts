import { Hono } from 'hono';
import { reddit } from '@devvit/reddit';
import { redis } from '@devvit/redis';
import { scheduler } from '@devvit/scheduler';
import type { OnModActionRequest, TriggerResponse } from '@devvit/web/shared';
import { incrementStat } from './redis/stats.js';

const DASHBOARD_POST_KEY = 'dashboard:postId';

async function ensureDashboardPost(): Promise<void> {
  const existing = await redis.get(DASHBOARD_POST_KEY);
  if (existing) {
    return;
  }

  const post = await reddit.submitCustomPost({
    subredditName: (await reddit.getCurrentSubreddit()).name,
    title: 'ModWatch - Mod Coordination Dashboard',
    entry: 'default',
    textFallback: { text: 'Open this post to use the ModWatch dashboard.' },
  });
  await redis.set(DASHBOARD_POST_KEY, post.id);
  await post.sticky();
}

async function ensureSchedulers(): Promise<void> {
  await scheduler.runJob({
    name: 'coverage-check',
    cron: '*/15 * * * *',
  });
  await scheduler.runJob({
    name: 'incident-prune',
    cron: '0 3 * * *',
  });
}

export const triggers = new Hono();

triggers.post('/on-app-install', async (_c) => {
  await ensureSchedulers();
  await ensureDashboardPost();
  return _c.json<TriggerResponse>({}, 200);
});

triggers.post('/on-app-upgrade', async (_c) => {
  await ensureSchedulers();
  await ensureDashboardPost();
  return _c.json<TriggerResponse>({}, 200);
});

triggers.post('/on-mod-action', async (c) => {
  const event = await c.req.json<OnModActionRequest>();
  const username = event.moderator?.name;
  if (!username) {
    return c.json<TriggerResponse>({}, 200);
  }

  if (event.action === 'removelink' || event.action === 'removecomment') {
    await incrementStat(redis, username, 'removes');
  } else if (
    event.action === 'approvelink' ||
    event.action === 'approvecomment'
  ) {
    await incrementStat(redis, username, 'approvals');
  } else if (event.action === 'banuser') {
    await incrementStat(redis, username, 'bans');
  }

  return c.json<TriggerResponse>({}, 200);
});
