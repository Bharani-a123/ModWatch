import { Devvit, useState, useAsync, useInterval, JSONArray } from '@devvit/public-api';
import {
  claimShift,
  releaseShift,
  getShiftsForDate,
  getCurrentSlotIndex,
  slotIndexToTime,
  ModShift,
} from './redis/shifts.js';

interface ScheduleViewProps {
  context: Devvit.Context;
}

const getTodayDateString = (): string => {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const ScheduleView = (props: ScheduleViewProps) => {
  const { context } = props;
  const { redis, ui, reddit } = context;

  // Selected date state
  const [date, setDate] = useState<string>(getTodayDateString());
  
  // Refresh counter to trigger useAsync re-evaluation
  const [refreshCounter, setRefreshCounter] = useState<number>(0);

  // Current slot index, updated every 60s
  const [currentSlotIndex, setCurrentSlotIndex] = useState<number>(getCurrentSlotIndex());

  // Set up 60-second interval to update slot index
  const interval = useInterval(() => {
    setCurrentSlotIndex(getCurrentSlotIndex());
  }, 60000);
  interval.start();

  // Load current logged-in mod username in a JSONValue compatible structure
  const { data: currentUser } = useAsync<{ username: string } | null>(async () => {
    const user = await reddit.getCurrentUser();
    return user ? { username: user.username } : null;
  });
  const currentMod = currentUser?.username || 'Guest';

  // Load shifts for current date using JSONArray casting
  const { data: shiftsVal } = useAsync<JSONArray>(async () => {
    const fetched = await getShiftsForDate(redis, date);
    return fetched as unknown as JSONArray;
  }, { depends: [date, refreshCounter.toString()] });
  const shifts = (shiftsVal as unknown as ModShift[]) || [];



  const handleClaim = async (slotIndex: number) => {
    try {
      await claimShift(redis, date, slotIndex, currentMod);
      ui.showToast({ text: "Shift claimed — you are now on duty", appearance: "success" });
      setRefreshCounter((prev) => prev + 1);
    } catch (err) {
      // In case of error (nx: true set failure), fetch the latest to identify claim owner
      const key = `shifts:${date}:${slotIndex}`;
      const existingStr = await redis.get(key);
      const existing = existingStr ? (JSON.parse(existingStr) as ModShift) : null;
      const takenUser = existing ? existing.modUsername : 'another mod';
      ui.showToast({ text: `Slot taken by u/${takenUser} — pick another`, appearance: "neutral" });
      setRefreshCounter((prev) => prev + 1);
    }
  };

  const handleRelease = async (slotIndex: number) => {
    try {
      await releaseShift(redis, date, slotIndex, currentMod);
      ui.showToast({ text: "Shift released successfully", appearance: "success" });
      setRefreshCounter((prev) => prev + 1);
    } catch (err) {
      ui.showToast({
        text: err instanceof Error ? err.message : "Failed to release shift",
        appearance: "neutral",
      });
    }
  };


  const adjustDate = (days: number) => {
    const parts = date.split('-');
    const currentObj = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
    currentObj.setUTCDate(currentObj.getUTCDate() + days);
    
    const y = currentObj.getUTCFullYear();
    const m = String(currentObj.getUTCMonth() + 1).padStart(2, '0');
    const d = String(currentObj.getUTCDate()).padStart(2, '0');
    setDate(`${y}-${m}-${d}`);
  };

  // Filter slots to show only from currentSlotIndex onward for today, and all for future dates
  const todayDate = getTodayDateString();
  const isFutureDate = date > todayDate;
  const isToday = date === todayDate;

  const visibleSlotIndices = Array.from({ length: 48 }, (_, i) => i).filter((slotIndex) => {
    if (isFutureDate) return true;
    if (isToday) return slotIndex >= currentSlotIndex;
    return false; // past dates show no slots
  });

  return (
    <vstack width="100%" gap="medium">
      <hstack alignment="middle" width="100%">
        <text size="large" weight="bold">Shift Schedule ({date})</text>
        <spacer grow />
        <hstack gap="small">
          <button size="small" onPress={() => adjustDate(-1)}>Previous day</button>
          <button size="small" onPress={() => setDate(getTodayDateString())}>Today</button>
          <button size="small" onPress={() => adjustDate(1)}>Next day</button>
        </hstack>
      </hstack>

      <vstack gap="small" width="100%">
        {visibleSlotIndices.length === 0 ? (
          <text color="neutral-content">No future slots available for this date.</text>
        ) : (
          visibleSlotIndices.map((slotIndex) => {
            const shift = shifts.find((s: ModShift) => s.slotIndex === slotIndex);
            if (shift) {
              const isOwnShift = shift.modUsername === currentMod;
              return (
                <hstack
                  key={slotIndex.toString()}
                  backgroundColor="#d1fae5"
                  padding="medium"
                  cornerRadius="medium"
                  alignment="middle"
                  width="100%"
                >
                  <vstack>
                    <text weight="bold" color="#065f46">
                      {slotIndexToTime(slotIndex)}
                    </text>
                    <text size="small" color="#047857">
                      Claimed by u/{shift.modUsername}
                    </text>
                  </vstack>
                  <spacer grow />
                  {isOwnShift && (
                    <button
                      size="small"
                      appearance="destructive"
                      onPress={() => handleRelease(slotIndex)}
                    >
                      Release
                    </button>
                  )}
                </hstack>
              );
            } else {
              return (
                <hstack
                  key={slotIndex.toString()}
                  border="thin"
                  padding="medium"
                  cornerRadius="medium"
                  alignment="middle"
                  width="100%"
                >
                  <vstack>
                    <text weight="bold">{slotIndexToTime(slotIndex)}</text>
                    <text size="small" color="neutral-content">Available</text>
                  </vstack>
                  <spacer grow />
                  <button size="small" appearance="primary" onPress={() => handleClaim(slotIndex)}>
                    Claim
                  </button>
                </hstack>
              );
            }
          })
        )}
      </vstack>
    </vstack>
  );
};
