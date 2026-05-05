<template>
  <div 
    :class="[
      layout === 'minimized'
        ? 'relative rounded-full shrink-0 transition-all duration-300 w-12 h-12 md:w-16 md:h-16 flex items-center justify-center overflow-hidden ' + (isSpeaking ? 'ring-4 ring-[#5865F2]' : 'ring-1 ring-border shadow-sm')
        : 'participant-tile relative flex flex-col items-center justify-center bg-secondary rounded-xl overflow-hidden shadow-xl group transition-all duration-300 transform-gpu w-full h-full min-h-[120px] ' + (isSpeaking ? 'ring-2 ring-green-500 shadow-[0_0_20px_rgba(34,197,94,0.3)]' : 'ring-1 ring-black/10')
    ]"
    :title="layout === 'minimized' ? displayName : undefined"
  >
    <!-- Minimized Content -->
    <MatrixAvatar 
      v-show="layout === 'minimized'"
      :mxc-url="avatarUrl" 
      :name="displayName" 
      class="w-full h-full"
      :size="64"
    />

    <!-- Default Content -->
    <div v-show="layout !== 'minimized'" class="contents">
      <video
        v-show="videoTrack"
        ref="videoElement"
        autoplay
        playsinline
        muted
        class="w-full h-full object-cover bg-black absolute inset-0 z-0"
      />

      <div 
        v-show="!videoTrack || !isCameraEnabled"
        class="absolute inset-0 flex flex-col items-center justify-center bg-secondary z-0"
      >
        <MatrixAvatar 
          :mxc-url="avatarUrl" 
          :name="displayName" 
          class="w-20 h-20 md:w-24 md:h-24 shadow-2xl transition-all duration-300"
          :size="128"
        />
      </div>

      <!-- Pill Overlay in bottom-left -->
      <div class="absolute bottom-2 left-2 md:bottom-3 md:left-3 flex items-center gap-1.5 px-2 py-1 md:py-1.5 bg-black/60 rounded-lg backdrop-blur-md max-w-[calc(100%-16px)] z-10">
        <span class="text-[10px] md:text-xs font-semibold text-white truncate max-w-[100px] md:max-w-[150px] flex items-center gap-1">
          <Icon v-if="isDiscordParticipant" name="logos:discord-icon" class="h-3 w-3 shrink-0" />
          {{ displayName }}
        </span>
        <div class="flex items-center gap-1 shrink-0 ml-1">
          <Icon v-if="!isMicEnabled" name="solar:muted-bold" class="h-3 w-3 md:h-3.5 md:w-3.5 text-red-500" />
          <Icon v-if="isSpeaking" name="solar:soundwave-bold" class="h-3 w-3 md:h-3.5 md:w-3.5 text-green-500" />
          <Icon v-if="isEncrypted" name="solar:lock-bold" class="h-2.5 w-2.5 text-green-500/70" />
        </div>
      </div>
    </div>

    <div 
      v-if="isSpeaking" 
      class="absolute inset-0 ring-2 ring-green-500 rounded-lg pointer-events-none z-10 animate-pulse active-speaking-glow"
    />

    <audio 
      ref="audioElement" 
      autoplay 
      playsinline
      :muted="participant.isLocal"
    />
  </div>
</template>

<script setup lang="ts">
// Import the ParticipantEvent enum to safely bind to LiveKit lifecycle hooks
import type { Participant, RemoteTrack, TrackPublication} from 'livekit-client';
import { Track, ParticipantEvent } from 'livekit-client';
import { ref, shallowRef, onMounted, onUnmounted, computed } from 'vue';
import { useMatrixStore } from '~/stores/matrix';
import MatrixAvatar from '~/components/MatrixAvatar.vue';

const props = withDefaults(defineProps<{
  participant: Participant;
  roomId: string;
  layout?: 'default' | 'minimized';
}>(), {
  layout: 'default'
});

const store = useMatrixStore();
const uiStore = useUIStore();
const matrixService = useMatrixService();
const presenceStore = usePresenceStore();
const videoElement = ref<HTMLVideoElement | null>(null);
const audioElement = ref<HTMLAudioElement | null>(null);

const videoTrack = shallowRef<RemoteTrack | Track | null>(null);
const audioTrack = shallowRef<RemoteTrack | Track | null>(null);

const isSpeaking = ref(props.participant.isSpeaking);
const isMicEnabled = ref(props.participant.isMicrophoneEnabled);
const isCameraEnabled = ref(props.participant.isCameraEnabled);
const isEncrypted = ref(props.participant.isEncrypted);

// Matrix Data extraction
// LiveKit identity is often "@user:server:DEVICEID" — extract just "@user:server"
const matrixUserId = computed(() => {
  const identity = props.participant.identity;
  if (!identity) return null;
  // Match @localpart:server (the Matrix user ID portion)
  const match = identity.match(/^(@[^:]+:[^:]+)/);
  return match?.[1] || identity;
});

