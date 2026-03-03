<script setup lang="ts">
import type { MatrixEvent } from 'matrix-js-sdk';

const props = defineProps<{
  event: MatrixEvent;
}>();

const store = useMatrixStore();
const content = computed(() => props.event.getContent());
const senderId = computed(() => props.event.getSender());
const senderName = computed(() => store.client?.getRoom(props.event.getRoomId()!)?.getMember(senderId.value!)?.name || senderId.value);

const resultText = computed(() => {
  if (content.value.status === 'won') {
    const winnerId = content.value.winner;
    const winnerName = store.client?.getRoom(props.event.getRoomId()!)?.getMember(winnerId)?.name || winnerId;
    return `${winnerName} won the game!`;
  } else if (content.value.status === 'draw') {
    return `Game ended in a draw!`;
  }
  return `Game over: ${content.value.status}`;
});
</script>

<template>
  <div class="flex flex-col items-center gap-3 p-4 bg-muted/20 border border-border rounded-xl shadow-sm max-w-[320px] my-4 self-center">
    <div class="flex items-center gap-2">
      <div class="h-8 w-8 rounded-full bg-green-500/10 flex items-center justify-center border border-green-500/30">
        <Icon name="solar:cup-bold" class="h-5 w-5 text-green-600 dark:text-green-500" />
      </div>
      <div class="flex flex-col">
        <span class="text-sm font-bold">Game Over</span>
        <span class="text-xs text-muted-foreground">{{ content.game_type }}</span>
      </div>
    </div>
    
    <p class="text-sm font-medium text-foreground leading-relaxed">
      {{ resultText }}
    </p>
  </div>
</template>
