import { context } from '@devvit/server';
import { reddit } from '@devvit/reddit';
import { redis } from '@devvit/redis';
import {
  acquireLock,
  getLockHolder,
  releaseLock,
} from './modules/actionLock.js';
import { incrementStat } from './redis/stats.js';
import { broadcastDashboardEvent } from './lib/broadcast.js';

export async function removeThing(
  thingId: `t1_${string}` | `t3_${string}`
): Promise<string> {
  const username = context.username ?? (await reddit.getCurrentUsername());
  if (!username) {
    throw new Error('No moderator session available.');
  }

  const acquired = await acquireLock(redis, thingId, username);
  if (!acquired) {
    const holder = await getLockHolder(redis, thingId);
    throw new Error(`Already being actioned by u/${holder ?? 'another mod'}`);
  }

  try {
    await reddit.remove(thingId, false);
    await incrementStat(redis, username, 'removes');
    await broadcastDashboardEvent(redis, {
      type: 'refresh',
      source: 'remove-action',
      at: Date.now(),
    });
    return 'Content removed.';
  } finally {
    await releaseLock(redis, thingId);
  }
}

export async function approveThing(
  thingId: `t1_${string}` | `t3_${string}`
): Promise<string> {
  const username = context.username ?? (await reddit.getCurrentUsername());
  if (!username) {
    throw new Error('No moderator session available.');
  }

  const acquired = await acquireLock(redis, thingId, username);
  if (!acquired) {
    const holder = await getLockHolder(redis, thingId);
    throw new Error(`Already being actioned by u/${holder ?? 'another mod'}`);
  }

  try {
    await reddit.approve(thingId);
    await incrementStat(redis, username, 'approvals');
    await broadcastDashboardEvent(redis, {
      type: 'refresh',
      source: 'approve-action',
      at: Date.now(),
    });
    return 'Content approved.';
  } finally {
    await releaseLock(redis, thingId);
  }
}