const roomMember = computed(() => {
  if (!store.client || !matrixUserId.value) return null;
  const room = store.client.getRoom(props.roomId);
  return room?.getMember(matrixUserId.value) || null;
});

const displayName = computed(() => roomMember.value?.name || matrixUserId.value?.split(':')?.[0]?.replace('@', '') || 'Guest');
const avatarUrl = computed(() => roomMember.value?.getMxcAvatarUrl() || null);

const isDiscordParticipant = computed(() => props.participant.identity.startsWith('discord::'));

// Unified Attach/Detach logic
function attachTrack(track: Track) {
  if (track.kind === Track.Kind.Video) {
    if (videoTrack.value === track) return;
    videoTrack.value = track;
    if (videoElement.value) track.attach(videoElement.value);
  } else if (track.kind === Track.Kind.Audio) {
    // Don't attach our own audio — prevents hearing yourself
    if (props.participant.isLocal) return;
    if (audioTrack.value === track) return;
    audioTrack.value = track;
    if (audioElement.value) track.attach(audioElement.value);
  }
}

function detachTrack(track: Track) {
  track.detach();
  if (track.kind === Track.Kind.Video) videoTrack.value = null;
  if (track.kind === Track.Kind.Audio) audioTrack.value = null;
}

// Map LiveKit Events
// All handlers are stored as named references so they can be properly removed
// in onUnmounted. Inline arrow functions passed to .on() can never be .off()'d —
// each call creates a new function identity, so the listener leaks permanently.
const onTrackSubscribed = (track: Track) => attachTrack(track);
const onTrackUnsubscribed = (track: Track) => detachTrack(track);
const onLocalTrackPublished = (pub: TrackPublication) => { if (pub.track) attachTrack(pub.track); updateMediaState(); };
const onLocalTrackUnpublished = (pub: TrackPublication) => { if (pub.track) detachTrack(pub.track); updateMediaState(); };

function updateMediaState() {
  isMicEnabled.value = props.participant.isMicrophoneEnabled;
  isCameraEnabled.value = props.participant.isCameraEnabled;
  isEncrypted.value = props.participant.isEncrypted;
}

// Named handler for IsSpeakingChanged — must be stored to remove in onUnmounted
const onIsSpeakingChanged = (speaking: boolean) => { isSpeaking.value = speaking; };

onMounted(() => {
  // Attach any existing tracks (e.g., if you join a room with people already in it)
  props.participant.trackPublications.forEach((pub: any) => {
    if (pub.track) attachTrack(pub.track);
  });
  updateMediaState();

  // Remote tracks
  props.participant.on(ParticipantEvent.TrackSubscribed, onTrackSubscribed);
  props.participant.on(ParticipantEvent.TrackUnsubscribed, onTrackUnsubscribed);
  
  // Local tracks (Your own mic/camera)
  props.participant.on(ParticipantEvent.LocalTrackPublished, onLocalTrackPublished);
  props.participant.on(ParticipantEvent.LocalTrackUnpublished, onLocalTrackUnpublished);

  // Status updates — all stored as named references so they can be cleaned up
  props.participant.on(ParticipantEvent.IsSpeakingChanged, onIsSpeakingChanged);
  props.participant.on(ParticipantEvent.TrackPublished, updateMediaState);
  props.participant.on(ParticipantEvent.TrackUnpublished, updateMediaState);
  props.participant.on(ParticipantEvent.TrackMuted, updateMediaState);
  props.participant.on(ParticipantEvent.TrackUnmuted, updateMediaState);
});

onUnmounted(() => {
  props.participant.off(ParticipantEvent.TrackSubscribed, onTrackSubscribed);
  props.participant.off(ParticipantEvent.TrackUnsubscribed, onTrackUnsubscribed);
  props.participant.off(ParticipantEvent.LocalTrackPublished, onLocalTrackPublished);
  props.participant.off(ParticipantEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
  // These five were previously leaked — inline arrow functions passed to .on()
  // are never the same reference, so the old code's .off() calls were no-ops.
  props.participant.off(ParticipantEvent.IsSpeakingChanged, onIsSpeakingChanged);
  props.participant.off(ParticipantEvent.TrackPublished, updateMediaState);
  props.participant.off(ParticipantEvent.TrackUnpublished, updateMediaState);
  props.participant.off(ParticipantEvent.TrackMuted, updateMediaState);
  props.participant.off(ParticipantEvent.TrackUnmuted, updateMediaState);

  if (videoTrack.value) videoTrack.value.detach();
  if (audioTrack.value) audioTrack.value.detach();
});
</script>