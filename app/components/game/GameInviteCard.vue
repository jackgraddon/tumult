<script setup lang="ts">
import type { MatrixEvent } from 'matrix-js-sdk';
import { toast } from 'vue-sonner';

const props = defineProps<{
  event: MatrixEvent;
}>();

const store = useMatrixStore();
const roomId = props.event.getRoomId()!;
const { updateGameState, sendGameAction } = useMatrixGame(roomId);

const content = computed(() => props.event.getContent());
const isMyInvite = computed(() => content.value.invited_user === store.client?.getUserId());
const isOwnInvite = computed(() => props.event.getSender() === store.client?.getUserId());

async function acceptInvite() {
  const gameId = content.value.game_id;
  const gameType = content.value.game_type;
  
  console.log('[GameInvite] Accepting invite', { gameId, gameType });

  let initialBoard: any = null;
  let players: any = {};
  let currentTurn: string | undefined;

  if (gameType === 'tictactoe') {
    initialBoard = Array(9).fill(null);
    players = {
      X: props.event.getSender()!,
      O: store.client?.getUserId()!
    };
    currentTurn = players.X;
  } else if (gameType === 'chess') {
    initialBoard = 'start'; // chess.js FEN
    players = {
      white: props.event.getSender()!,
      black: store.client?.getUserId()!
    };
    currentTurn = players.white;
  }

  try {
    await updateGameState(gameId, {
      game_id: gameId,
      game_type: gameType,
      status: 'active',
      players: players,
      board: initialBoard,
      current_turn: currentTurn,
      started_at: Date.now()
    });

    await sendGameAction(gameId, {
      action: 'accept',
      player: store.client?.getUserId()
    });
    
    console.log('[GameInvite] Invite accepted successfully');
  } catch (err) {
    console.error('[GameInvite] Failed to accept invite', err);
    toast.error('Failed to accept game invite');
  }
}
</script>

<template>
  <div class="flex flex-col gap-3 p-4 bg-muted/20 border border-border rounded-xl shadow-sm max-w-[320px]">
    <div class="flex items-center gap-2">
      <div class="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
        <Icon name="solar:gamepad-bold" class="h-5 w-5 text-primary" />
      </div>
      <div class="flex flex-col">
        <span class="text-sm font-bold">Game Invite</span>
        <span class="text-xs text-muted-foreground">{{ content.game_type }}</span>
      </div>
    </div>
    
    <p class="text-xs text-muted-foreground leading-relaxed">
      {{ content.body }}
    </p>

    <div v-if="isMyInvite" class="mt-2 flex gap-2">
      <UiButton size="sm" class="flex-1 rounded-full text-xs font-semibold" @click="acceptInvite">
        Accept
      </UiButton>
      <UiButton size="sm" variant="outline" class="flex-1 rounded-full text-xs font-semibold">
        Decline
      </UiButton>
    </div>
    <div v-else-if="isOwnInvite" class="mt-2 flex items-center justify-center py-1 bg-primary/5 rounded-full border border-primary/10">
      <span class="text-[10px] font-medium text-primary">Waiting for opponent...</span>
    </div>
  </div>
</template>
