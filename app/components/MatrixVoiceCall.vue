<template>
  <div class="matrix-voice-call w-full h-full bg-sidebar">
    <!-- Minimized Layout -->
    <div v-if="isMinimized" class="w-full h-full flex items-center px-4 gap-3 overflow-x-auto overflow-y-hidden custom-scrollbar">
      <!-- Minimized Scrollable Avatar List -->
      <ParticipantTile 
        v-for="p in participants" 
        :key="p.identity" 
        :participant="p" 
        :room-id="roomId"
        layout="minimized"
      />
    </div>

    <!-- Default Layout -->
    <div v-else class="h-full w-full flex flex-col relative overflow-hidden">
      <!-- Main Call Area -->
      <div class="flex-1 overflow-hidden p-2 md:p-6 flex items-center justify-center">
        <div 
          v-if="participants.length > 0"
          class="w-full h-full grid gap-2 md:gap-4 transition-all duration-300"
          :style="{
            gridTemplateColumns: `repeat(${gridDimensions.columns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${gridDimensions.rows}, minmax(0, 1fr))`
          }"
        >
          <ParticipantTile 
            v-for="p in participants" 
            :key="p.identity" 
            :participant="p" 
            :room-id="roomId"
          />
        </div>

        <!-- Empty State -->
        <div v-else class="flex flex-col items-center justify-center p-12 text-center gap-4">
          <div class="h-16 w-16 rounded-full bg-black/20 flex items-center justify-center text-white/50">
            <Icon name="solar:users-group-rounded-bold-duotone" class="h-8 w-8" />
          </div>
          <p class="text-sm font-medium text-white/50 italic">Waiting for others to join...</p>
        </div>
      </div>

      <!-- Call Controls Bar -->
      <div class="h-24 md:h-20 flex items-center justify-center/80 backdrop-blur-md border-t border-border px-4 md:px-6 shrink-0 z-20 pb-4 md:pb-0">
        <div class="flex items-center gap-3 md:gap-4">
          <!-- Microphone Toggle -->
          <UiButton 
            :variant="voiceStore.isMicEnabled ? 'secondary' : 'destructive'" 
            size="icon" 
            class="h-12 w-12 md:h-14 md:w-14 rounded-full shadow-lg transition-all active:scale-95"
            @click="voiceStore.toggleMic()"
          >
            <Icon :name="voiceStore.isMicEnabled ? 'solar:microphone-large-bold' : 'solar:microphone-large-outline'" class="h-6 w-6 md:h-7 md:w-7" />
          </UiButton>

          <!-- Camera Toggle -->
          <UiButton 
            :variant="voiceStore.isCameraEnabled ? 'secondary' : 'destructive'" 
            size="icon" 
            class="h-12 w-12 md:h-14 md:w-14 rounded-full shadow-lg transition-all active:scale-95"
            @click="voiceStore.toggleCamera()"
          >
            <Icon :name="voiceStore.isCameraEnabled ? 'solar:videocamera-bold' : 'solar:videocamera-outline'" class="h-6 w-6 md:h-7 md:w-7" />
          </UiButton>

          <!-- Disconnect button -->
          <UiButton 
            variant="destructive" 
            size="lg" 
            class="h-12 px-6 md:h-14 md:px-8 rounded-full font-bold shadow-xl transition-all active:scale-95"
            @click="$emit('disconnect')"
          >
            <Icon name="solar:end-call-bold" class="mr-2" />
            <span class="hidden md:inline">End Call</span>
          </UiButton>
        </div>
      </div>

      <!-- Connection Status -->
      <div class="absolute top-4 left-4 z-10">
        <div class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-md border border-white/10 shadow-lg">
          <div class="h-2 w-2 rounded-full bg-green-500 animate-pulse"/>
          <span class="text-[10px] md:text-xs font-bold text-white uppercase tracking-wider">{{ roomName }}</span>
          <div class="w-px h-3 bg-white/20 mx-1"/>
          <span class="text-[10px] md:text-xs text-white/70">{{ participants.length }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Room, Participant } from 'livekit-client';
