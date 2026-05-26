declare module '@devvit/web/client' {
  export const context: {
    postId: string;
    userId?: string;
    username?: string;
  };

  export function showToast(
    value:
      | string
      | {
          text: string;
          appearance?: 'neutral' | 'success';
        }
  ): void;

  export function connectRealtime<T>(options: {
    channel: string;
    onConnect?: (channel: string) => void;
    onDisconnect?: (channel: string) => void;
    onMessage: (data: T) => void | Promise<void>;
  }): unknown;
}
