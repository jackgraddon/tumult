import { ref } from 'vue';
import type { Room } from 'matrix-js-sdk';
import { useVoiceStore } from '~/stores/voice';

// localStorage key — persists the user's "don't show again" choice
const KEYCHAIN_WARNING_DISMISSED_KEY = 'ruby_chat:keychain_warning_dismissed';

/**
 * Wraps joinVoiceRoom with a one-time Keychain warning dialog.
 *
 * Usage in any component:
 *
 *   const { showKeychainWarning, pendingRoom, handleJoinCall, handleProceed, handleCancel }
 *     = useJoinCall();
 *
 *   // Replace voiceStore.joinVoiceRoom(room) with:
 *   handleJoinCall(room);
 *
 *   // Add to template:
 *   <KeychainWarningDialog
 *     v-model="showKeychainWarning"
 *     @proceed="handleProceed"
 *     @cancel="handleCancel"
 *   />
 */
export function useJoinCall() {
  const voiceStore = useVoiceStore();

  const showKeychainWarning = ref(false);
  const pendingRoom = ref<Room | null>(null);

  function hasSeenWarning(): boolean {
    try {
      return localStorage.getItem(KEYCHAIN_WARNING_DISMISSED_KEY) === 'true';
    } catch {
      return false;
    }
  }

  function dismissWarning() {
    try {
      localStorage.setItem(KEYCHAIN_WARNING_DISMISSED_KEY, 'true');
    } catch {
      // localStorage unavailable — just proceed silently
    }
  }

  /**
   * Call this wherever you previously called voiceStore.joinVoiceRoom(room).
   * If the user hasn't seen the warning yet, shows the dialog first.
   * Otherwise proceeds directly.
   */
  function handleJoinCall(room: Room) {
    if (hasSeenWarning()) {
      voiceStore.joinVoiceRoom(room);
      return;
    }

    pendingRoom.value = room;
    showKeychainWarning.value = true;
  }

  /**
   * Called when the user clicks "Join Call" in the warning dialog.
   * @param remember - whether the user checked "Don't show this again"
   */
  function handleProceed(remember: boolean) {
    if (remember) dismissWarning();

    const room = pendingRoom.value;
    pendingRoom.value = null;

    if (room) voiceStore.joinVoiceRoom(room);
  }

  /**
   * Called when the user cancels the warning dialog.
   */
  function handleCancel() {
    pendingRoom.value = null;
    showKeychainWarning.value = false;
  }

  return {
    showKeychainWarning,
    pendingRoom,
    handleJoinCall,
    handleProceed,
    handleCancel,
  };
}