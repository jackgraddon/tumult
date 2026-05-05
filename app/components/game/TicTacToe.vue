<script setup lang="ts">
const props = defineProps<{
  gameId: string;
  roomId: string;
}>();

const store = useMatrixStore();
const activityStore = useActivityStore();
const uiStore = useUIStore();
const matrixService = useMatrixService();
const presenceStore = usePresenceStore();
const { sendGameAction, getGameState, updateGameState } = useMatrixGame(props.roomId);

// Re-evaluate whenever gameTrigger changes in store
const state = computed(() => {
  activityStore.gameTrigger;
  return getGameState(props.gameId);
});

const myUserId = store.client?.getUserId();

const players = computed(() => state.value?.players || {});
const board = computed(() => state.value?.board || Array(9).fill(null));
const currentTurn = computed(() => state.value?.current_turn);
const status = computed(() => state.value?.status || 'active');

const isMyTurn = computed(() => currentTurn.value === myUserId && status.value === 'active');

const mySymbol = computed(() => {
  if (players.value.X === myUserId) return 'X';
  if (players.value.O === myUserId) return 'O';
  return null;
});

const opponentId = computed(() => {
  if (players.value.X === myUserId) return players.value.O;
  if (players.value.O === myUserId) return players.value.X;
  return null;
});

async function makeMove(index: number) {
  if (!isMyTurn.value || board.value[index] || !mySymbol.value) return;

  // 1. Send action to timeline
  await sendGameAction(props.gameId, { action: 'move', position: index, player: myUserId });

  // 2. Compute new state
  const newBoard = [...board.value];
  newBoard[index] = mySymbol.value;

  const winner = checkWinner(newBoard);
  let newStatus = 'active';
  if (winner) {
    newStatus = 'won';
  } else if (newBoard.every(cell => cell !== null)) {
    newStatus = 'draw';
  }

  await updateGameState(props.gameId, {
    ...state.value,
    board: newBoard,
    current_turn: opponentId.value,
    status: newStatus,
    winner: winner ? myUserId : null
  });

  if (newStatus !== 'active') {
    const matrixClient = store.client;
    if (matrixClient) {
      await matrixClient.sendEvent(props.roomId, 'cc.jackg.ruby.game.over' as any, {
        game_id: props.gameId,
        status: newStatus,
        winner: winner ? myUserId : null,
        game_type: 'tictactoe'
      });
    }
  }
}

function checkWinner(b: (string | null)[]) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
    [0, 4, 8], [2, 4, 6]             // diags
  ];
  for (const [a, b_idx, c] of lines) {
    if (b[a] && b[a] === b[b_idx] && b[a] === b[c]) return b[a];
  }
  return null;
}
</script>

<template>
  <div class="flex flex-col items-center gap-4 p-4 bg-muted/20 rounded-xl border border-border">
    <div class="text-sm font-semibold flex items-center gap-2">
      <Icon name="solar:gamepad-bold" class="h-5 w-5 text-primary" />
      Tic-Tac-Toe
    </div>

    <div class="grid grid-cols-3 gap-2">
      <button
        v-for="(cell, i) in board"
        :key="i"
        :disabled="!isMyTurn || cell !== null"
        class="h-16 w-16 rounded-lg border-2 border-border flex items-center justify-center text-2xl font-bold transition-colors"
        :class="[
          !cell && isMyTurn ? 'hover:bg-primary/10 border-primary/50 cursor-pointer' : 'cursor-default',
          cell === 'X' ? 'text-blue-500' : 'text-red-500'
        ]"
        @click="makeMove(i)"
      >
        {{ cell }}
      </button>
    </div>

    <div class="text-xs text-muted-foreground text-center">
      <template v-if="status === 'active'">
        <span v-if="isMyTurn" class="text-primary font-bold">Your turn!</span>
        <span v-else>Waiting for opponent...</span>
      </template>
      <template v-else-if="status === 'won'">
        <span class="text-green-500 font-bold">{{ state.winner === myUserId ? 'You won!' : 'You lost!' }}</span>
      </template>
      <template v-else-if="status === 'draw'">
        <span class="font-bold">It's a draw!</span>
      </template>
    </div>
  </div>
</template>
