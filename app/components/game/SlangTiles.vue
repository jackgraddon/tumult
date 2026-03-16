<script setup lang="ts">
import { SLANG_TILES, BOARD_MULTIPLIERS, MultiplierType, validatePlacement, calculateScore, shuffle } from '~/utils/slangtiles';
import { toast } from 'vue-sonner';

const props = defineProps<{
  gameId: string;
  roomId: string;
}>();

const store = useMatrixStore();
const { sendGameAction, getGameState, updateGameState } = useMatrixGame(props.roomId);

// Re-evaluate whenever gameTrigger changes in store
const state = computed(() => {
  store.gameTrigger;
  const s = getGameState(props.gameId);
  if (!s) {
    // Attempt find if get failed (handles cold load)
    const { findGameState } = useMatrixGame(props.roomId);
    findGameState(props.gameId);
  }
  return s;
});

const myUserId = store.client?.getUserId();
const players = computed(() => state.value?.players || {});
const board = computed(() => state.value?.board || Array(15).fill(null).map(() => Array(15).fill(null)));
const scores = computed(() => state.value?.scores || {});
const racks = computed(() => state.value?.racks || {});
const bag = computed(() => state.value?.bag || []);
const currentTurn = computed(() => state.value?.current_turn);
const status = computed(() => state.value?.status || 'active');
const lastMove = computed(() => state.value?.last_move);

const isMyTurn = computed(() => currentTurn.value === myUserId && status.value === 'active');
const myRack = computed(() => (myUserId ? racks.value[myUserId] || [] : []));

// Local state for pending move
const placedTiles = ref<{ r: number; c: number; letter: string; isBlank: boolean; assigned?: string; rackIndex: number }[]>([]);
const selectedRackIndex = ref<number | null>(null);

const isZoomed = ref(false);
const showBlankModal = ref(false);
const showSwapModal = ref(false);
const swapSelection = ref<number[]>([]); // indices in myRack
const pendingBlankTile = ref<{ r: number; c: number; rackIndex: number } | null>(null);

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function getMultiplierClass(m: MultiplierType) {
  switch (m) {
    case 'TW': return 'bg-orange-500 text-white';
    case 'DW': return 'bg-pink-400 text-white';
    case 'TL': return 'bg-blue-600 text-white';
    case 'DL': return 'bg-blue-200 text-blue-800';
    default: return 'bg-stone-200 dark:bg-stone-800';
  }
}

function getMultiplierLabel(m: MultiplierType) {
  switch (m) {
    case 'TW': return 'TW';
    case 'DW': return 'DW';
    case 'TL': return 'TL';
    case 'DL': return 'DL';
    default: return '';
  }
}

function getTileAt(r: number, c: number) {
  // Check board
  if (board.value[r][c]) return board.value[r][c];
  // Check placed tiles
  return placedTiles.value.find(p => p.r === r && p.c === c);
}

function handleSquareClick(r: number, c: number) {
  if (!isMyTurn.value) return;

  const existing = getTileAt(r, c);
  if (existing) {
    // If it's a placed tile, remove it and put back in rack
    const placedIndex = placedTiles.value.findIndex(p => p.r === r && p.c === c);
    if (placedIndex !== -1) {
      const removed = placedTiles.value.splice(placedIndex, 1)[0];
      if (removed.isBlank) {
        // Re-open blank modal if they want to change it? 
        // Or just let them place it again.
      }
    }
    return;
  }

  if (selectedRackIndex.value !== null) {
    const rackIdx = selectedRackIndex.value;
    const letter = myRack.value[rackIdx];
    
    if (placedTiles.value.some(p => p.rackIndex === rackIdx)) {
      selectedRackIndex.value = null;
      return;
    }

    if (letter === ' ') {
      pendingBlankTile.value = { r, c, rackIndex: rackIdx };
      showBlankModal.value = true;
    } else {
      placedTiles.value.push({ r, c, letter, isBlank: false, rackIndex: rackIdx });
    }
    selectedRackIndex.value = null;
  }
}

