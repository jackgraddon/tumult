<script setup lang="ts">
import type { MatrixEvent } from 'matrix-js-sdk';

const props = defineProps<{
  event: MatrixEvent;
}>();

const store = useMatrixStore();
const content = computed(() => props.event.getContent());
const senderId = computed(() => props.event.getSender());
const senderName = computed(() => store.client?.getRoom(props.event.getRoomId()!)?.getMember(senderId.value!)?.name || senderId.value);

const actionText = computed(() => {
  if (content.value.action === 'move') {
    if (content.value.move) {
      // Chess move
      const pieceMap: Record<string, string> = {
        'p': 'Pawn',
        'r': 'Rook',
        'n': 'Knight',
        'b': 'Bishop',
        'q': 'Queen',
        'k': 'King'
      };
      const pieceName = pieceMap[content.value.piece] || 'Piece';
      const to = content.value.to?.toUpperCase() || content.value.move;
      
      // If we have detailed info, use it: "Knight to E4"
      if (content.value.piece && content.value.to) {
        return `${senderName.value} moved ${pieceName} to ${to}`;
      }
      
      return `${senderName.value} moved ${content.value.move}`;
    }
    if (typeof content.value.position === 'number') {
      // Tic-Tac-Toe move
      return `${senderName.value} moved at position ${content.value.position + 1}`;
    }
    return `${senderName.value} moved`;
  }
  if (content.value.action === 'accept') return `${senderName.value} accepted the game!`;
  if (content.value.action === 'decline') return `${senderName.value} declined the game.`;
  return `${senderName.value} action: ${content.value.action}`;
});
</script>

<template>
  <div class="flex items-center gap-2 py-2 px-3 bg-muted/30 border border-border/50 rounded-2xl shadow-sm hover:bg-muted/40 transition-colors my-2">
    <div class="h-6 w-6 rounded-full bg-blue-500/20 flex items-center justify-center border border-blue-500/30">
      <Icon name="solar:gamepad-bold" class="text-blue-600 dark:text-blue-500 h-3 w-3" />
    </div>
    <div class="flex flex-col">
      <div class="flex items-center gap-2">
        <span class="text-[10px] text-muted-foreground">{{ actionText }}</span>
      </div>
    </div>
  </div>
</template>
