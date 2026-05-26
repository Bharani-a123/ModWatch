import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/server';
import { api } from './api.js';
import { forms } from './forms.js';
import { menu } from './menu.js';
import { scheduledTasks } from './scheduler.js';
import { triggers } from './triggers.js';
import { approveThing, removeThing } from './actions.js';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';

const app = new Hono();
const internal = new Hono();

internal.route('/menu', menu);
internal.route('/form', forms);
internal.route('/triggers', triggers);
internal.route('/scheduler', scheduledTasks);

app.route('/api', api);
app.route('/internal', internal);

app.post('/internal/menu/remove-thing', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  try {
    const message = await removeThing(
      request.targetId as `t1_${string}` | `t3_${string}`
    );
    return c.json<UiResponse>(
      { showToast: { text: message, appearance: 'success' } },
      200
    );
  } catch (error) {
    return c.json<UiResponse>(
      {
        showToast: {
          text: error instanceof Error ? error.message : 'Remove failed.',
          appearance: 'neutral',
        },
      },
      200
    );
  }
});

app.post('/internal/menu/approve-thing', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  try {
    const message = await approveThing(
      request.targetId as `t1_${string}` | `t3_${string}`
    );
    return c.json<UiResponse>(
      { showToast: { text: message, appearance: 'success' } },
      200
    );
  } catch (error) {
    return c.json<UiResponse>(
      {
        showToast: {
          text: error instanceof Error ? error.message : 'Approve failed.',
          appearance: 'neutral',
        },
      },
      200
    );
  }
});

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
