import { Devvit, useState, useAsync, JSONArray } from '@devvit/public-api';
import {
  WarningEntry,
  getWarnings,
  getAllWarnedUsers,
  clearWarnings,
  getWarningSummary,
} from './redis/warnings.js';

interface WarningsViewProps {
  context: Devvit.Context;
}

export const WarningsView = (props: WarningsViewProps) => {
  const { context } = props;
  const { redis, ui, reddit } = context;

  // Navigation / Refresh states
  const [refreshCounter, setRefreshCounter] = useState<number>(0);
  const [query, setQuery] = useState<string>('');
  const [searchedUser, setSearchedUser] = useState<string>('');
  const [confirmClear, setConfirmClear] = useState<boolean>(false);

  // Clean username: trim whitespace and strip leading "u/" or "u_"
  const cleanUsername = (input: string): string => {
    return input.trim().replace(/^u\//i, '').replace(/^u_/i, '');
  };

  // Fetch current user and moderators list to check head mod status
  const { data: currentUser } = useAsync<{ username: string } | null>(async () => {
    const user = await reddit.getCurrentUser();
    return user ? { username: user.username } : null;
  });
  const currentMod = currentUser?.username || 'Guest';

  const { data: modData } = useAsync<{ isHeadMod: boolean }>(async () => {
    const modsList = await reddit.getModerators({ subredditName: context.subredditName || '' }).all();
    const mods = modsList
      .map((m) => m.username)
      .filter((u): u is string => u !== undefined && u !== null);
    const isHeadMod = mods.length > 0 && mods[0] === currentMod;
    return { isHeadMod };
  }, { depends: [currentMod] });
  const isHeadMod = modData?.isHeadMod || false;

  // Fetch warnings of searched user
  const { data: warningsVal } = useAsync<JSONArray>(async () => {
    if (!searchedUser) return [] as unknown as JSONArray;
    const list = await getWarnings(redis, searchedUser);
    return list as unknown as JSONArray;
  }, { depends: [searchedUser, refreshCounter.toString()] });

  const warnings = (warningsVal as unknown as WarningEntry[]) || [];
  const summary = getWarningSummary(warnings);

  // Fetch recently warned users (last 10 unique users warned across all mods)
  const { data: recentWarnedVal } = useAsync<JSONArray>(async () => {
    const list = await getAllWarnedUsers(redis);
    
    // Fetch last warning for each user in parallel
    const usersWithDates = await Promise.all(
      list.map(async (username) => {
        const warningsList = await getWarnings(redis, username);
        const lastWarn = warningsList[0];
        if (!lastWarn) return null;
        return {
          username,
          lastWarnedAt: lastWarn.warnedAt,
          entry: lastWarn,
        };
      })
    );

    const sorted = usersWithDates
      .filter((u): u is { username: string; lastWarnedAt: number; entry: WarningEntry } => u !== null)
      .sort((a, b) => b.lastWarnedAt - a.lastWarnedAt)
      .slice(0, 10);

    return sorted as unknown as JSONArray;
  }, { depends: [refreshCounter.toString()] });

  const recentWarnedUsers = (recentWarnedVal as unknown as Array<{
    username: string;
    lastWarnedAt: number;
    entry: WarningEntry;
  }>) || [];

  const handleSearch = () => {
    const cleaned = cleanUsername(query);
    if (!cleaned) {
      ui.showToast({ text: 'Please enter a username', appearance: 'neutral' });
      return;
    }
    setSearchedUser(cleaned);
    setQuery(`u/${cleaned}`);
    setConfirmClear(false);
  };

  const handleClearHistory = async () => {
    try {
      await clearWarnings(redis, searchedUser);
      ui.showToast({ text: `Warnings cleared for u/${searchedUser} ✓`, appearance: 'success' });
      setConfirmClear(false);
      setSearchedUser('');
      setQuery('');
      setRefreshCounter((prev) => prev + 1);
    } catch (err) {
      ui.showToast({
        text: err instanceof Error ? err.message : 'Failed to clear history',
        appearance: 'neutral',
      });
    }
  };

  const triggerRecentSearch = (username: string) => {
    setQuery(`u/${username}`);
    setSearchedUser(username);
    setConfirmClear(false);
  };

  const getSeverityBadge = (sev: 'minor' | 'serious' | 'final warning') => {
    switch (sev) {
      case 'final warning':
        return { bg: '#fee2e2', text: '#dc2626', label: 'FINAL WARNING' };
      case 'serious':
        return { bg: '#fef3c7', text: '#d97706', label: 'SERIOUS' };
      case 'minor':
      default:
        return { bg: '#e5e7eb', text: '#374151', label: 'MINOR' };
    }
  };

  const renderTimelineEntry = (entry: WarningEntry) => {
    const badge = getSeverityBadge(entry.severity);
    return (
      <vstack key={entry.id} border="thin" padding="medium" cornerRadius="medium" gap="small" backgroundColor="#ffffff" width="100%">
        <hstack gap="small" alignment="middle" width="100%">
          <hstack backgroundColor={badge.bg} padding="small" cornerRadius="small" border="thin">
            <text color={badge.text} size="xsmall" weight="bold">
              {badge.label}
            </text>
          </hstack>
          <spacer size="small" />
          <text size="small" color="neutral-content">
            by u/{entry.warnedBy} on {new Date(entry.warnedAt).toUTCString()}
          </text>
        </hstack>

        <text weight="bold" size="medium" wrap>
          {entry.reason}
        </text>

        {!!entry.linkedPostId && (
          <hstack
            alignment="middle"
            gap="small"
            onPress={() => ui.showToast({ text: `Post ID: ${entry.linkedPostId}`, appearance: 'neutral' })}
          >
            <text size="small" color="#3b82f6" weight="bold">
              View post →
            </text>
          </hstack>
        )}
      </vstack>
    );
  };

  return (
    <vstack gap="medium" width="100%">
      {/* Top Header & Search bar */}
      <hstack alignment="middle" width="100%" gap="medium">
        <text size="large" weight="bold">User Warning Logs</text>
        <spacer grow />
        <hstack gap="small" width="50%">
          <input
            placeholder="Search by username u/..."
            value={query}
            onInput={(e: { value?: string }) => setQuery(e.value || '')}
          />
          <button size="medium" appearance="primary" onPress={handleSearch}>Search</button>
        </hstack>
      </hstack>

      {/* Searched User results view */}
      {!!searchedUser && (
        <vstack gap="medium" width="100%">
          {warnings.length === 0 ? (
            // Clean record empty state
            <vstack border="thin" padding="large" cornerRadius="medium" alignment="center middle" backgroundColor="#f0fdf4" width="100%">
              <text color="#15803d" weight="bold" size="medium">
                No warnings on record for u/{searchedUser} — clean ✓
              </text>
            </vstack>
          ) : (
            // Warning summary and timeline
            <vstack gap="medium" width="100%">
              {/* Summary Banner row */}
              <hstack gap="medium" width="100%">
                <vstack border="thin" padding="medium" cornerRadius="medium" backgroundColor="#ffffff" width="48%" alignment="center">
                  <text size="small" color="neutral-content" weight="bold">Total Warnings</text>
                  <text size="xlarge" weight="bold">{summary.total.toString()}</text>
                </vstack>
                <vstack border="thin" padding="medium" cornerRadius="medium" backgroundColor="#ffffff" width="48%" alignment="center">
                  <text size="small" color="neutral-content" weight="bold">Last Warned</text>
                  <text size="medium" weight="bold" wrap>
                    {warnings[0] ? new Date(warnings[0].warnedAt).toUTCString() : ''}
                  </text>
                </vstack>
              </hstack>

              {/* Escalation alert banner */}
              {summary.shouldEscalate && (
                <vstack
                  border="thin"
                  padding="medium"
                  cornerRadius="medium"
                  backgroundColor="#fee2e2"
                  alignment="center middle"
                  width="100%"
                >
                  <text color="#dc2626" weight="bold" size="medium">
                    ⚠️ Consider escalating to ban (3+ warnings or final warning on file)
                  </text>
                </vstack>
              )}

              {/* Timeline list of warnings */}
              <vstack gap="small" width="100%">
                <text weight="bold" size="small">Warning Timeline</text>
                {warnings.map((entry) => renderTimelineEntry(entry))}
              </vstack>

              {/* Clear History for Head Mods only */}
              {isHeadMod && (
                <vstack border="thin" padding="medium" cornerRadius="medium" gap="small" backgroundColor="#f9fafb" width="100%">
                  {confirmClear ? (
                    <vstack gap="small" width="100%">
                      <text size="small" color="#991b1b" weight="bold">
                        Are you sure you want to clear u/{searchedUser}'s warning history? This cannot be undone.
                      </text>
                      <hstack gap="small" width="100%" alignment="end">
                        <button size="small" onPress={() => setConfirmClear(false)}>Cancel</button>
                        <button size="small" appearance="destructive" onPress={handleClearHistory}>
                          Clear Warnings
                        </button>
                      </hstack>
                    </vstack>
                  ) : (
                    <hstack alignment="middle" width="100%">
                      <text size="small" color="neutral-content">Moderator Actions:</text>
                      <spacer grow />
                      <button size="small" appearance="destructive" onPress={() => setConfirmClear(true)}>
                        Clear history
                      </button>
                    </hstack>
                  )}
                </vstack>
              )}
            </vstack>
          )}
        </vstack>
      )}

      {/* Recently warned users history section */}
      <vstack border="thin" padding="medium" cornerRadius="medium" gap="medium" backgroundColor="#f9fafb" width="100%">
        <text weight="bold" size="medium">Recently Warned Users</text>
        {recentWarnedUsers.length === 0 ? (
          <text size="small" color="neutral-content">No warning logs on file.</text>
        ) : (
          <vstack gap="small" width="100%">
            {recentWarnedUsers.map((item) => {
              const badge = getSeverityBadge(item.entry.severity);
              return (
                <hstack
                  key={item.username}
                  backgroundColor="#ffffff"
                  border="thin"
                  padding="small"
                  cornerRadius="medium"
                  alignment="middle"
                  width="100%"
                  onPress={() => triggerRecentSearch(item.username)}
                >
                  <text size="small" weight="bold" color="#3b82f6">u/{item.username}</text>
                  <spacer size="small" />
                  <hstack backgroundColor={badge.bg} padding="small" cornerRadius="small" border="thin">
                    <text color={badge.text} size="xsmall" weight="bold">
                      {badge.label}
                    </text>
                  </hstack>
                  <spacer grow />
                  <text size="xsmall" color="neutral-content">
                    Last warned: {new Date(item.lastWarnedAt).toUTCString()}
                  </text>
                </hstack>
              );
            })}
          </vstack>
        )}
      </vstack>
    </vstack>
  );
};
