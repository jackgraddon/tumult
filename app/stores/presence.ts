import { defineStore } from 'pinia';
import { useMatrixStore } from './matrix';
import { invoke } from '@tauri-apps/api/core';

export const usePresenceStore = defineStore('presence', {
  state: () => ({
    activeGame: null as any | null,
    lastUpdated: 0,
  }),
  actions: {
    updateGame(data: any) {
      this.activeGame = data;
      this.lastUpdated = Date.now();

      const matrix = useMatrixStore();

      let status = '';
      if (data) {
        // Construct rich status
        // Simple: 🎮 Playing ${data.name}
        // Rich: 🎮 ${data.name}: ${data.details} (${data.state})
        const name = data.name || 'Unknown Game';
        const details = data.details ? `: ${data.details}` : '';
        const state = data.state ? ` (${data.state})` : '';
        status = `🎮 ${name}${details}${state}`;
      }

      // Update the main Matrix status (throttled in matrix store)
      matrix.updatePresence(status, data?.name || null);
    },
    async clearGame() {
      this.activeGame = null;
      this.lastUpdated = Date.now();
      const matrix = useMatrixStore();
      matrix.updatePresence('');

      try {
        await invoke('stop_rpc_server');
      } catch (e) {
        console.error('[PresenceStore] Failed to stop RPC server:', e);
      }
    }
  }
});
