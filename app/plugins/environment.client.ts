export default defineNuxtPlugin(() => {
  const isTauri = import.meta.client && !!(window as any).__TAURI_INTERNALS__;

  return {
    provide: {
      isTauri
    }
  };
});