import { RoomEvent } from 'livekit-client';
import { shallowRef, onMounted, onUnmounted, computed, markRaw, watch } from 'vue';
import ParticipantTile from './ParticipantTile.vue';
import { useVoiceStore } from '~/stores/voice';

const props = defineProps<{
  room: Room;
  roomId: string;
  roomName: string;
  isMinimized?: boolean;
}>();

const emit = defineEmits<{
  (e: 'disconnect'): void;
}>();

const voiceStore = useVoiceStore();
const participants = shallowRef<Participant[]>([]);

const gridDimensions = computed(() => {
  const count = participants.value.length;
  const isMobile = import.meta.client && window.innerWidth < 768;

  if (count === 0) return { columns: 1, rows: 1 };
  if (count === 1) return { columns: 1, rows: 1 };
  
  if (isMobile) {
    if (count === 2) return { columns: 1, rows: 2 };
    if (count <= 4) return { columns: 2, rows: 2 };
    if (count <= 6) return { columns: 2, rows: 3 };
    if (count <= 9) return { columns: 3, rows: 3 };
    return { columns: 3, rows: Math.ceil(count / 3) };
  } else {
    // Desktop layout adapts based on count
    if (count === 2) return { columns: 2, rows: 1 };
    if (count <= 4) return { columns: 2, rows: 2 };
    if (count <= 6) return { columns: 3, rows: 2 };
    if (count <= 9) return { columns: 3, rows: 3 };
    if (count <= 12) return { columns: 4, rows: 3 };
    if (count <= 16) return { columns: 4, rows: 4 };
    return { columns: Math.ceil(Math.sqrt(count)), rows: Math.ceil(Math.sqrt(count)) };
  }
});

function updateParticipants() {
  if (!props.room) return;
  const all = Array.from(props.room.remoteParticipants.values());
  const newList = [props.room.localParticipant, ...all].map(p => markRaw(p));
  console.log(`[VoiceCall] Participants updated: ${newList.length} (${newList.map(p => p.identity).join(', ')})`);
  participants.value = newList;
}

// Watch for room changes to re-bind listeners
watch(() => props.room, (newRoom, oldRoom) => {
  if (oldRoom) unbindRoomListeners(oldRoom);
  if (newRoom) {
    bindRoomListeners(newRoom);
    updateParticipants();
  }
}, { immediate: true });

function bindRoomListeners(room: Room) {
  room.on(RoomEvent.SignalConnected, updateParticipants);
  room.on(RoomEvent.ParticipantConnected, updateParticipants);
  room.on(RoomEvent.ParticipantDisconnected, updateParticipants);
  room.on(RoomEvent.TrackSubscribed, updateParticipants);
  room.on(RoomEvent.TrackUnsubscribed, updateParticipants);
  room.on(RoomEvent.TrackMuted, updateParticipants);
  room.on(RoomEvent.TrackUnmuted, updateParticipants);
  room.on(RoomEvent.ParticipantMetadataChanged, updateParticipants);
  room.on(RoomEvent.ParticipantPermissionsChanged, updateParticipants);
}

function unbindRoomListeners(room: Room) {
  room.off(RoomEvent.SignalConnected, updateParticipants);
  room.off(RoomEvent.ParticipantConnected, updateParticipants);
  room.off(RoomEvent.ParticipantDisconnected, updateParticipants);
  room.off(RoomEvent.TrackSubscribed, updateParticipants);
  room.off(RoomEvent.TrackUnsubscribed, updateParticipants);
  room.off(RoomEvent.TrackMuted, updateParticipants);
  room.off(RoomEvent.TrackUnmuted, updateParticipants);
  room.off(RoomEvent.ParticipantMetadataChanged, updateParticipants);
  room.off(RoomEvent.ParticipantPermissionsChanged, updateParticipants);
}

onUnmounted(() => {
  if (props.room) {
    unbindRoomListeners(props.room);
  }
});
</script>
