import { realtime } from '@devvit/realtime/server';
import type { DashboardEvent } from '../../shared/types.js';

type RedisClient = typeof import('@devvit/redis').redis;

const DASHBOARD_POST_KEY = 'dashboard:postId';

export async function broadcastDashboardEvent(
  redis: RedisClient,
  event: DashboardEvent
): Promise<void> {
  const postId = await redis.get(DASHBOARD_POST_KEY);
  if (!postId) {
    return;
  }

  await realtime.send(postId, event);
}
