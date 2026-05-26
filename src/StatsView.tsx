import { Devvit, useState, useAsync, JSONArray } from '@devvit/public-api';
import {
  ModStats,
  getWeekKey,
  getWeeklyStats,
  getTotalActions,
} from './redis/stats.js';

interface StatsViewProps {
  context: Devvit.Context;
}

export const StatsView = (props: StatsViewProps) => {
  const { context } = props;
  const { redis, reddit } = context;

  // Track selected date using serializable timestamp
  const [selectedTimestamp, setSelectedTimestamp] = useState<number>(Date.now());
  const selectedDate = new Date(selectedTimestamp);

  // Fetch current user details
  const { data: currentUser } = useAsync<{ username: string } | null>(async () => {
    const user = await reddit.getCurrentUser();
    return user ? { username: user.username } : null;
  });
  const currentMod = currentUser?.username || 'Guest';

  // Fetch moderators and check if current user is the head mod
  const { data: modData } = useAsync<{ mods: string[]; isHeadMod: boolean }>(async () => {
    const modsList = await reddit.getModerators({ subredditName: context.subredditName || '' }).all();
    const mods = modsList
      .map((m) => m.username)
      .filter((u): u is string => u !== undefined && u !== null);
    
    // First moderator in the returned array is the head moderator
    const isHeadMod = mods.length > 0 && mods[0] === currentMod;
    return { mods, isHeadMod };
  }, { depends: [currentMod] });

  const mods = modData?.mods || [];
  const isHeadMod = modData?.isHeadMod || false;

  const weekKey = getWeekKey(selectedDate);

  // Fetch weekly stats
  const { data: statsVal } = useAsync<JSONArray>(async () => {
    if (mods.length === 0) return [] as unknown as JSONArray;
    const fetched = await getWeeklyStats(redis, mods, weekKey);
    return fetched as unknown as JSONArray;
  }, { depends: [mods.join(','), weekKey] });

  const weeklyStats = (statsVal as unknown as ModStats[]) || [];

  // Helper date formatting for the week key Monday
  const getMonday = (d: Date): Date => {
    const dateObj = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = dateObj.getUTCDay() || 7;
    dateObj.setUTCDate(dateObj.getUTCDate() - day + 1);
    return dateObj;
  };

  const formatDateString = (d: Date) => {
    const y = d.getUTCFullYear();
    const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = d.getUTCDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const monday = getMonday(selectedDate);
  const weekLabel = `Week of ${formatDateString(monday)}`;

  const adjustWeek = (weeks: number) => {
    setSelectedTimestamp((prev) => prev + weeks * 7 * 24 * 60 * 60 * 1000);
  };

  if (!modData) {
    return (
      <vstack padding="large" alignment="center middle" width="100%">
        <text color="neutral-content">Loading statistics and permissions...</text>
      </vstack>
    );
  }

  if (!isHeadMod) {
    return (
      <vstack
        padding="large"
        alignment="center middle"
        width="100%"
        backgroundColor="#fee2e2"
        border="thin"
        cornerRadius="medium"
      >
        <text color="#dc2626" weight="bold">
          Stats are only visible to head moderators
        </text>
      </vstack>
    );
  }

  // Calculate totals for summary cards
  const totalRemoves = weeklyStats.reduce((sum, s) => sum + s.removes, 0);
  const totalBans = weeklyStats.reduce((sum, s) => sum + s.bans, 0);
  const totalHandovers = weeklyStats.reduce((sum, s) => sum + s.handovers, 0);

  // Determine top performer (highest total actions > 0)
  let topModUsername = '';
  let maxActions = 0;
  for (const s of weeklyStats) {
    const actions = getTotalActions(s);
    if (actions > maxActions) {
      maxActions = actions;
      topModUsername = s.modUsername;
    }
  }

  const formatLastActive = (lastActive: number): string => {
    if (!lastActive) {
      return 'Never this week';
    }
    const diffMs = Date.now() - lastActive;
    if (diffMs < 0) return 'Just now';
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) {
      return `${diffMins}m ago`;
    }
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} days ago`;
  };

  const renderRow = (s: ModStats) => {
    const total = getTotalActions(s);
    const isTop = total > 0 && s.modUsername === topModUsername;
    const isZero = total === 0;
    const isInactive7Days = !s.lastActive || (Date.now() - s.lastActive >= 7 * 24 * 60 * 60 * 1000);

    let rowBg = '#ffffff';
    let labelColor = 'black';
    let icon = '';

    if (isZero) {
      rowBg = '#f3f4f6'; // gray for zero actions
      labelColor = '#6b7280';
      icon = '⚠️ ';
    } else if (isInactive7Days) {
      rowBg = '#fef3c7'; // amber for inactive in 7+ days
      labelColor = '#b45309';
    } else if (isTop) {
      rowBg = '#d1fae5'; // green for top performer
      labelColor = '#047857';
    }

    return (
      <hstack
        key={s.modUsername}
        backgroundColor={rowBg}
        padding="medium"
        border="thin"
        cornerRadius="small"
        alignment="middle"
        width="100%"
      >
        <hstack width="15%" alignment="middle">
          {!!icon && <text size="small" color={labelColor}>{icon}</text>}
          <text size="small" weight="bold" color={labelColor} wrap>
            u/{s.modUsername}
          </text>
        </hstack>
        <text size="small" width="10%" color={labelColor} alignment="center">{s.removes.toString()}</text>
        <text size="small" width="10%" color={labelColor} alignment="center">{s.approvals.toString()}</text>
        <text size="small" width="10%" color={labelColor} alignment="center">{s.bans.toString()}</text>
        <text size="small" width="10%" color={labelColor} alignment="center">{s.warnings.toString()}</text>
        <text size="small" width="10%" color={labelColor} alignment="center">{s.handovers.toString()}</text>
        <text size="small" width="20%" color={labelColor} alignment="center">{formatLastActive(s.lastActive)}</text>
        <text size="small" width="15%" color={labelColor} weight="bold" alignment="center">{total.toString()}</text>
      </hstack>
    );
  };

  return (
    <vstack gap="medium" width="100%">
      {/* Week Selector top bar */}
      <hstack alignment="middle" width="100%" gap="medium">
        <text size="large" weight="bold">Team Weekly Stats</text>
        <spacer grow />
        <hstack gap="small" alignment="middle">
          <button size="small" onPress={() => adjustWeek(-1)}>← Previous week</button>
          <vstack border="thin" padding="small" cornerRadius="small" backgroundColor="#ffffff">
            <text size="small" weight="bold">{weekLabel} ({weekKey})</text>
          </vstack>
          <button size="small" onPress={() => adjustWeek(1)}>Next week →</button>
        </hstack>
      </hstack>

      {/* Summary cards row */}
      <hstack gap="medium" width="100%">
        <vstack width="23%" border="thin" padding="medium" cornerRadius="medium" backgroundColor="#ffffff" alignment="center">
          <text size="small" color="neutral-content" weight="bold">Total Removes</text>
          <text size="xlarge" weight="bold">{totalRemoves.toString()}</text>
        </vstack>
        <vstack width="23%" border="thin" padding="medium" cornerRadius="medium" backgroundColor="#ffffff" alignment="center">
          <text size="small" color="neutral-content" weight="bold">Total Bans</text>
          <text size="xlarge" weight="bold">{totalBans.toString()}</text>
        </vstack>
        <vstack width="23%" border="thin" padding="medium" cornerRadius="medium" backgroundColor="#ffffff" alignment="center">
          <text size="small" color="neutral-content" weight="bold">Handovers Written</text>
          <text size="xlarge" weight="bold">{totalHandovers.toString()}</text>
        </vstack>
        <vstack width="31%" border="thin" padding="medium" cornerRadius="medium" backgroundColor="#ffffff" alignment="center">
          <text size="small" color="neutral-content" weight="bold">Most Active Mod</text>
          <text size="large" weight="bold" wrap>
            {topModUsername ? `u/${topModUsername}` : 'None'}
          </text>
        </vstack>
      </hstack>

      {/* Stats Table Section */}
      <vstack gap="small" width="100%">
        {/* Table Header */}
        <hstack
          backgroundColor="#e5e7eb"
          padding="medium"
          border="thin"
          cornerRadius="small"
          alignment="middle"
          width="100%"
        >
          <text size="small" weight="bold" width="15%">Mod</text>
          <text size="small" weight="bold" width="10%" alignment="center">Removes</text>
          <text size="small" weight="bold" width="10%" alignment="center">Approvals</text>
          <text size="small" weight="bold" width="10%" alignment="center">Bans</text>
          <text size="small" weight="bold" width="10%" alignment="center">Warnings</text>
          <text size="small" weight="bold" width="10%" alignment="center">Handovers</text>
          <text size="small" weight="bold" width="20%" alignment="center">Last Active</text>
          <text size="small" weight="bold" width="15%" alignment="center">Total</text>
        </hstack>

        {/* Table Rows */}
        {weeklyStats.length === 0 ? (
          <vstack border="thin" padding="large" cornerRadius="small" alignment="center middle" backgroundColor="#ffffff">
            <text color="neutral-content">No stats recorded for this week</text>
          </vstack>
        ) : (
          weeklyStats.map((s) => renderRow(s))
        )}
      </vstack>
    </vstack>
  );
};
