import { Hono } from 'hono';
import { reddit } from '@devvit/reddit';
import { redis } from '@devvit/redis';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import { warnUserFormDef } from '../shared/forms.js';

const DASHBOARD_POST_KEY = 'dashboard:postId';

export const menu = new Hono();

menu.post('/open-dashboard', async (_c) => {
  const postId = await redis.get(DASHBOARD_POST_KEY);
  if (!postId) {
    return _c.json<UiResponse>(
      {
        showToast: {
          text: 'Dashboard post not found yet.',
          appearance: 'neutral',
        },
      },
      200
    );
  }

  const post = await reddit.getPostById(postId as `t3_${string}`);
  return _c.json<UiResponse>(
    { navigateTo: { url: post.url, permalink: post.permalink } },
    200
  );
});

menu.post('/warn-user', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'warnUser',
        form: warnUserFormDef,
        data: { targetId: request.targetId },
      },
    },
    200
  );
});
