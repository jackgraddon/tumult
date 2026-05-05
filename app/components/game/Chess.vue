<script setup lang="ts">
import { Chess as ChessLogic } from 'chess.js';

const props = defineProps<{
  gameId: string;
  roomId: string;
}>();

const store = useMatrixStore();
const activityStore = useActivityStore();
const uiStore = useUIStore();
const matrixService = useMatrixService();
const { sendGameAction, getGameState, updateGameState } = useMatrixGame(props.roomId);

// Re-evaluate whenever gameTrigger changes in store
const state = computed(() => {
  activityStore.gameTrigger;
  return getGameState(props.gameId);
});

const myUserId = store.client?.getUserId();
const players = computed(() => state.value?.players || {});
const fen = computed(() => state.value?.board || 'start');
const status = computed(() => state.value?.status || 'active');

const chess = computed(() => {
  const instance = new ChessLogic();
  try {
    instance.load(fen.value === 'start' ? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' : fen.value);
  } catch (e) {
    instance.reset();
  }
  return instance;
});

const board = computed(() => chess.value.board());

const currentTurnColor = computed(() => chess.value.turn());
const myColor = computed(() => {
  if (players.value.white === myUserId) return 'w';
  if (players.value.black === myUserId) return 'b';
  return null;
});

const isMyTurn = computed(() => 
  status.value === 'active' && 
  myColor.value === currentTurnColor.value
);

const selectedSquare = ref<string | null>(null);

function getSquareName(i: number, j: number): string {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
  return files[j] + ranks[i];
}

async function handleSquareClick(i: number, j: number) {
  if (!isMyTurn.value) return;

  const square = getSquareName(i, j);
  const chessInstance = chess.value;

  if (selectedSquare.value) {
    if (selectedSquare.value === square) {
      selectedSquare.value = null;
      return;
    }

    // Attempt move
    try {
      const move = chessInstance.move({
        from: selectedSquare.value,
        to: square,
        promotion: 'q' // Always promote to queen for simplicity
      });

      if (move) {
        await sendGameAction(props.gameId, { 
          action: 'move', 
          move: move.san, 
          piece: move.piece,
          from: move.from,
          to: move.to,
          player: myUserId 
        });
        
        let newStatus = 'active';
        if (chessInstance.isCheckmate()) newStatus = 'won';
        else if (chessInstance.isDraw()) newStatus = 'draw';

        await updateGameState(props.gameId, {
          ...state.value,
          board: chessInstance.fen(),
          status: newStatus,
          winner: newStatus === 'won' ? myUserId : null
        });

        if (newStatus !== 'active') {
          await store.client?.sendEvent(props.roomId, 'cc.jackg.ruby.game.over' as any, {
            game_id: props.gameId,
            status: newStatus,
            winner: newStatus === 'won' ? myUserId : null,
            game_type: 'chess'
          });
        }
      }
      selectedSquare.value = null;
    } catch (e) {
      // Invalid move, just select the new square if it's our piece
      const piece = chessInstance.get(square as any);
      if (piece && piece.color === myColor.value) {
        selectedSquare.value = square;
      } else {
        selectedSquare.value = null;
      }
    }
  } else {
    const piece = chessInstance.get(square as any);
    if (piece && piece.color === myColor.value) {
      selectedSquare.value = square;
    }
  }
}

function getPieceIcon(type: string, color: string): string {
  const icons: Record<string, string> = {
    p: 'tabler:chess-filled',
    r: 'tabler:chess-rook-filled',
    n: 'tabler:chess-knight-filled',
    b: 'tabler:chess-bishop-filled',
    q: 'tabler:chess-queen-filled',
    k: 'tabler:chess-king-filled'
  };
  return icons[type] || '';
}
</script>

<template>
  <div class="flex flex-col items-center gap-4 p-4 rounded-xl border border-border">
    <div class="text-sm text-primary font-semibold flex items-center gap-2">
      <Icon name="solar:gamepad-bold" />
      Chess
    </div>

    <div class="grid grid-cols-8 border-2 border-border">
      <template v-for="(row, i) in board" :key="i">
        <div
          v-for="(cell, j) in row"
          :key="j"
          class="h-10 w-10 flex items-center justify-center cursor-pointer transition-colors relative"
          :class="[
            (i + j) % 2 === 0 ? 'bg-primary/35' : 'bg-primary/55',
            selectedSquare === getSquareName(i, j) ? 'ring-2 ring-primary ring-inset z-10' : ''
          ]"
          @click="handleSquareClick(i, j)"
        >
          <Icon 
            v-if="cell" 
            :name="getPieceIcon(cell.type, cell.color)" 
            class="h-8 w-8"
            :class="cell.color === 'w' ? 'text-white drop-shadow-[0_0_2px_rgba(0,0,0,0.8)]' : 'text-black'"
          />
          <div v-if="chess.inCheck() && cell?.type === 'k' && cell.color === currentTurnColor" class="absolute inset-0 bg-red-500/40 animate-pulse" />
        </div>
      </template>
    </div>

    <div class="text-xs text-muted-foreground text-center">
      <template v-if="status === 'active'">
        <span v-if="isMyTurn" class="text-primary font-bold">Your turn! {{ chess.inCheck() ? '(Check)' : '' }}</span>
        <span v-else>Waiting for opponent... {{ chess.inCheck() ? '(Check)' : '' }}</span>
      </template>
      <template v-else-if="status === 'won'">
        <span class="text-green-500 font-bold">{{ state.winner === myUserId ? 'You won by Checkmate!' : 'You lost by Checkmate!' }}</span>
      </template>
      <template v-else-if="status === 'draw'">
        <span class="font-bold">It's a draw!</span>
      </template>
    </div>
  </div>
</template>
