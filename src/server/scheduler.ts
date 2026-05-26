import { Hono } from 'hono';
import type { TaskResponse } from '@devvit/scheduler';
import { context } from '@devvit/server';
import { reddit } from '@devvit/reddit';
import { redis } from '@devvit/redis';
import { broadcastDashboardEvent } from './lib/broadcast.js';
import { checkCoverageAndAlert } from './modules/coverageAlert.js';
import { pruneOldIncidents } from './redis/incidents.js';

export const scheduledTasks = new Hono();

scheduledTasks.post('/coverage-check', async (c) => {
  await checkCoverageAndAlert(reddit, redis, context.subredditName);
  return c.json<TaskResponse>({}, 200);
});

scheduledTasks.post('/incident-prune', async (c) => {
  await pruneOldIncidents(redis);
  await broadcastDashboardEvent(redis, {
    type: 'refresh',
    source: 'incident-prune',
    at: Date.now(),
  });
  return c.json<TaskResponse>({}, 200);
});
