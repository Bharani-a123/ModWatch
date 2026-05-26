import { Devvit, useState, useAsync, useInterval, JSONArray } from '@devvit/public-api';
import {
  heartbeat,
  getOnlineMods,
  goOffline,
  getSessionDuration,
  PresenceRecord,
} from './redis/presence.js';
import {
  getShiftsForDate,
  getCurrentSlotIndex,
  slotIndexToTime,
} from './redis/shifts.js';

interface PresenceBarProps {
  context: Devvit.Context;
  onEndShift?: () => Promise<void>;
}

const getTodayDateString = (): string => {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const PresenceBar = (props: PresenceBarProps) => {
  const { context, onEndShift } = props;
  const { redis, reddit } = context;

  // Cached list of all subreddit moderators
  const [modsList, setModsList] = useState<string[]>([]);
  
  // Refresh counter to trigger useAsync re-evaluation
  const [refreshCounter, setRefreshCounter] = useState<number>(0);

  // Load current logged-in user in a JSONValue compatible structure
  const { data: currentUser } = useAsync<{ username: string } | null>(async () => {
    const user = await reddit.getCurrentUser();
    return user ? { username: user.username } : null;
  });
  const currentMod = currentUser?.username || 'Guest';

  // Load online mods list (fetches mods, sends heartbeat, and queries online status)
  const { data: onlineModsVal } = useAsync<JSONArray>(async () => {
    // 1. Fetch moderator list if not loaded yet and cache it
    let currentMods = modsList;
    if (currentMods.length === 0) {
      const mods = await reddit.getModerators({ subredditName: context.subredditName || '' }).all();
      currentMods = mods
        .map((m) => m.username)
        .filter((u): u is string => u !== undefined && u !== null);
      setModsList(currentMods);
    }

    // 2. Fetch today's shifts to determine active shift for current mod
    const todayStr = getTodayDateString();
    const shifts = await getShiftsForDate(redis, todayStr);
    const currentSlot = getCurrentSlotIndex();
    
    // 3. Find if current mod is on shift
    const myActiveShift = shifts.find((s) => s.slotIndex === currentSlot && s.modUsername === currentMod);
    const myShiftInfo = myActiveShift ? slotIndexToTime(myActiveShift.slotIndex) : undefined;

    // 4. Send heartbeat for current mod
    if (currentMod && currentMod !== 'Guest') {
      await heartbeat(redis, currentMod, myShiftInfo);
    }

    // 5. Retrieve presence records of online mods
    const records = await getOnlineMods(redis, currentMods);
    return records as unknown as JSONArray;
  }, { depends: [refreshCounter.toString()] });

  const activeMods = (onlineModsVal as unknown as PresenceRecord[]) || [];

  // Single interval to update both heartbeat and refresh presence lists every 60s
  const interval = useInterval(() => {
    setRefreshCounter((prev) => prev + 1);
  }, 60000);
  interval.start();

  // Expose end shift handler
  const handleEndShiftClick = async () => {
    if (currentMod && currentMod !== 'Guest') {
      await goOffline(redis, currentMod);
    }
    if (onEndShift) {
      await onEndShift();
    }
    setRefreshCounter((prev) => prev + 1);
  };

  return (
    <vstack width="100%">
      {activeMods.length === 0 ? (
        // Amber warning strip
        <hstack
          backgroundColor="#fef3c7"
          padding="medium"
          alignment="center middle"
          width="100%"
          border="thin"
          cornerRadius="medium"
        >
          <text color="#b45309" weight="bold">
            ⚠️ No mods currently online — subreddit is unwatched
          </text>
        </hstack>
      ) : (
        // Sticky presence strip of online mods
        <hstack gap="small" alignment="middle" width="100%" padding="small" border="thin" cornerRadius="medium" backgroundColor="#f9fafb">
          <text size="small" weight="bold">Team Presence:</text>
          <hstack gap="small" alignment="middle">
            {activeMods.map((mod) => (
              <hstack
                key={mod.modUsername}
                backgroundColor="#eef2ff"
                border="thin"
                padding="small"
                cornerRadius="full"
                alignment="middle"
                gap="small"
              >
                {/* Pulsing presence indicator representing green dot */}
                <text color="#10b981" size="medium" weight="bold">●</text>
                <text size="small" weight="bold" color="#3730a3">
                  u/{mod.modUsername}
                </text>
                <text size="small" color="#4f46e5">
                  ({mod.currentShift || 'Browsing'})
                </text>
                <text size="small" color="#6366f1">
                  • Online {getSessionDuration(mod.onlineSince)}
                </text>
              </hstack>
            ))}
          </hstack>
          <spacer grow />
          {/* Option to End shift and go offline */}
          <button size="small" appearance="destructive" onPress={handleEndShiftClick}>
            Go Offline
          </button>
        </hstack>
      )}
    </vstack>
  );
};
