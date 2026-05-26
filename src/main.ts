import {
  Devvit,
  MenuItemOnPressEvent,
  Context,
} from '@devvit/public-api';
import { acquireLock, releaseLock, getLockHolder } from './modules/actionLock.js';
import { incrementStat } from './server/redis/stats.js';
import { addWarning, getWarnings } from './server/redis/warnings.js';
import { checkCoverageAndAlert } from './modules/coverageAlert.js';
import { pruneOldIncidents } from './redis/incidents.js';
import { checkForRaidPattern } from './modules/raidDetector.js';

// 1. Form definition for Mod Warnings
const warnUserForm = Devvit.createForm(
  () => ({
    fields: [
      {
        name: 'reason',
        type: 'string',
        label: 'Reason',
        required: true,
      },
      {
        name: 'severity',
        type: 'select',
        label: 'Severity',
        options: [
          { label: 'Minor', value: 'minor' },
          { label: 'Serious', value: 'serious' },
          { label: 'Final Warning', value: 'final warning' },
        ],
        required: true,
      },
    ],
    title: 'Warn user',
    acceptLabel: 'Submit warning',
  }),
  async (event, context) => {
    // Recover targetId and authorUsername from temporary Redis session
    const tempStr = await context.redis.get(`temp:warn:${context.userId}`);
    if (!tempStr) {
      context.ui.showToast({ text: 'Warning session expired — try again', appearance: 'neutral' });
      return;
    }

    let temp: { targetId: string; authorUsername: string };
    try {
      temp = JSON.parse(tempStr) as { targetId: string; authorUsername: string };
    } catch {
      context.ui.showToast({ text: 'Session parse failed.', appearance: 'neutral' });
      return;
    }

    const { authorUsername } = temp;
    const reason = (event.values.reason as string) || '';
    const severity = (event.values.severity?.[0] as string) || 'minor';

    try {
      const user = await context.reddit.getCurrentUser();
      const warnedBy = user?.username || 'Guest';

      // Add warning to database
      await addWarning(
        context.redis as unknown as Parameters<typeof addWarning>[0],
        authorUsername,
        {
          warnedBy,
          reason: `${reason} (${severity})`,
        }
      );

      // Increment statistics
      await incrementStat(
        context.redis as unknown as Parameters<typeof incrementStat>[0],
        warnedBy,
        'warnings'
      );

      // Send Reddit DM to warned user
      try {
        await context.reddit.sendPrivateMessage({
          to: authorUsername,
          subject: 'Mod Warning Notice',
          text: `You have received a moderation warning from the team.\nReason: ${reason}\nSeverity: ${severity}`,
        });
      } catch {
        // Silent catch for PM blocks
      }

      context.ui.showToast({
        text: `Warning logged for u/${authorUsername} ✓`,
        appearance: 'success',
      });
    } catch (err) {
      context.ui.showToast({
        text: err instanceof Error ? err.message : 'Failed to log warning',
        appearance: 'neutral',
      });
    } finally {
      await context.redis.del(`temp:warn:${context.userId}`);
    }
  }
);

// 2. Menu Item: Remove post (ModWatch)
Devvit.addMenuItem({
  label: 'Remove post (ModWatch)',
  location: 'post',
  forUserType: 'moderator',
  onPress: async (event: MenuItemOnPressEvent, context: Context) => {
    const user = await context.reddit.getCurrentUser();
    const mod = user?.username || 'Guest';

    const locked = await acquireLock(context.redis, event.targetId, mod);
    if (!locked) {
      const holder = await getLockHolder(context.redis, event.targetId);
      context.ui.showToast({
        text: `⚠️ Already being actioned by u/${holder || 'another mod'} — stand down`,
        appearance: 'neutral',
      });
      return;
    }

    try {
      await context.reddit.remove(event.targetId, false);
      await incrementStat(
        context.redis as unknown as Parameters<typeof incrementStat>[0],
        mod,
        'removes'
      );
      context.ui.showToast({ text: 'Post removed ✓', appearance: 'success' });
    } catch {
      context.ui.showToast({ text: 'Remove failed — try again', appearance: 'neutral' });
    } finally {
      await releaseLock(context.redis, event.targetId);
    }
  },
});

// 3. Menu Item: Approve post (ModWatch)
Devvit.addMenuItem({
  label: 'Approve post (ModWatch)',
  location: 'post',
  forUserType: 'moderator',
  onPress: async (event: MenuItemOnPressEvent, context: Context) => {
    const user = await context.reddit.getCurrentUser();
    const mod = user?.username || 'Guest';

    const locked = await acquireLock(context.redis, event.targetId, mod);
    if (!locked) {
      const holder = await getLockHolder(context.redis, event.targetId);
      context.ui.showToast({
        text: `⚠️ Already being actioned by u/${holder || 'another mod'} — stand down`,
        appearance: 'neutral',
      });
      return;
    }

    try {
      await context.reddit.approve(event.targetId);
      await incrementStat(
        context.redis as unknown as Parameters<typeof incrementStat>[0],
        mod,
        'approvals'
      );
      context.ui.showToast({ text: 'Post approved ✓', appearance: 'success' });
    } catch {
      context.ui.showToast({ text: 'Approve failed — try again', appearance: 'neutral' });
    } finally {
      await releaseLock(context.redis, event.targetId);
    }
  },
});

