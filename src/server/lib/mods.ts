type RedditClient = typeof import('@devvit/reddit').reddit;

export async function getModerators(
  reddit: RedditClient,
  subredditName: string
): Promise<Array<{ username: string }>> {
  return (await reddit.getModerators({ subredditName }).all()) as Array<{
    username: string;
  }>;
}

export async function getModeratorNames(
  reddit: RedditClient,
  subredditName: string
): Promise<string[]> {
  const mods = await getModerators(reddit, subredditName);
  return mods.map((mod) => mod.username);
}

export async function getHeadModUsername(
  reddit: RedditClient,
  subredditName: string
): Promise<string | undefined> {
  const mods = await getModerators(reddit, subredditName);
  return mods[0]?.username;
}

export async function isHeadMod(
  reddit: RedditClient,
  subredditName: string,
  username?: string
): Promise<boolean> {
  if (!username) {
    return false;
  }

  const headMod = await getHeadModUsername(reddit, subredditName);
  return headMod === username;
}

export async function assertHeadMod(
  reddit: RedditClient,
  subredditName: string,
  username?: string
): Promise<void> {
  if (!(await isHeadMod(reddit, subredditName, username))) {
    throw new Error('Head mod permission required.');
  }
}
