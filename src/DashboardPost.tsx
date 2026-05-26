import { Devvit, useState, useAsync, useInterval, JSONArray } from '@devvit/public-api';
import { PresenceBar } from './PresenceBar.js';
import { ScheduleView } from './ScheduleView.js';
import { HandoverView } from './HandoverView.js';
import { HandoverPopup } from './HandoverPopup.js';
import { IncidentView } from './IncidentView.js';
import { PlaybookView } from './PlaybookView.js';
import { StatsView } from './StatsView.js';
import { WarningsView } from './WarningsView.js';
import { ChatPanel } from './ChatPanel.js';
import { getShiftsForDate, ModShift, releaseShift, slotIndexToTime } from './redis/shifts.js';
import { getOnlineMods, heartbeat, goOffline, PresenceRecord } from './redis/presence.js';
import { getHandover } from './redis/handover.js';

const getTodayDateString = (): string => {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getShiftEndTime = (dateStr: string, slotIndex: number): number => {
  const parts = dateStr.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  // Calculate milliseconds since epoch for UTC midnight
  const utcMidnight = Date.UTC(year, month, day, 0, 0, 0, 0);
  // Shift end time = (slotIndex + 1) * 30 minutes from UTC midnight
  return utcMidnight + (slotIndex + 1) * 30 * 60 * 1000;
};

export const DashboardPost = (context: Devvit.Context) => {
  const { redis, reddit } = context;

  // Selected tab: 'schedule' | 'handover'
  const [activeTab, setActiveTab] = useState<string>('schedule');

  // Roster refresh trigger
  const [refreshCounter, setRefreshCounter] = useState<number>(0);

  // Handover popup states
  const [showHandoverPopup, setShowHandoverPopup] = useState<boolean>(false);
  const [popupShiftId, setPopupShiftId] = useState<string>('');

  // Fetch current logged-in user info
  const { data: currentUser } = useAsync<{ username: string } | null>(async () => {
    const user = await reddit.getCurrentUser();
    return user ? { username: user.username } : null;
  });
  const currentMod = currentUser?.username || 'Guest';

  // Load shifts for today to check my shifts
  const todayStr = getTodayDateString();
  const { data: shiftsVal } = useAsync<JSONArray>(async () => {
    const fetched = await getShiftsForDate(redis, todayStr);
    return fetched as unknown as JSONArray;
  }, { depends: [refreshCounter.toString()] });
  const shifts = (shiftsVal as unknown as ModShift[]) || [];
  const myShifts = shifts.filter((s) => s.modUsername === currentMod);

  // Load open incidents count
  const { data: openIncidentCountVal } = useAsync<number>(async () => {
    const raw = await redis.get('incidents:active');
    if (!raw) return 0;
    const incidentsList = JSON.parse(raw) as Array<{ status: string }>;
    return incidentsList.filter((i) => i.status === 'open').length;
  }, { depends: [refreshCounter.toString()] });
  const openIncidentCount = openIncidentCountVal || 0;

  // Load online mods for chat panel
  const { data: onlineModsVal } = useAsync<JSONArray>(async () => {
    const modsList = await reddit.getModerators({ subredditName: context.subredditName || '' }).all();
    const usernames = modsList
      .map((m) => m.username)
      .filter((u): u is string => u !== undefined && u !== null);
    
    const records = await getOnlineMods(redis, usernames);
    return records as unknown as JSONArray;
  }, { depends: [refreshCounter.toString()] });
  const onlineMods = (onlineModsVal as unknown as PresenceRecord[]) || [];

  // Heartbeat helper for Shift Controls
  const handleHeartbeat = async () => {
    const currentSlot = Math.floor((new Date().getUTCHours() * 60 + new Date().getUTCMinutes()) / 30);
    const myActiveShift = shifts.find((s) => s.slotIndex === currentSlot && s.modUsername === currentMod);
    const myShiftInfo = myActiveShift ? slotIndexToTime(myActiveShift.slotIndex) : undefined;
    
    if (currentMod && currentMod !== 'Guest') {
      await heartbeat(redis, currentMod, myShiftInfo);
      context.ui.showToast({ text: "Presence heartbeat refreshed", appearance: "success" });
      setRefreshCounter((prev) => prev + 1);
    }
  };

  // End Shift helper for Shift Controls
  const handleEndShift = async () => {
    if (myShifts.length === 0) {
      context.ui.showToast({ text: "You do not have any claimed shifts to end", appearance: "neutral" });
      return;
    }
    try {
      for (const s of myShifts) {
        await releaseShift(redis, todayStr, s.slotIndex, currentMod);
      }
      if (currentMod && currentMod !== 'Guest') {
        await goOffline(redis, currentMod);
      }
      context.ui.showToast({ text: "Shift ended successfully", appearance: "success" });
      setRefreshCounter((prev) => prev + 1);
    } catch (err) {
      context.ui.showToast({
        text: err instanceof Error ? err.message : "Failed to end shift",
        appearance: "neutral",
      });
    }
  };

  // Tick checker every 60s for shifts end times & auto-popup triggers
  const interval = useInterval(async () => {
    // 1. Increment refresh counter
    setRefreshCounter((prev) => prev + 1);

    // 2. Perform auto-popup trigger check
    if (currentMod && currentMod !== 'Guest') {
      const todayStr = getTodayDateString();
      const shiftsList = await getShiftsForDate(redis, todayStr);
      const myTodayShifts = shiftsList.filter((s: ModShift) => s.modUsername === currentMod);

      for (const shift of myTodayShifts) {
        const shiftEndTime = getShiftEndTime(shift.date, shift.slotIndex);
        
        // Check if shift has ended
        if (Date.now() >= shiftEndTime) {
          const shiftId = shift.shiftId;

          // Check if handover is already written or popup shown
          const written = await getHandover(redis, shiftId);
          const shown = await redis.get(`handover:shown:${shiftId}`);

          if (!written && !shown) {
            // Track shown in Redis with 1-hour expiration to show only once
            await redis.set(`handover:shown:${shiftId}`, "true", {
              expiration: new Date(Date.now() + 60 * 60 * 1000),
            });

            // Trigger show state
            setPopupShiftId(shiftId);
            setShowHandoverPopup(true);
            break; // trigger one popup at a time
          }
        }
      }
    }
  }, 60000);
  interval.start();

  const handleEndShiftCallback = async () => {
    setRefreshCounter((prev) => prev + 1);
  };

  return (
    <zstack width="100%" height="100%">
      {/* Main UI Container */}
      <vstack gap="medium" width="100%" padding="medium">
        {/* Sticky strip presence list */}
        <PresenceBar context={context} onEndShift={handleEndShiftCallback} />

        <hstack gap="medium" width="100%">
          {/* Left Column: Tab contents */}
          <vstack width="70%" gap="medium">
            {/* Tab Selection */}
            <hstack gap="small" border="thin" padding="small" cornerRadius="medium" width="100%">
              <button
                size="small"
                appearance={activeTab === 'schedule' ? 'primary' : 'secondary'}
                onPress={() => setActiveTab('schedule')}
              >
                Schedule
              </button>
              <button
                size="small"
                appearance={activeTab === 'handover' ? 'primary' : 'secondary'}
                onPress={() => setActiveTab('handover')}
              >
                Handovers
              </button>
              <button
                size="small"
                appearance={activeTab === 'incidents' ? 'primary' : 'secondary'}
                onPress={() => setActiveTab('incidents')}
              >
                Incidents
              </button>
              <button
                size="small"
                appearance={activeTab === 'playbook' ? 'primary' : 'secondary'}
                onPress={() => setActiveTab('playbook')}
              >
                Playbook
              </button>
              <button
                size="small"
                appearance={activeTab === 'stats' ? 'primary' : 'secondary'}
                onPress={() => setActiveTab('stats')}
              >
                Stats
              </button>
              <button
                size="small"
                appearance={activeTab === 'warnings' ? 'primary' : 'secondary'}
                onPress={() => setActiveTab('warnings')}
              >
                Warnings
              </button>
            </hstack>

            {/* Render Tab Views */}
            {activeTab === 'schedule' ? (
              <ScheduleView context={context} />
            ) : activeTab === 'handover' ? (
              <HandoverView
                context={context}
                onWriteNote={() => {
                  // Open modal write popup manual trigger
                  const activeSlot = popupShiftId || `${getTodayDateString()}:0`;
                  setPopupShiftId(activeSlot);
                  setShowHandoverPopup(true);
                }}
                refreshCounter={refreshCounter}
              />
            ) : activeTab === 'incidents' ? (
              <IncidentView context={context} />
            ) : activeTab === 'playbook' ? (
              <PlaybookView context={context} />
            ) : activeTab === 'stats' ? (
              <StatsView context={context} />
            ) : (
              <WarningsView context={context} />
            )}
          </vstack>

          {/* Right Column: Sidebar */}
          <vstack width="30%" gap="medium">
            {/* Shift Controls area */}
            <vstack gap="medium" padding="medium" cornerRadius="medium" border="thin" backgroundColor="#ffffff">
              <text size="large" weight="bold">Shift Controls</text>
              
              <button size="medium" onPress={handleHeartbeat}>
                Refresh heartbeat
              </button>

              <button
                size="medium"
                appearance="destructive"
                onPress={handleEndShift}
                disabled={myShifts.length === 0}
              >
                End shift
              </button>

              <spacer size="small" />

              <vstack gap="small">
                <text weight="bold" size="small">Your Claimed Shifts</text>
                {myShifts.length > 0 ? (
                  myShifts.map((s: ModShift) => (
                    <text key={s.slotIndex.toString()} size="small" color="neutral-content">
                      {slotIndexToTime(s.slotIndex)} (Slot {s.slotIndex})
                    </text>
                  ))
                ) : (
                  <text size="small" color="neutral-content">
                    You do not currently hold a claimed shift today
                  </text>
                )}
              </vstack>

              <spacer size="small" />

              <vstack gap="small">
                <text weight="bold" size="small">Open incidents</text>
                <text size="large" color="neutral-content">
                  {openIncidentCount.toString()} active
                </text>
              </vstack>
            </vstack>

            {/* Chat Panel area */}
            <ChatPanel
              currentMod={currentMod}
              onlineMods={onlineMods}
              redis={redis}
              ui={context.ui}
            />
          </vstack>
        </hstack>
      </vstack>

      {/* Full Screen Controlled Overlay popup */}
      {showHandoverPopup && (
        <HandoverPopup
          context={context}
          shiftId={popupShiftId}
          onSuccess={() => {
            setShowHandoverPopup(false);
            setRefreshCounter((prev) => prev + 1);
          }}
          onCancel={() => {
            setShowHandoverPopup(false);
          }}
        />
      )}
    </zstack>
  );
};
