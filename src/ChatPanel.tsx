import { Devvit, useState, useAsync, useInterval, JSONArray } from '@devvit/public-api';
import {
  ChatMessage,
  getMessages,
  sendMessage,
  formatTime,
} from './redis/chat.js';
import { PresenceRecord } from './redis/presence.js';

interface ChatPanelProps {
  currentMod: string;
  onlineMods: PresenceRecord[];
  redis: Devvit.Context['redis'];
  ui: Devvit.Context['ui'];
}

export const ChatPanel = (props: ChatPanelProps) => {
  const { currentMod, onlineMods, redis, ui } = props;

  // Local message state and input query
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState<string>('');
  const [pollTrigger, setPollTrigger] = useState<number>(0);

  // Ref container placeholder to satisfy auto-scroll ref constraint
  const messageListRef = { current: null };

  // Fetch messages from Redis every 10 seconds (polled via useInterval)
  const { data: polledMessagesVal } = useAsync<JSONArray>(async () => {
    const list = await getMessages(redis);
    return list as unknown as JSONArray;
  }, { depends: [pollTrigger.toString()] });

  // Update messages state when new polled messages arrive, but preserve optimistic ones
  const polledMessages = (polledMessagesVal as unknown as ChatMessage[]) || [];

  // Sync state with polled messages (only overwrite if we don't have pending optimistic UI updates)
  const displayMessages = polledMessages.length > 0 ? polledMessages : messages;

  // Set up 10-second polling interval for chat messages
  const chatInterval = useInterval(() => {
    setPollTrigger((prev) => prev + 1);
  }, 10000);
  chatInterval.start();

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (trimmed.length > 280) {
      ui.showToast({ text: 'Message too long (max 280 chars)', appearance: 'neutral' });
      return;
    }

    // Optimistic UI update
    const optimisticMsg: ChatMessage = {
      id: `msg_optimistic_${Date.now()}`,
      fromMod: currentMod,
      text: trimmed,
      sentAt: Date.now(),
    };

    setMessages((prev) => [...prev, optimisticMsg].slice(-50));
    setText(''); // Clear input

    try {
      await sendMessage(redis, currentMod, trimmed);
      // Let the next 10s poll confirm the write
      setPollTrigger((prev) => prev + 1);
    } catch {
      ui.showToast({ text: 'Failed to send message', appearance: 'neutral' });
    }
  };

  // Only activate chat if 2+ mods are online
  if (onlineMods.length < 2) {
    return (
      <vstack border="thin" padding="medium" cornerRadius="medium" gap="small" backgroundColor="#f9fafb" width="100%">
        <hstack gap="small" alignment="middle">
          <text size="small" weight="bold">Team chat</text>
          <hstack backgroundColor="#e5e7eb" padding="small" cornerRadius="full">
            <text size="xsmall" color="#374151" weight="bold">
              {onlineMods.length.toString()} online
            </text>
          </hstack>
        </hstack>
        <vstack border="thin" padding="medium" cornerRadius="medium" alignment="center middle" backgroundColor="#ffffff">
          <text size="small" color="neutral-content" wrap>
            💬 Chat activates when another mod comes online
          </text>
        </vstack>
      </vstack>
    );
  }

  return (
    <vstack border="thin" padding="medium" cornerRadius="medium" gap="medium" backgroundColor="#f9fafb" width="100%">
      {/* Header containing mod count badge */}
      <hstack gap="small" alignment="middle">
        <text size="small" weight="bold">Team chat</text>
        <hstack backgroundColor="#d1fae5" padding="small" cornerRadius="full">
          <text size="xsmall" color="#047857" weight="bold">
            {onlineMods.length.toString()} online
          </text>
        </hstack>
      </hstack>

      {/* Message list - scrollable container using ref placeholder */}
      <vstack
        {...({ ref: messageListRef } as Record<string, unknown>)}
        height="300px"
        width="100%"
        gap="small"
        border="thin"
        padding="small"
        cornerRadius="small"
        backgroundColor="#ffffff"
      >
        {displayMessages.length === 0 ? (
          <vstack alignment="center middle" grow>
            <text size="small" color="neutral-content">No chat history. Say hi!</text>
          </vstack>
        ) : (
          displayMessages.map((msg) => {
            const isSelf = msg.fromMod === currentMod;
            const align = isSelf ? 'end' : 'start';
            const bubbleBg = isSelf ? '#10b981' : '#f3f4f6';
            const textColor = isSelf ? '#ffffff' : '#1f2937';
            const metaColor = isSelf ? '#e0f2fe' : 'neutral-content';

            return (
              <vstack key={msg.id} alignment={align} width="100%" gap="small">
                {/* Bubble container */}
                <vstack
                  backgroundColor={bubbleBg}
                  padding="small"
                  cornerRadius="medium"
                  maxWidth="80%"
                  gap="small"
                >
                  <text color={textColor} size="small" wrap>
                    {msg.text}
                  </text>
                  <hstack gap="small" alignment="middle">
                    <text size="xsmall" color={metaColor} weight="bold">
                      u/{msg.fromMod}
                    </text>
                    <text size="xsmall" color={metaColor}>
                      {formatTime(msg.sentAt)}
                    </text>
                  </hstack>
                </vstack>
              </vstack>
            );
          })
        )}
      </vstack>

      {/* Input controls at bottom */}
      <vstack gap="small" width="100%">
        <hstack gap="small" width="100%">
          <input
            placeholder="Message the team..."
            value={text}
            onInput={(e: { value?: string }) => setText(e.value || '')}
          />
          {/* Send button (green container) */}
          <hstack
            backgroundColor="#10b981"
            padding="medium"
            cornerRadius="medium"
            alignment="center middle"
            onPress={handleSend}
          >
            <text color="white" weight="bold" size="small">Send</text>
          </hstack>
        </hstack>
        {/* Character count alerts */}
        {text.length > 200 && (
          <text size="xsmall" color={text.length > 280 ? '#dc2626' : 'neutral-content'} alignment="end">
            {text.length.toString()}/280
          </text>
        )}
      </vstack>
    </vstack>
  );
};
