export {};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      input: {
        value?: string;
        onInput?: (event: { value?: string }) => void | Promise<void>;
        placeholder?: string;
      };
      textarea: {
        value?: string;
        onInput?: (event: { value?: string }) => void | Promise<void>;
        placeholder?: string;
        rows?: number;
      };
    }
  }
}
