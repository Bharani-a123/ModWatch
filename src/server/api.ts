import { Hono } from 'hono';
import { context } from '@devvit/server';
import { reddit } from '@devvit/reddit';
import { redis } from '@devvit/redis';
import type { ApiError, DashboardSnapshot, Incident, ChatMessage, OnlineModStatus } from '../shared/types.js';
import { getCurrentDateAndSlot, getWeekKey, addDays, slotIndexToTime } from '../shared/time.js';
import { broadcastDashboardEvent } from './lib/broadcast.js';
import {
  assertHeadMod,
  getHeadModUsername,
  getModeratorNames,
  isHeadMod,
} from './lib/mods.js';
import { getLatestHandover, saveHandover, getHandover } from './redis/handover.js';
import {
  addIncident,
  getIncidents,
  resolveIncident,
  updateIncident,
  deleteIncident,
} from './redis/incidents.js';
import {
  getAllPlaybookEntries,
  upsertPlaybookEntry,
  deletePlaybookEntry,
} from './redis/playbook.js';
import { getOnlineMods, heartbeat, goOffline, getSessionStart } from './redis/presence.js';
import { claimShift, getShiftsForDate, releaseShift } from './redis/shifts.js';
import { getWeeklyStats, incrementStat, addTimeWorked } from './redis/stats.js';
import {
  addWarning,
  clearWarnings,
  getWarnings,
  listWarningUsers,
} from './redis/warnings.js';
import { getJson, setJson } from './lib/redis-json.js';

type AppBindings = {
  Variables: {
    username?: string;
    subredditName: string;
  };
};

function ok<T>(value: T): { ok: true } & T {
  return { ok: true, ...value };
}

function error(message: string): ApiError {
  return { ok: false, error: message };
}

async function currentUsername(): Promise<string | undefined> {
  return context.username ?? (await reddit.getCurrentUsername());
}

async function buildSnapshot(date?: string): Promise<DashboardSnapshot> {
  const username = await currentUsername();
  const subredditName = context.subredditName;
  const moderators = await getModeratorNames(reddit, subredditName);
  const now = new Date();
  const current = getCurrentDateAndSlot(now);
  const activeDate = date ?? current.date;
  const [
    shiftsYesterday,
    shiftsToday,
    shiftsTomorrow,
    latestHandover,
    incidents,
    playbook,
    onlineModNames,
    stats,
    warningUsers,
    headMod,
  ] = await Promise.all([
    getShiftsForDate(redis, addDays(activeDate, -1)),
    getShiftsForDate(redis, activeDate),
    getShiftsForDate(redis, addDays(activeDate, 1)),
    getLatestHandover(redis, current.date, current.slotIndex),
    getIncidents(redis),
    getAllPlaybookEntries(redis),
    getOnlineMods(redis, moderators),
    getWeeklyStats(redis, moderators, getWeekKey(now)),
    listWarningUsers(redis),
    getHeadModUsername(reddit, subredditName),
  ]);

  const shifts = [...shiftsToday, ...shiftsTomorrow];

  let expiredShiftId: string | undefined;
  if (username) {
    const pastClaimed = [...shiftsYesterday, ...shiftsToday].filter((shift) => {
      if (shift.modUsername !== username) return false;
      if (shift.date < current.date) return true;
      if (shift.date === current.date && shift.slotIndex < current.slotIndex) return true;
      return false;
    });

    for (const shift of pastClaimed) {
      const note = await getHandover(redis, shift.shiftId);
      if (!note) {
        expiredShiftId = shift.shiftId;
        break;
      }
    }
  }

  const onlineMods: OnlineModStatus[] = await Promise.all(
    onlineModNames.map(async (name) => {
      const sessionStart = (await getSessionStart(redis, name)) ?? Date.now();
      const activeShift = [...shiftsYesterday, ...shiftsToday, ...shiftsTomorrow].find(
        (shift) =>
          shift.modUsername === name &&
          shift.date === current.date &&
          shift.slotIndex === current.slotIndex
      );
      return {
        username: name,
        sessionStart,
        ...(activeShift ? {
          currentShift: slotIndexToTime(activeShift.slotIndex),
          currentShiftSlotIndex: activeShift.slotIndex,
          currentShiftDate: activeShift.date
        } : {}),
      };
    })
  );

  const warningsDirectory = await Promise.all(
    warningUsers.map(async (warnedUsername) => {
      const warnings = await getWarnings(redis, warnedUsername);
      return {
        username: warnedUsername,
        count: warnings.length,
        latestAt: warnings[0]?.warnedAt,
      };
    })
  );

  return {
    subredditName,
    ...(username ? { currentMod: username } : {}),
    isHeadMod: await isHeadMod(reddit, subredditName, username),
    ...(headMod ? { headMod } : {}),
    currentDate: activeDate,
    currentSlotIndex: current.date === activeDate ? current.slotIndex : -1,
    shifts,
    latestHandover,
    incidents,
    playbook,
    onlineMods,
    stats,
    warningsDirectory: warningsDirectory
      .map((entry) => ({
        username: entry.username,
        count: entry.count,
        ...(entry.latestAt ? { latestAt: entry.latestAt } : {}),
      }))
      .sort((left, right) => right.count - left.count),
    moderators,
    ...(expiredShiftId ? { expiredShiftId } : {}),
  };
}