function assignBlank(letter: string) {
  if (pendingBlankTile.value) {
    placedTiles.value.push({ 
      ...pendingBlankTile.value, 
      letter: ' ', 
      isBlank: true, 
      assigned: letter 
    });
    pendingBlankTile.value = null;
    showBlankModal.value = false;
  }
}

// We need a local rack that maintains original indices to avoid selection bugs
const rackWithIndices = computed(() => {
  return myRack.value.map((letter, index) => ({
    letter,
    index,
    isPlaced: placedTiles.value.some(p => p.rackIndex === index)
  }));
});

function handleRackClick(index: number) {
  if (!isMyTurn.value) return;
  selectedRackIndex.value = selectedRackIndex.value === index ? null : index;
}

const currentMoveScoreResult = computed(() => calculateScore(placedTiles.value, board.value));

async function playMove() {
  if (placedTiles.value.length === 0) return;

  const validation = validatePlacement(placedTiles.value, board.value);
  if (!validation.valid) {
    toast.error(validation.error || 'Invalid placement');
    return;
  }

  const moveScore = currentMoveScoreResult.value.total;
  const formedWords = currentMoveScoreResult.value.words;

  // Capture previous state for revert if challenged
  const prevState = {
    board: JSON.parse(JSON.stringify(board.value)),
    racks: JSON.parse(JSON.stringify(racks.value)),
    scores: JSON.parse(JSON.stringify(scores.value)),
    bag: [...bag.value],
    current_turn: currentTurn.value
  };

  // Update state
  const newBoard = JSON.parse(JSON.stringify(board.value));
  placedTiles.value.forEach(p => {
    newBoard[p.r][p.c] = { letter: p.letter, assigned: p.assigned, isBlank: p.isBlank, player: myUserId };
  });

  const newRacks = { ...racks.value };
  const rackIndicesToKeep = rackWithIndices.value
    .filter(item => !item.isPlaced)
    .map(item => item.index);
  
  newRacks[myUserId!] = rackIndicesToKeep.map(idx => myRack.value[idx]);
  
  // Draw new tiles
  const newBag = [...bag.value];
  while (newRacks[myUserId!].length < 7 && newBag.length > 0) {
    newRacks[myUserId!].push(newBag.pop()!);
  }

  const newScores = { ...scores.value };
  newScores[myUserId!] = (newScores[myUserId!] || 0) + moveScore;

  const opponentId = Object.keys(players.value).find(id => id !== myUserId);

  let newStatus = 'active';
  if (newBag.length === 0 && newRacks[myUserId!].length === 0) {
    newStatus = 'won';
    const opponentRack = newRacks[opponentId!];
    const opponentPenalty = opponentRack.reduce((sum: number, l: string) => sum + (SLANG_TILES[l]?.value || 0), 0);
    newScores[myUserId!] += opponentPenalty;
    newScores[opponentId!] -= opponentPenalty;
  }

  const moveData = {
    ...state.value,
    board: newBoard,
    racks: newRacks,
    bag: newBag,
    scores: newScores,
    current_turn: opponentId,
    status: newStatus,
    last_move: {
      type: 'play',
      player: myUserId,
      score: moveScore,
      words: formedWords.map(w => w.word),
      timestamp: Date.now(),
      prevState
    }
  };

  await updateGameState(props.gameId, moveData);

  await sendGameAction(props.gameId, {
    action: 'play',
    score: moveScore,
    player: myUserId,
    words: formedWords.map(w => w.word)
  });

  // If game is won, send game over event
  if (newStatus === 'won') {
    await store.client?.sendEvent(props.roomId, 'cc.jackg.ruby.game.over', {
      game_id: props.gameId,
      status: 'won',
      winner: myUserId,
      game_type: 'slangtiles',
      scores: newScores
    });
  }

  placedTiles.value = [];
}

async function passTurn() {
  if (!isMyTurn.value) return;
  const opponentId = Object.keys(players.value).find(id => id !== myUserId);
  
  await updateGameState(props.gameId, {
    ...state.value,
    current_turn: opponentId,
    last_move: { type: 'pass', player: myUserId, timestamp: Date.now() }
  });

  await sendGameAction(props.gameId, { action: 'pass', player: myUserId });
}

