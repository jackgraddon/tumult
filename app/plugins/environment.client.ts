export default defineNuxtPlugin(() => {
  const isTauri = import.meta.client && !!(window as any).__TAURI_INTERNALS__;
  
  if (isTauri && import.meta.client) {
    document.documentElement.classList.add('is-tauri');
  }

  return {
    provide: {
      isTauri
    }
  };
});