// 4. Menu Item: Remove comment (ModWatch)
Devvit.addMenuItem({
  label: 'Remove comment (ModWatch)',
  location: 'comment',
  forUserType: 'moderator',
  onPress: async (event: MenuItemOnPressEvent, context: Context) => {
    const user = await context.reddit.getCurrentUser();
    const mod = user?.username || 'Guest';

    const locked = await acquireLock(context.redis, event.targetId, mod);
    if (!locked) {
      const holder = await getLockHolder(context.redis, event.targetId);
      context.ui.showToast({
        text: `⚠️ Already being actioned by u/${holder || 'another mod'} — stand down`,
        appearance: 'neutral',
      });
      return;
    }

    try {
      await context.reddit.remove(event.targetId, false);
      await incrementStat(
        context.redis as unknown as Parameters<typeof incrementStat>[0],
        mod,
        'removes'
      );
      context.ui.showToast({ text: 'Comment removed ✓', appearance: 'success' });
    } catch {
      context.ui.showToast({ text: 'Remove failed — try again', appearance: 'neutral' });
    } finally {
      await releaseLock(context.redis, event.targetId);
    }
  },
});

// 5. Menu Item: Warn user (ModWatch)
Devvit.addMenuItem({
  label: 'Warn user (ModWatch)',
  location: 'post',
  forUserType: 'moderator',
  onPress: async (event: MenuItemOnPressEvent, context: Context) => {
    const post = await context.reddit.getPostById(event.targetId);
    const authorUsername = post.authorName;

    // Cache author information for the upcoming Form submit handler
    await context.redis.set(
      `temp:warn:${context.userId}`,
      JSON.stringify({
        targetId: event.targetId,
        authorUsername,
      }),
      { expiration: new Date(Date.now() + 10 * 60 * 1000) } // 10-minute session TTL
    );

    context.ui.showForm(warnUserForm);
  },
});

// 6. Menu Item: Check user history (ModWatch)
Devvit.addMenuItem({
  label: 'Check user history (ModWatch)',
  location: 'post',
  forUserType: 'moderator',
  onPress: async (event: MenuItemOnPressEvent, context: Context) => {
    const post = await context.reddit.getPostById(event.targetId);
    const authorUsername = post.authorName;

    const warnings = await getWarnings(
      context.redis as unknown as Parameters<typeof getWarnings>[0],
      authorUsername
    );

    if (warnings.length > 0) {
      context.ui.showToast({
        text: `u/${authorUsername} has ${warnings.length} prior warnings`,
        appearance: 'neutral',
      });
    } else {
      context.ui.showToast({
        text: `u/${authorUsername} — clean record`,
        appearance: 'success',
      });
    }
  },
});

// 7. ModAction Trigger (auto statistics tracking)
Devvit.addTrigger({
  event: 'ModAction',
  onEvent: async (event, context) => {
    const username = event.moderator?.name;
    if (!username) {
      return;
    }

    const action = event.action || '';
    if (action === 'removelink' || action === 'removecomment') {
      await incrementStat(
        context.redis as unknown as Parameters<typeof incrementStat>[0],
        username,
        'removes'
      );
      if (event.action === 'removelink' || event.action === 'removecomment') {
        await checkForRaidPattern(context, event.moderator?.name || 'Guest');
      }
    } else if (action === 'approvelink' || action === 'approvecomment') {
      await incrementStat(
        context.redis as unknown as Parameters<typeof incrementStat>[0],
        username,
        'approvals'
      );
    } else if (action === 'banuser') {
      await incrementStat(
        context.redis as unknown as Parameters<typeof incrementStat>[0],
        username,
        'bans'
      );
    } else if (action === 'warnuser') {
      await incrementStat(
        context.redis as unknown as Parameters<typeof incrementStat>[0],
        username,
        'warnings'
      );
    }
  },
});

// Scheduler Jobs Registration
Devvit.addSchedulerJob({
  name: 'coverage-check',
  onRun: async (_, context) => {
    await checkCoverageAndAlert(context);
  },
});

Devvit.addSchedulerJob({
  name: 'incident-prune',
  onRun: async (_, context) => {
    await pruneOldIncidents(context.redis);
  },
});

// AppInstall Trigger
Devvit.addTrigger({
  event: 'AppInstall',
  onEvent: async (_, context) => {
    await context.scheduler.runJob({
      name: 'coverage-check',
      cron: '*/15 * * * *', // every 15 minutes
    });
    await context.scheduler.runJob({
      name: 'incident-prune',
      cron: '0 3 * * *', // daily at 03:00 UTC
    });
  },
});
