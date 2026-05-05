declare module 'web-haptics' {
  export type HapticPreset = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';
  export class WebHaptics {
    constructor(options?: { debug?: boolean });
    trigger(preset: HapticPreset): void;
  }
}

declare module 'web-haptics/vue' {
  import type { WebHaptics } from 'web-haptics';
  export function useWebHaptics(options?: { debug?: boolean }): {
    haptics: WebHaptics;
    trigger: WebHaptics['trigger'];
  };
}