async function publishRefresh(source: string): Promise<void> {
  await broadcastDashboardEvent(redis, {
    type: 'refresh',
    source,
    at: Date.now(),
  });
}

export const api = new Hono<AppBindings>();

api.get('/snapshot', async (c) => {
  const date = c.req.query('date') ?? undefined;
  return c.json(ok({ snapshot: await buildSnapshot(date) }));
});

api.post('/presence/heartbeat', async (c) => {
  const username = await currentUsername();
  if (!username) {
    return c.json(error('You must be logged in.'), 401);
  }

  await heartbeat(redis, username);
  await broadcastDashboardEvent(redis, {
    type: 'presence',
    modUsername: username,
    online: true,
    at: Date.now(),
  });
  return c.json(ok({}));
});

api.post('/presence/offline', async (c) => {
  const username = await currentUsername();
  if (!username) {
    return c.json(error('You must be logged in.'), 401);
  }

  const sessionStart = await getSessionStart(redis, username);
  if (sessionStart) {
    const durationMs = Date.now() - sessionStart;
    await addTimeWorked(redis, username, durationMs);
  }

  await goOffline(redis, username);
  await broadcastDashboardEvent(redis, {
    type: 'presence',
    modUsername: username,
    online: false,
    at: Date.now(),
  });
  await publishRefresh('presence-offline');
  return c.json(ok({}));
});

api.post('/shifts/claim', async (c) => {
  const username = await currentUsername();
  if (!username) {
    return c.json(error('You must be logged in.'), 401);
  }

  const { date, slotIndex, notes } = await c.req.json<{
    date: string;
    slotIndex: number;
    notes?: string;
  }>();

  const shift = await claimShift(redis, date, slotIndex, username, notes);
  await heartbeat(redis, username);
  await publishRefresh('shift-claim');
  return c.json(ok({ shift }));
});

api.post('/shifts/release', async (c) => {
  const username = await currentUsername();
  if (!username) {
    return c.json(error('You must be logged in.'), 401);
  }

  const { date, slotIndex } = await c.req.json<{
    date: string;
    slotIndex: number;
  }>();
  await releaseShift(
    redis,
    date,
    slotIndex,
    username,
    await isHeadMod(reddit, context.subredditName, username)
  );
  await publishRefresh('shift-release');
  return c.json(ok({}));
});

api.post('/handover', async (c) => {
  const username = await currentUsername();
  if (!username) {
    return c.json(error('You must be logged in.'), 401);
  }

  const payload = await c.req.json<{
    shiftId: string;
    toMod?: string;
    freeText: string;
    warnings?: string[];
    openIncidents?: string | string[];
    usersToWatch?: string[];
    urgentNote?: string;
  }>();

  const sessionStart = await getSessionStart(redis, username);
  if (sessionStart) {
    const durationMs = Date.now() - sessionStart;
    await addTimeWorked(redis, username, durationMs);
  }

  await saveHandover(redis, {
    shiftId: payload.shiftId,
    fromMod: username,
    ...(payload.toMod ? { toMod: payload.toMod } : {}),
    writtenAt: Date.now(),
    openIncidents: payload.openIncidents ?? [],
    warnings: payload.warnings ?? [],
    freeText: payload.freeText,
    ...(payload.usersToWatch ? { usersToWatch: payload.usersToWatch } : {}),
    ...(payload.urgentNote ? { urgentNote: payload.urgentNote } : {}),
  });
  await incrementStat(redis, username, 'handovers');
  await goOffline(redis, username);
  await publishRefresh('handover');
  return c.json(ok({}));
});

api.post('/incidents', async (c) => {
  const username = await currentUsername();
  if (!username) {
    return c.json(error('You must be logged in.'), 401);
  }

  const payload = await c.req.json<{
    title: string;
    detail: string;
    severity: Incident['severity'];
    linkedPostId?: string;
  }>();

  const incident = await addIncident(redis, {
    title: payload.title,
    detail: payload.detail,
    severity: payload.severity,
    ...(payload.linkedPostId ? { linkedPostId: payload.linkedPostId } : {}),
    createdBy: username,
  });
  await publishRefresh('incident-add');
  return c.json(ok({ incident }));
});