async function swapTiles() {
  if (!isMyTurn.value || swapSelection.value.length === 0) return;
  
  const newRack = [...myRack.value];
  const newBag = [...bag.value];
  const indices = [...swapSelection.value].sort((a, b) => b - a); // Sort descending to splice without shifting indices

  for (const idx of indices) {
    const char = newRack.splice(idx, 1)[0];
    newBag.push(char);
  }

  const shuffledBag = shuffle(newBag);
  while (newRack.length < 7 && shuffledBag.length > 0) {
    newRack.push(shuffledBag.pop()!);
  }

  const newRacks = { ...racks.value };
  newRacks[myUserId!] = newRack;

  const opponentId = Object.keys(players.value).find(id => id !== myUserId);

  await updateGameState(props.gameId, {
    ...state.value,
    racks: newRacks,
    bag: shuffledBag,
    current_turn: opponentId,
    last_move: { type: 'swap', player: myUserId, count: swapSelection.value.length, timestamp: Date.now() }
  });

  await sendGameAction(props.gameId, { action: 'swap', player: myUserId, count: swapSelection.value.length });
  
  swapSelection.value = [];
  showSwapModal.value = false;
}

function toggleSwapSelection(index: number) {
  const i = swapSelection.value.indexOf(index);
  if (i === -1) swapSelection.value.push(index);
  else swapSelection.value.splice(i, 1);
}

function clearPlaced() {
  placedTiles.value = [];
}

function lookupWord() {
  const word = prompt('Enter word to lookup:');
  if (word) {
    window.open(`https://www.google.com/search?q=define+${word}`, '_blank');
  }
}

async function challengeMove() {
  if (!lastMove.value || lastMove.value.type !== 'play') return;
  
  await updateGameState(props.gameId, {
    ...state.value,
    status: 'challenged',
    challenger_id: myUserId,
    challenge_votes: { valid: [], invalid: [] }
  });

  await sendGameAction(props.gameId, {
    action: 'challenge',
    player: myUserId,
    target_move: lastMove.value
  });
  toast.success('Move challenged! Discussion poll started.');
}

async function voteChallenge(vote: 'valid' | 'invalid') {
  if (status.value !== 'challenged') return;
  
  const votes = { ...state.value.challenge_votes };
  const userId = myUserId!;

  // Remove existing vote if any
  votes.valid = votes.valid.filter((id: string) => id !== userId);
  votes.invalid = votes.invalid.filter((id: string) => id !== userId);

  votes[vote].push(userId);

  await updateGameState(props.gameId, {
    ...state.value,
    challenge_votes: votes
  });
}

async function resolveChallenge(accepted: boolean) {
  if (status.value !== 'challenged') return;

  if (accepted) {
    // Keep move, return to active. 
    // current_turn is already the challenger (the opponent of the person who played), 
    // so it becomes the challenger's turn now.
    await updateGameState(props.gameId, {
      ...state.value,
      status: 'active',
      challenger_id: undefined,
      challenge_votes: undefined
    });
    await sendGameAction(props.gameId, { action: 'resolve_challenge', result: 'accepted', player: myUserId });
  } else {
    // Reject move, revert to previous state.
    const prevState = lastMove.value?.prevState;
    if (!prevState) {
      toast.error('Cannot revert: Previous state missing');
      return;
    }

    // When a move is rejected, the turn returns to the person who made the illegal move
    // so they can try again or pass.
    await updateGameState(props.gameId, {
      ...state.value,
      status: 'active',
      board: prevState.board,
      racks: prevState.racks,
      scores: prevState.scores,
      bag: prevState.bag,
      current_turn: prevState.current_turn, 
      challenger_id: undefined,
      challenge_votes: undefined,
    last_move: { 
      type: 'revert', 
      player: myUserId, 
      timestamp: Date.now(),
      words: lastMove.value?.words // Keep track of what was reverted for the action bubble
    }
    });
    await sendGameAction(props.gameId, { action: 'resolve_challenge', result: 'rejected', player: myUserId });
  }
}

const opponentName = computed(() => {
  const id = Object.keys(players.value).find(pid => pid !== myUserId);
  return id ? (store.client?.getUser(id)?.displayName || id) : 'Opponent';
});

