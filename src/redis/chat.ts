import { RedisClient } from '@devvit/public-api';

export type ChatMessage = {
  id: string;           // "msg_{Date.now()}"
  fromMod: string;
  text: string;
  sentAt: number;       // Unix ms
};

const CHAT_KEY = 'chat:messages';
const TTL_SECONDS = 86400; // 24 hours

export async function getMessages(redis: RedisClient): Promise<ChatMessage[]> {
  const raw = await redis.get(CHAT_KEY);
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw) as ChatMessage[];
  } catch {
    return [];
  }
}

export async function sendMessage(
  redis: RedisClient,
  fromMod: string,
  text: string
): Promise<ChatMessage[]> {
  const id = `msg_${Date.now()}`;
  const sentAt = Date.now();
  const newMsg: ChatMessage = {
    id,
    fromMod,
    text,
    sentAt,
  };

  const existing = await getMessages(redis);
  // Append new message and keep last 50
  const updated = [...existing, newMsg].slice(-50);

  // Write back with 24 hours expiration TTL (reset on every write)
  await redis.set(CHAT_KEY, JSON.stringify(updated), {
    expiration: new Date(Date.now() + TTL_SECONDS * 1000),
  });

  return updated;
}

export async function clearOldMessages(redis: RedisClient): Promise<void> {
  await redis.del(CHAT_KEY);
}

export function formatTime(sentAt: number): string {
  const date = new Date(sentAt);
  const hh = date.getUTCHours().toString().padStart(2, '0');
  const mm = date.getUTCMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}
