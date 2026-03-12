<template>
  <UiAvatar :class="cn('h-10 w-10 border overflow-hidden', props.class)">
    <UiAvatarImage
      v-if="imageUrl"
      :src="imageUrl"
      :alt="`${name}'s User Avatar `|| 'User Avatar'"
      class="object-cover"
    />
    <UiAvatarFallback>{{ initials }}</UiAvatarFallback>
  </UiAvatar>
</template>

<script setup lang="ts">
import { useAuthenticatedMedia } from '~/composables/useAuthenticatedMedia';
import { cn } from '~/lib/utils'; // Assuming generic util exists, if not I'll duplicate or remove

const props = defineProps<{
  mxcUrl?: string | null;
  name?: string | null;
  class?: string;
  size?: number; // Not strictly used for styling (handled by class) but used for fetching resolution
}>();

const { imageUrl } = useAuthenticatedMedia(
  () => props.mxcUrl,
  props.size || 96,
  props.size || 96,
  'crop'
);

/* 
watchEffect(() => {
  console.log(`[MatrixAvatar] Name: ${props.name}, MXC: ${props.mxcUrl}, Image: ${imageUrl.value}`);
});
*/

const initials = computed(() => {
  const n = props.name || "?";
  return n.slice(0, 2).toUpperCase();
});
</script>