api.post('/incidents/:id/resolve', async (c) => {
  const username = await currentUsername();
  if (!username) {
    return c.json(error('You must be logged in.'), 401);
  }

  await resolveIncident(redis, c.req.param('id'), username);
  await publishRefresh('incident-resolve');
  return c.json(ok({}));
});

api.post('/incidents/:id', async (c) => {
  const username = await currentUsername();
  if (!username) {
    return c.json(error('You must be logged in.'), 401);
  }
  const id = c.req.param('id');
  const payload = await c.req.json<{
    title: string;
    detail: string;
    severity: Incident['severity'];
  }>();

  await updateIncident(redis, id, {
    title: payload.title,
    detail: payload.detail,
    severity: payload.severity,
  });
  await publishRefresh('incident-edit');
  return c.json(ok({}));
});

api.delete('/incidents/:id', async (c) => {
  const username = await currentUsername();
  if (!username) {
    return c.json(error('You must be logged in.'), 401);
  }
  const id = c.req.param('id');
  await deleteIncident(redis, id);
  await publishRefresh('incident-delete');
  return c.json(ok({}));
});

api.post('/playbook', async (c) => {
  const username = await currentUsername();
  if (!username) {
    return c.json(error('You must be logged in.'), 401);
  }

  const payload = await c.req.json<{
    tag: string;
    title: string;
    body: string;
  }>();

  const entry = await upsertPlaybookEntry(redis, {
    tag: payload.tag.trim().toLowerCase(),
    title: payload.title.trim(),
    body: payload.body.trim(),
    createdBy: username,
    updatedBy: username,
  });
  await publishRefresh('playbook-upsert');
  return c.json(ok({ entry }));
});

api.delete('/playbook/:tag', async (c) => {
  const username = await currentUsername();
  if (!username) {
    return c.json(error('You must be logged in.'), 401);
  }
  await deletePlaybookEntry(redis, c.req.param('tag'));
  await publishRefresh('playbook-delete');
  return c.json(ok({}));
});

api.get('/warnings/:username', async (c) => {
  return c.json(
    ok({ warnings: await getWarnings(redis, c.req.param('username')) })
  );
});

api.post('/warnings', async (c) => {
  const username = await currentUsername();
  if (!username) {
    return c.json(error('You must be logged in.'), 401);
  }

  const payload = await c.req.json<{
    targetUsername: string;
    reason: string;
    linkedPostId?: string;
    shiftId?: string;
  }>();

  const warnings = await addWarning(redis, payload.targetUsername, {
    warnedBy: username,
    reason: payload.reason,
    ...(payload.linkedPostId ? { linkedPostId: payload.linkedPostId } : {}),
    ...(payload.shiftId ? { shiftId: payload.shiftId } : {}),
  });
  await incrementStat(redis, username, 'warnings');
  await publishRefresh('warning-add');
  return c.json(ok({ warnings }));
});

api.delete('/warnings/:username', async (c) => {
  const username = await currentUsername();
  await assertHeadMod(reddit, context.subredditName, username);
  await clearWarnings(redis, c.req.param('username'));
  await publishRefresh('warning-clear');
  return c.json(ok({}));
});

api.get('/stats', async (c) => {
  const weekKey = c.req.query('weekKey') ?? getWeekKey(new Date());
  const moderators = await getModeratorNames(reddit, context.subredditName);
  return c.json(
    ok({ stats: await getWeeklyStats(redis, moderators, weekKey) })
  );
});

api.get('/chat', async (c) => {
  const messages = await getJson<ChatMessage[]>(redis, 'chat:messages');
  return c.json(ok({ messages: messages ?? [] }));
});

api.post('/chat', async (c) => {
  const username = await currentUsername();
  if (!username) {
    return c.json(error('You must be logged in.'), 401);
  }

  const { text } = await c.req.json<{ text: string }>();
  if (!text || !text.trim()) {
    return c.json(error('Message text cannot be empty.'), 400);
  }

  const messages = (await getJson<ChatMessage[]>(redis, 'chat:messages')) ?? [];
  const newMessage: ChatMessage = {
    id: `msg_${Date.now()}`,
    fromMod: username,
    text: text.trim(),
    sentAt: Date.now(),
  };

  messages.push(newMessage);
  const capped = messages.slice(-50);

  await setJson(redis, 'chat:messages', capped, 24 * 60 * 60);

  return c.json(ok({ messages: capped }));
});
