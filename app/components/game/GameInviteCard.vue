<script setup lang="ts">
import type { MatrixEvent } from 'matrix-js-sdk';
import { toast } from 'vue-sonner';
import { ref, computed } from 'vue';
import { createInitialBag } from '~/utils/slangtiles';

const props = defineProps<{
  event: MatrixEvent;
}>();

const store = useMatrixStore();
const activityStore = useActivityStore();
const uiStore = useUIStore();
const matrixService = useMatrixService();
const roomId = props.event.getRoomId()!;
const { updateGameState, sendGameAction, getGameState } = useMatrixGame(roomId);

const content = computed(() => props.event.getContent());
const isMyInvite = computed(() => content.value.invited_user === store.client?.getUserId());
const isOwnInvite = computed(() => props.event.getSender() === store.client?.getUserId());

const isProcessing = ref(false);

const gameState = computed(() => {
  activityStore.gameTrigger; // React to store updates
  return getGameState(content.value.game_id);
});

async function acceptInvite() {
  if (isProcessing.value || (gameState.value && gameState.value.status !== 'pending')) return;

  const gameId = content.value.game_id;
  const gameType = content.value.game_type;
  
  console.log('[GameInvite] Accepting invite', { gameId, gameType });
  isProcessing.value = true;

  let initialBoard: any = null;
  let players: any = {};
  let currentTurn: string | undefined;
  let additionalState: any = {};

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
  } else if (gameType === 'slangtiles') {
    const bag = createInitialBag();
    const p1 = props.event.getSender()!;
    const p2 = store.client?.getUserId()!;
    
    players = { [p1]: 'p1', [p2]: 'p2' };
    
    const racks: Record<string, string[]> = {};
    racks[p1] = bag.splice(-7);
    racks[p2] = bag.splice(-7);
    
    initialBoard = Array(15).fill(null).map(() => Array(15).fill(null));
    currentTurn = p1;
    
    additionalState = {
      bag,
      racks,
      scores: { [p1]: 0, [p2]: 0 }
    };
  }

  try {
    await updateGameState(gameId, {
      game_id: gameId,
      game_type: gameType,
      status: 'active',
      players: players,
      board: initialBoard,
      current_turn: currentTurn,
      started_at: Date.now(),
      ...additionalState
    });

    await sendGameAction(gameId, {
      action: 'accept',
      player: store.client?.getUserId()
    });
    
    console.log('[GameInvite] Invite accepted successfully');
  } catch (err) {
    console.error('[GameInvite] Failed to accept invite', err);
    toast.error('Failed to accept game invite');
  } finally {
    isProcessing.value = false;
  }
}

async function declineInvite() {
  if (isProcessing.value || (gameState.value && gameState.value.status !== 'pending')) return;

  const gameId = content.value.game_id;
  console.log('[GameInvite] Declining invite', { gameId });
  isProcessing.value = true;

  try {
    await updateGameState(gameId, {
      game_id: gameId,
      game_type: content.value.game_type,
      status: 'declined',
      declined_at: Date.now()
    });

    await sendGameAction(gameId, {
      action: 'decline',
      player: store.client?.getUserId()
    });

    console.log('[GameInvite] Invite declined successfully');
  } catch (err) {
    console.error('[GameInvite] Failed to decline invite', err);
    toast.error('Failed to decline game invite');
  } finally {
    isProcessing.value = false;
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

    <div v-if="isMyInvite && (!gameState || gameState.status === 'pending')" class="mt-2 flex gap-2">
      <UiButton 
        size="sm" 
        class="flex-1 rounded-full text-xs font-semibold" 
        :disabled="isProcessing"
        @click="acceptInvite"
      >
        Accept
      </UiButton>
      <UiButton 
        size="sm" 
        variant="outline" 
        class="flex-1 rounded-full text-xs font-semibold"
        :disabled="isProcessing"
        @click="declineInvite"
      >
        Decline
      </UiButton>
    </div>
    <div v-else-if="isOwnInvite && (!gameState || gameState.status === 'pending')" class="mt-2 flex items-center justify-center py-1 bg-primary/5 rounded-full border border-primary/10">
      <span class="text-[10px] font-medium text-primary">Waiting for opponent...</span>
    </div>
    <div v-else-if="gameState" class="mt-2 flex items-center justify-center py-1 bg-muted/50 rounded-full border border-border">
      <span class="text-[10px] font-medium text-muted-foreground italic">
        {{ gameState.status === 'active' ? 'Invite accepted' : gameState.status === 'declined' ? 'Invite declined' : 'Game ' + gameState.status }}
      </span>
    </div>
  </div>
</template>
