import { Hono } from 'hono';
import { context } from '@devvit/server';
import { reddit } from '@devvit/reddit';
import { redis } from '@devvit/redis';
import type { UiResponse } from '@devvit/web/shared';
import { addWarning } from './redis/warnings.js';
import { incrementStat } from './redis/stats.js';
import { broadcastDashboardEvent } from './lib/broadcast.js';

type WarnFormValues = {
  targetId?: string;
  reason?: string;
  sendPm?: boolean;
};

export const forms = new Hono();

forms.post('/warn-user-submit', async (c) => {
  const values = await c.req.json<WarnFormValues>();
  const targetId = values.targetId?.trim();
  const reason = values.reason?.trim();
  const modUsername = context.username ?? (await reddit.getCurrentUsername());

  if (!targetId || !reason || !modUsername) {
    return c.json<UiResponse>(
      {
        showToast: { text: 'Missing warning details.', appearance: 'neutral' },
      },
      200
    );
  }

  const target = targetId.startsWith('t1_')
    ? await reddit.getCommentById(targetId as `t1_${string}`)
    : await reddit.getPostById(targetId as `t3_${string}`);

  const targetUsername = target.authorName;
  await addWarning(redis, targetUsername, {
    warnedBy: modUsername,
    reason,
    linkedPostId: targetId,
  });
  await incrementStat(redis, modUsername, 'warnings');

  if (values.sendPm) {
    await reddit.sendPrivateMessage({
      to: targetUsername,
      subject: `Warning from r/${context.subredditName} moderators`,
      text: reason,
    });
  }

  await broadcastDashboardEvent(redis, {
    type: 'refresh',
    source: 'warning-form',
    at: Date.now(),
  });

  return c.json<UiResponse>(
    {
      showToast: {
        text: `Warning logged for u/${targetUsername}`,
        appearance: 'success',
      },
    },
    200
  );
});
