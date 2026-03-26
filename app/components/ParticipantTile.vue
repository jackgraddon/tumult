<template>
  <div class="participant-tile relative flex flex-col items-center justify-center bg-neutral-800 rounded-lg overflow-hidden border border-neutral-700 shadow-xl group aspect-video">
    
    <video
      v-show="videoTrack"
      ref="videoElement"
      autoplay
      playsinline
      muted
      class="w-full h-full object-cover"
    ></video>

    <div 
      v-if="!videoTrack || !isCameraEnabled"
      class="absolute inset-0 flex flex-col items-center justify-center bg-neutral-800 gap-4"
    >
      <MatrixAvatar 
        :mxc-url="avatarUrl" 
        :name="displayName" 
        class="w-24 h-24 rounded-full border-2 border-primary/20 shadow-2xl" 
        :size="128"
      />
      <div class="flex flex-col items-center gap-1">
        <span class="text-xl font-bold text-white drop-shadow-md">{{ displayName }}</span>
      </div>
    </div>

    <div class="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium text-white px-2 py-0.5 bg-black/40 rounded backdrop-blur-sm flex items-center gap-1">
          <Icon v-if="isDiscordParticipant" name="logos:discord-icon" class="h-3 w-3" />
          {{ displayName }}
        </span>
      </div>
      <div class="flex items-center gap-1">
        <Icon v-if="!isMicEnabled" name="solar:muted-bold" class="h-4 w-4 text-red-500" />
        <Icon v-if="isSpeaking" name="solar:soundwave-bold" class="h-4 w-4 text-green-500" />
        <Icon v-if="isEncrypted" name="solar:lock-bold" class="h-3 w-3 text-green-500" />
      </div>
    </div>

    <div 
      v-if="isSpeaking" 
      class="absolute inset-0 border-2 border-green-500 rounded-lg pointer-events-none z-10 animate-pulse"
    ></div>

    <audio 
      ref="audioElement" 
      autoplay 
      playsinline
      :muted="participant.isLocal"
    ></audio>
  </div>
</template>

<script setup lang="ts">
// Import the ParticipantEvent enum to safely bind to LiveKit lifecycle hooks
import { Participant, Track, RemoteTrack, TrackPublication, ParticipantEvent } from 'livekit-client';
import { ref, shallowRef, onMounted, onUnmounted, computed } from 'vue';
import { useMatrixStore } from '~/stores/matrix';
import MatrixAvatar from '~/components/MatrixAvatar.vue';

const props = defineProps<{
  participant: Participant;
  roomId: string;
}>();

const store = useMatrixStore();
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
const onTrackSubscribed = (track: Track) => attachTrack(track);
const onTrackUnsubscribed = (track: Track) => detachTrack(track);
const onLocalTrackPublished = (pub: TrackPublication) => { if (pub.track) attachTrack(pub.track); updateMediaState(); };
const onLocalTrackUnpublished = (pub: TrackPublication) => { if (pub.track) detachTrack(pub.track); updateMediaState(); };

function updateMediaState() {
  isMicEnabled.value = props.participant.isMicrophoneEnabled;
  isCameraEnabled.value = props.participant.isCameraEnabled;
  isEncrypted.value = props.participant.isEncrypted;
}

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

  // Status updates
  props.participant.on(ParticipantEvent.IsSpeakingChanged, (speaking: boolean) => {
    isSpeaking.value = speaking;
  });
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
  
  if (videoTrack.value) videoTrack.value.detach();
  if (audioTrack.value) audioTrack.value.detach();
});
</script>