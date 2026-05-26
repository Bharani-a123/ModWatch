import { Devvit, useState } from '@devvit/public-api';
import { saveHandover, HandoverNote } from './redis/handover.js';
import { goOffline } from './redis/presence.js';
import { incrementStat } from './server/redis/stats.js';

interface HandoverPopupProps {
  context: Devvit.Context;
  shiftId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export const HandoverPopup = (props: HandoverPopupProps) => {
  const { context, shiftId, onSuccess, onCancel } = props;
  const { redis, reddit, ui } = context;

  // Form states
  const [freeText, setFreeText] = useState<string>('');
  const [usersToWatchStr, setUsersToWatchStr] = useState<string>('');
  const [openIncidents, setOpenIncidents] = useState<string>('');
  const [urgentNote, setUrgentNote] = useState<string>('');

  const handleSubmit = async () => {
    if (!freeText.trim()) {
      ui.showToast({ text: "What happened this shift is required.", appearance: "neutral" });
      return;
    }

    try {
      const user = await reddit.getCurrentUser();
      const currentMod = user?.username || 'Guest';

      // Parse watch users by comma splitting and trimming
      const usersToWatch = usersToWatchStr
        .split(',')
        .map((u) => u.trim().replace(/^u\//, ''))
        .filter(Boolean);

      const note: HandoverNote = {
        shiftId,
        fromMod: currentMod,
        writtenAt: Date.now(),
        freeText: freeText.trim(),
        usersToWatch,
        openIncidents: openIncidents.trim(),
        urgentNote: urgentNote.trim(),
      };

      // 1. Save handover
      await saveHandover(redis, note);

      // 2. Log mod offline
      if (currentMod !== 'Guest') {
        await goOffline(redis, currentMod);
      }

      // 3. Increment stats
      if (currentMod !== 'Guest') {
        await incrementStat(redis as unknown as Parameters<typeof incrementStat>[0], currentMod, 'handovers');
      }

      ui.showToast({
        text: "Handover saved — thanks for keeping the team informed ✓",
        appearance: "success",
      });

      onSuccess();
    } catch (err) {
      ui.showToast({
        text: err instanceof Error ? err.message : "Failed to save handover",
        appearance: "neutral",
      });
    }
  };

  return (
    <vstack
      backgroundColor="rgba(8, 10, 19, 0.85)"
      alignment="center middle"
      width="100%"
      height="100%"
      padding="large"
    >
      <vstack
        backgroundColor="#ffffff"
        padding="large"
        cornerRadius="medium"
        width="90%"
        gap="medium"
        border="thin"
      >
        <text size="large" weight="bold">⏰ Your shift just ended</text>
        <text size="small" color="neutral-content">
          Leave a note for the next mod — takes 2 minutes, helps them enormously
        </text>

        {/* Paragraph text: What happened */}
        <vstack gap="small">
          <text size="small" weight="bold">What happened this shift? *</text>
          <textarea
            placeholder="Key actions, user bans, mod discussions..."
            value={freeText}
            onInput={(e: { value?: string }) => setFreeText(e.value || '')}
            rows={3}
          />
        </vstack>

        {/* Users to watch */}
        <vstack gap="small">
          <text size="small" weight="bold">Any users to watch?</text>
          <input
            placeholder="u/user1, u/user2"
            value={usersToWatchStr}
            onInput={(e: { value?: string }) => setUsersToWatchStr(e.value || '')}
          />
        </vstack>

        {/* Open incidents */}
        <vstack gap="small">
          <text size="small" weight="bold">Open incidents?</text>
          <textarea
            placeholder="List any ongoing incidents..."
            value={openIncidents}
            onInput={(e: { value?: string }) => setOpenIncidents(e.value || '')}
            rows={2}
          />
        </vstack>

        {/* Urgent notes */}
        <vstack gap="small">
          <text size="small" weight="bold">Anything urgent for the next mod?</text>
          <textarea
            placeholder="Urgent actions required immediately..."
            value={urgentNote}
            onInput={(e: { value?: string }) => setUrgentNote(e.value || '')}
            rows={2}
          />
        </vstack>

        {/* Action buttons */}
        <vstack gap="small" width="100%">
          <hstack backgroundColor="#10b981" padding="medium" cornerRadius="medium" alignment="center middle" onPress={handleSubmit}>
            <text color="white" weight="bold">Submit handover</text>
          </hstack>
          
          <button size="small" appearance="secondary" onPress={onCancel}>
            Skip (not recommended)
          </button>
        </vstack>
      </vstack>
    </vstack>
  );
};