const myScore = computed(() => (myUserId ? scores.value[myUserId] || 0 : 0));
const opponentScore = computed(() => {
  const id = Object.keys(players.value).find(pid => pid !== myUserId);
  return id ? scores.value[id] || 0 : 0;
});

</script>

<template>
  <div class="flex flex-col items-center gap-4 p-4 bg-muted/20 rounded-xl border border-border w-full max-w-full overflow-hidden">
    <!-- Header -->
    <div class="w-full flex items-center justify-between px-2">
      <div class="text-sm font-semibold flex items-center gap-2">
        <Icon name="solar:gamepad-bold" class="h-5 w-5 text-primary" />
        Slanguage Tiles
      </div>
      <div class="flex items-center gap-3 text-xs font-medium">
        <div class="flex flex-col items-end">
          <span class="text-muted-foreground">{{ opponentName }}</span>
          <span class="text-lg">{{ opponentScore }}</span>
        </div>
        <div class="h-8 w-px bg-border" />
        <div class="flex flex-col items-start">
          <span class="text-primary">You</span>
          <span class="text-lg">{{ myScore }}</span>
        </div>
      </div>
    </div>

    <!-- Board -->
    <div v-if="status !== 'challenged'" class="relative group">
      <div 
        class="grid grid-cols-15 grid-rows-15 gap-px bg-stone-400 dark:bg-stone-700 border border-stone-400 dark:border-stone-700 p-px shadow-xl"
        style="width: min(80vw, 400px); aspect-ratio: 1/1;"
      >
        <template v-for="r in 15" :key="r">
          <div
            v-for="c in 15"
            :key="c"
            @click="handleSquareClick(r-1, c-1)"
            class="relative flex items-center justify-center cursor-pointer transition-colors overflow-hidden text-[8px] sm:text-[10px]"
            :class="[
              getMultiplierClass(BOARD_MULTIPLIERS[r-1][c-1]),
              (r-1 === 7 && c-1 === 7 && !getTileAt(r-1, c-1)) ? 'bg-stone-300 dark:bg-stone-600' : ''
            ]"
          >
            <!-- Multiplier Label -->
            <span v-if="!getTileAt(r-1, c-1)" class="opacity-50 font-bold select-none">
              {{ r-1 === 7 && c-1 === 7 ? '★' : getMultiplierLabel(BOARD_MULTIPLIERS[r-1][c-1]) }}
            </span>

            <!-- Tile -->
            <div
              v-if="getTileAt(r-1, c-1)"
              class="absolute inset-[1px] rounded-[1px] bg-[#f5deb3] text-stone-900 flex items-center justify-center font-bold shadow-sm"
              :class="placedTiles.find(p => p.r === r-1 && p.c === c-1) ? 'ring-1 ring-primary ring-inset opacity-90' : ''"
            >
              <span class="text-[10px] sm:text-sm uppercase">{{ getTileAt(r-1, c-1).isBlank ? getTileAt(r-1, c-1).assigned : getTileAt(r-1, c-1).letter }}</span>
              <span v-if="!getTileAt(r-1, c-1).isBlank" class="absolute bottom-0 right-0.5 text-[5px] sm:text-[7px] leading-none mb-0.5">
                {{ SLANG_TILES[getTileAt(r-1, c-1).letter]?.value }}
              </span>
            </div>
          </div>
        </template>
      </div>

      <!-- Zoom Button Overlay -->
      <button 
        @click="isZoomed = true"
        class="absolute top-2 right-2 p-1.5 bg-background/80 backdrop-blur-sm rounded-lg border border-border shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Icon name="solar:magnifer-zoom-in-bold" class="h-4 w-4" />
      </button>
    </div>

    <!-- Bag & Rack Info -->
    <div v-if="status !== 'challenged'" class="w-full flex items-center justify-between px-1 text-[10px] text-muted-foreground uppercase tracking-widest font-bold">
      <span>Tiles in bag: {{ bag.length }}</span>
      <span v-if="status === 'active'">{{ isMyTurn ? 'Your Turn' : "Opponent's Turn" }}</span>
      <span v-else class="text-primary">{{ status }}</span>
    </div>

    <!-- Challenge Poll UI -->
    <div v-if="status === 'challenged'" class="w-full flex flex-col items-center gap-6 py-8 px-4 bg-background/50 rounded-2xl border-2 border-primary/20 animate-in fade-in zoom-in duration-300">
      <div class="flex flex-col items-center gap-2 text-center">
        <Icon name="solar:danger-bold" class="h-12 w-12 text-primary animate-pulse" />
        <h3 class="text-xl font-bold">Move Challenged!</h3>
        <p class="text-sm text-muted-foreground max-w-[280px]">
          <span class="font-bold text-foreground">{{ opponentName }}</span> is challenging the words:
          <span class="block mt-1 p-2 bg-muted rounded-lg font-mono text-primary select-all">
            {{ lastMove?.words?.filter(w => w !== 'BINGO!')?.join(', ') }}
          </span>
        </p>
      </div>

      <div class="w-full flex flex-col gap-3">
        <div class="flex items-center gap-4">
          <UiButton 
            class="flex-1 h-12 rounded-xl text-sm font-bold gap-2"
            :variant="state.challenge_votes?.valid?.includes(myUserId) ? 'default' : 'outline'"
            @click="voteChallenge('valid')"
          >
            <Icon name="solar:check-circle-bold" class="h-5 w-5" />
            Valid ({{ state.challenge_votes?.valid?.length || 0 }})
          </UiButton>
          <UiButton 
            class="flex-1 h-12 rounded-xl text-sm font-bold gap-2"
            :variant="state.challenge_votes?.invalid?.includes(myUserId) ? 'destructive' : 'outline'"
            @click="voteChallenge('invalid')"
          >
            <Icon name="solar:close-circle-bold" class="h-5 w-5" />
            Invalid ({{ state.challenge_votes?.invalid?.length || 0 }})
          </UiButton>
        </div>
        <p class="text-[10px] text-center text-muted-foreground italic">Anyone in the room can vote!</p>
      </div>

      <div class="w-full h-px bg-border" />

      <div v-if="state.challenger_id === myUserId" class="flex flex-col gap-3 w-full">
        <span class="text-[10px] font-bold uppercase tracking-widest text-muted-foreground text-center">Final Resolution</span>
        <div class="flex gap-2">
          <UiButton 
            variant="ghost" 
            size="sm" 
            class="flex-1 text-xs font-semibold rounded-full hover:bg-green-500/10 hover:text-green-600"
            @click="resolveChallenge(true)"
          >
            Accept Word
          </UiButton>
          <UiButton 
            variant="ghost" 
            size="sm" 
            class="flex-1 text-xs font-semibold rounded-full hover:bg-red-500/10 hover:text-red-500"
            @click="resolveChallenge(false)"
          >
            Reject Move
          </UiButton>
        </div>
      </div>
      <div v-else class="flex flex-col gap-1 w-full text-center">
        <span class="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Waiting for Challenger</span>
        <p class="text-[10px] text-muted-foreground">Only the person who challenged can finalize the result.</p>
      </div>
    </div>

    <!-- Rack -->
    <div v-if="status === 'active'" class="flex flex-wrap justify-center gap-1.5 min-h-[40px] w-full max-w-[400px]">
      <template v-for="item in rackWithIndices" :key="item.index">
        <div
          v-if="!item.isPlaced"
          @click="handleRackClick(item.index)"
          class="h-10 w-8 sm:h-12 sm:w-10 rounded-md bg-[#f5deb3] text-stone-900 flex items-center justify-center font-bold shadow transition-transform cursor-pointer relative"
          :class="selectedRackIndex === item.index ? '-translate-y-2 ring-2 ring-primary' : 'hover:-translate-y-1'"
        >
          <span class="text-base sm:text-lg uppercase">{{ item.letter === ' ' ? '' : item.letter }}</span>
          <span v-if="item.letter !== ' '" class="absolute bottom-1 right-1 text-[8px] sm:text-[10px] leading-none">
          {{ SLANG_TILES[item.letter]?.value }}
          </span>
        </div>
      </template>
    </div>

    <!-- Actions -->
    <div v-if="isMyTurn" class="flex flex-col gap-2 w-full max-w-[400px] mt-2">
      <div v-if="placedTiles.length > 0" class="flex flex-col gap-1 px-1 mb-1">
        <div class="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <span>Formed Words</span>
          <button @click="clearPlaced" class="text-primary hover:underline">Recall tiles</button>
        </div>
        <div class="flex flex-wrap gap-1">
          <span 
            v-for="w in currentMoveScoreResult.words" 
            :key="w.word"
            class="px-2 py-0.5 bg-primary/10 text-primary rounded-full text-[10px] font-bold"
          >
            {{ w.word }} (+{{ w.score }})
          </span>
        </div>
      </div>

      <div class="flex flex-wrap gap-2 w-full justify-center">
        <UiButton size="sm" @click="playMove" :disabled="placedTiles.length === 0" class="flex-1 min-w-[80px] font-bold">
          Play ({{ currentMoveScoreResult.total }})
        </UiButton>
        <UiButton 
          size="sm" 
          variant="outline" 
          @click="showSwapModal = true" 
          :disabled="placedTiles.length > 0" 
          class="flex-1 min-w-[80px]"
        >
          Swap
        </UiButton>
        <UiButton 
          size="sm" 
          variant="outline" 
          @click="passTurn" 
          :disabled="placedTiles.length > 0" 
          class="flex-1 min-w-[80px]"
        >
          Pass
        </UiButton>
      </div>
    </div>

    <!-- Footer Actions -->
    <div class="flex gap-4 mt-2">
      <button @click="lookupWord" class="text-xs text-muted-foreground hover:text-primary flex items-center gap-1">
        <Icon name="solar:book-linear" class="h-3 w-3" />
        Lookup Word
      </button>
      <button 
        v-if="lastMove && lastMove.type === 'play' && lastMove.player !== myUserId" 
        @click="challengeMove"
        class="text-xs text-red-500 hover:text-red-600 flex items-center gap-1"
      >
        <Icon name="solar:danger-bold" class="h-3 w-3" />
        Challenge Move
      </button>
    </div>

    <!-- Zoom Dialog -->
    <UiDialog v-model:open="isZoomed">
      <UiDialogContent class="max-w-[95vw] sm:max-w-[700px] max-h-[95vh] flex flex-col items-center p-4">
         <div class="text-lg font-bold mb-4 flex items-center gap-2">
           <Icon name="solar:gamepad-bold" class="h-6 w-6 text-primary" />
           Slanguage Tiles - Large View
         </div>
         
         <!-- Large Board -->
         <div 
          class="grid grid-cols-15 grid-rows-15 gap-px bg-stone-400 dark:bg-stone-700 border-2 border-stone-500 p-0.5 shadow-2xl"
          style="width: 100%; max-width: 600px; aspect-ratio: 1/1;"
        >
          <template v-for="r in 15" :key="r">
            <div
              v-for="c in 15"
              :key="c"
              @click="handleSquareClick(r-1, c-1)"
              class="relative flex items-center justify-center cursor-pointer transition-colors overflow-hidden"
              :class="[
                getMultiplierClass(BOARD_MULTIPLIERS[r-1][c-1]),
                (r-1 === 7 && c-1 === 7 && !getTileAt(r-1, c-1)) ? 'bg-stone-300 dark:bg-stone-600' : ''
              ]"
            >
              <span v-if="!getTileAt(r-1, c-1)" class="text-[8px] sm:text-xs opacity-50 font-black select-none">
                {{ r-1 === 7 && c-1 === 7 ? '★' : getMultiplierLabel(BOARD_MULTIPLIERS[r-1][c-1]) }}
              </span>
              <div
                v-if="getTileAt(r-1, c-1)"
                class="absolute inset-[1px] rounded-[2px] bg-[#f5deb3] text-stone-900 flex items-center justify-center font-bold shadow-md"
                :class="placedTiles.find(p => p.r === r-1 && p.c === c-1) ? 'ring-2 ring-primary ring-inset' : ''"
              >
                <span class="text-sm sm:text-xl uppercase">{{ getTileAt(r-1, c-1).isBlank ? getTileAt(r-1, c-1).assigned : getTileAt(r-1, c-1).letter }}</span>
                <span v-if="!getTileAt(r-1, c-1).isBlank" class="absolute bottom-0 right-0.5 text-[6px] sm:text-[10px] leading-none mb-0.5">
                  {{ SLANG_TILES[getTileAt(r-1, c-1).letter]?.value }}
                </span>
              </div>
            </div>
          </template>
        </div>

        <!-- Rack in Zoom View -->
        <div v-if="status === 'active'" class="mt-6 flex flex-wrap justify-center gap-2 min-h-[40px] w-full max-w-[600px]">
          <template v-for="item in rackWithIndices" :key="item.index">
            <div
              v-if="!item.isPlaced"
              @click="handleRackClick(item.index)"
              class="h-12 w-10 sm:h-14 sm:w-12 rounded-md bg-[#f5deb3] text-stone-900 flex items-center justify-center font-bold shadow-md transition-transform cursor-pointer relative"
              :class="selectedRackIndex === item.index ? '-translate-y-2 ring-4 ring-primary' : 'hover:-translate-y-1'"
            >
              <span class="text-lg sm:text-xl uppercase">{{ item.letter === ' ' ? '' : item.letter }}</span>
              <span v-if="item.letter !== ' '" class="absolute bottom-1 right-1 text-[10px] leading-none">
              {{ SLANG_TILES[item.letter]?.value }}
              </span>
            </div>
          </template>
        </div>

        <div class="mt-4 text-xs sm:text-sm text-muted-foreground text-center">
          Click squares to place or remove tiles. Close to use actions like Play or Swap.
        </div>
      </UiDialogContent>
    </UiDialog>

    <!-- Blank Tile Modal -->
    <UiDialog v-model:open="showBlankModal">
      <UiDialogContent class="max-w-[90vw] sm:max-w-md p-6">
        <UiDialogHeader>
          <UiDialogTitle>Select Letter for Blank Tile</UiDialogTitle>
        </UiDialogHeader>
        <div class="grid grid-cols-6 gap-2 mt-4">
          <UiButton 
            v-for="l in ALPHABET" 
            :key="l" 
            size="sm" 
            variant="outline" 
            @click="assignBlank(l)"
            class="font-bold text-lg h-10 w-10 p-0"
          >
            {{ l }}
          </UiButton>
        </div>
      </UiDialogContent>
    </UiDialog>

    <!-- Swap Modal -->
    <UiDialog v-model:open="showSwapModal">
      <UiDialogContent class="max-w-[90vw] sm:max-w-md p-6">
        <UiDialogHeader>
          <UiDialogTitle>Swap Tiles</UiDialogTitle>
          <UiDialogDescription>Select the tiles you want to return to the bag.</UiDialogDescription>
        </UiDialogHeader>
        
        <div class="flex flex-wrap justify-center gap-2 my-6">
          <div
            v-for="(letter, idx) in myRack"
            :key="idx"
            @click="toggleSwapSelection(idx)"
            class="h-12 w-10 rounded-md bg-[#f5deb3] text-stone-900 flex items-center justify-center font-bold shadow-md cursor-pointer transition-all border-2"
            :class="swapSelection.includes(idx) ? 'border-primary ring-2 ring-primary/20 -translate-y-1' : 'border-transparent opacity-60'"
          >
            <span class="text-xl uppercase">{{ letter === ' ' ? '' : letter }}</span>
          </div>
        </div>

        <div class="flex gap-3">
          <UiButton variant="outline" class="flex-1" @click="showSwapModal = false">Cancel</UiButton>
          <UiButton 
            class="flex-1 font-bold" 
            :disabled="swapSelection.length === 0" 
            @click="swapTiles"
          >
            Swap {{ swapSelection.length }} Tiles
          </UiButton>
        </div>
      </UiDialogContent>
    </UiDialog>
  </div>
</template>

<style scoped>
.grid-cols-15 { grid-template-columns: repeat(15, minmax(0, 1fr)); }
.grid-rows-15 { grid-template-rows: repeat(15, minmax(0, 1fr)); }
</style>
