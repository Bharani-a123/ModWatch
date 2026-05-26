import { Devvit, useAsync, JSONArray } from '@devvit/public-api';
import { getLatestHandover, HandoverNote } from './redis/handover.js';

interface HandoverViewProps {
  context: Devvit.Context;
  onWriteNote: () => void;
  refreshCounter: number;
}

export const HandoverView = (props: HandoverViewProps) => {
  const { context, onWriteNote, refreshCounter } = props;
  const { redis } = context;

  // Load the latest handover note
  const { data: latestNoteVal } = useAsync<JSONArray | null>(async () => {
    const note = await getLatestHandover(redis);
    if (!note) return null;
    return [note] as unknown as JSONArray;
  }, { depends: [refreshCounter.toString()] });

  const latestNote = latestNoteVal && latestNoteVal.length > 0
    ? (latestNoteVal[0] as unknown as HandoverNote)
    : null;

  return (
    <vstack gap="medium" width="100%">
      <hstack alignment="middle" width="100%">
        <text size="large" weight="bold">Latest Handover</text>
        <spacer grow />
        <button size="small" onPress={onWriteNote}>Write handover note</button>
      </hstack>

      {latestNote ? (
        <vstack border="thin" padding="medium" cornerRadius="medium" gap="medium" backgroundColor="#ffffff">
          <hstack alignment="middle">
            <vstack>
              <text weight="bold">Last handover from u/{latestNote.fromMod}</text>
              <text size="small" color="neutral-content">
                Written at: {new Date(latestNote.writtenAt).toUTCString()}
              </text>
            </vstack>
          </hstack>

          <vstack gap="small">
            <text weight="bold" size="small">What happened:</text>
            <text color="neutral-content" wrap>{latestNote.freeText}</text>
          </vstack>

          {latestNote.usersToWatch && latestNote.usersToWatch.length > 0 && (
            <vstack gap="small">
              <text weight="bold" size="small">Watch these users:</text>
              <hstack gap="small">
                {latestNote.usersToWatch.map((user) => (
                  <hstack
                    key={user}
                    backgroundColor="#fee2e2"
                    padding="small"
                    cornerRadius="full"
                    alignment="middle"
                  >
                    <text size="small" color="#991b1b" weight="bold">
                      u/{user}
                    </text>
                  </hstack>
                ))}
              </hstack>
            </vstack>
          )}

          {latestNote.openIncidents && (
            <vstack gap="small">
              <text weight="bold" size="small">Open incidents:</text>
              <text color="neutral-content" wrap>{latestNote.openIncidents}</text>
            </vstack>
          )}

          {latestNote.urgentNote && (
            <vstack
              backgroundColor="#fef3c7"
              padding="medium"
              cornerRadius="medium"
              gap="small"
              border="thin"
            >
              <text color="#b55309" weight="bold" size="small">Urgent Note:</text>
              <text color="#92400e" wrap>{latestNote.urgentNote}</text>
            </vstack>
          )}
        </vstack>
      ) : (
        <vstack border="thin" padding="medium" cornerRadius="medium" alignment="center middle" backgroundColor="#f9fafb">
          <text color="neutral-content">
            No handover notes yet — this session starts fresh
          </text>
        </vstack>
      )}
    </vstack>
  );
};
