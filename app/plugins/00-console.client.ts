export default defineNuxtPlugin({
    name: '00-console-hook',
    enforce: 'pre',
    async setup() {
      // Only run in the browser/Tauri context
      if (!import.meta.client) return;
  
      const isTauri = !!(window as any).__TAURI_INTERNALS__;
      
      if (isTauri) {
        try {
          // Dynamically import Tauri event API
          const { emit } = await import('@tauri-apps/api/event');
          
          console.log("[00-Console] Setting up early log interception for Splash Screen...");
  
          // Store original console methods
          const originalLogs = {
            log: console.log,
            warn: console.warn,
            error: console.error
          };
  
          // Helper to stream logs to the splash window
          const streamLog = (type: string, args: any[]) => {
            try {
              const message = args.map(a => {
                if (a instanceof Error) {
                  return `${a.name}: ${a.message}\n${a.stack || ''}`;
                }
                if (typeof a === 'object') {
                  try {
                    return JSON.stringify(a, null, 2);
                  } catch (e) {
                    return '[Unserializable Object]';
                  }
                }
                return String(a);
              }).join(' ');
              emit('main-log', { type, message, timestamp: new Date().toISOString() });
            } catch (e) {
               // Silently fail if emit is not ready, we don't want an infinite loop
            }
          };
  
          // Override console methods
          console.log = (...args) => { originalLogs.log(...args); streamLog('info', args); };
          console.warn = (...args) => { originalLogs.warn(...args); streamLog('warn', args); };
          console.error = (...args) => { originalLogs.error(...args); streamLog('error', args); };
          
          console.log("[00-Console] Early console hooks active.");
        } catch (err) {
          console.error("[00-Console] Failed to setup hook:", err);
        }
      }
    }
  });
