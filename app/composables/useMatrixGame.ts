import { EventType, MatrixEvent, Direction } from 'matrix-js-sdk'
import type { TimelineEvents } from 'matrix-js-sdk'
import { useMatrixStore } from '~/stores/matrix'
import { useActivityStore } from '~/stores/activity'

// Custom game event type strings not present in the SDK's TimelineEvents map.
// We cast them once here so every sendEvent call stays clean.
const GameEventType = {
  State: 'cc.jackg.ruby.game.state' as unknown as keyof TimelineEvents,
  Action: 'cc.jackg.ruby.game.action' as unknown as keyof TimelineEvents,
} as const

export function useMatrixGame(roomId: string) {
  const store = useMatrixStore()
  const activityStore = useActivityStore()
  const matrixClient = store.client

  // Send a game invite into the timeline
  async function inviteToGame(gameType: string, opponentId: string | null) {
    if (!matrixClient) return
    const gameId = `game_${crypto.randomUUID()}`
    await matrixClient.sendEvent(roomId, EventType.RoomMessage, {
      msgtype: 'cc.jackg.ruby.game.invite',
      body: `Game invite: ${gameType}`,
      game_type: gameType,
      game_id: gameId,
      invited_user: opponentId,
    } as any)
    return gameId
  }

  // Persist board state as a Matrix timeline event (using timeline instead of state to avoid 403s)
  async function updateGameState(gameId: string, stateContent: object) {
    if (!matrixClient) return
    await matrixClient.sendEvent(roomId, GameEventType.State, {
      game_id: gameId,
      ...stateContent,
    } as any)
  }

  // Send an action (move, forfeit, etc.) to the timeline
  async function sendGameAction(gameId: string, action: object) {
    if (!matrixClient) return
    await matrixClient.sendEvent(roomId, GameEventType.Action, {
      game_id: gameId,
      ...action,
    } as any)
  }

  // Read current game state (Scan timeline for the latest state event)
  function getGameState(gameId: string) {
    if (activityStore.gameStates[gameId]) return activityStore.gameStates[gameId]
    if (!matrixClient) return null
    const room = matrixClient.getRoom(roomId)
    if (!room) return null

    // Fallback: Search all available timeline sets for the latest state event
    const timelineSets = [room.getUnfilteredTimelineSet()]
    for (const set of timelineSets) {
      const events = set.getLiveTimeline().getEvents()
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i]
        const isEncrypted = ev?.getType() === 'm.room.encrypted'
        const content = isEncrypted ? ev.getClearContent() : ev?.getContent()
        const type = isEncrypted ? content?.type : ev?.getType()

        if (type === 'cc.jackg.ruby.game.state' && content?.game_id === gameId) {
          activityStore.updateGameState(gameId, content)
          return content
        }
      }
    }

    return null
  }

  // Deep search for game state in room history (paginated API call)
  async function findGameState(gameId: string) {
    if (activityStore.gameStates[gameId]) return activityStore.gameStates[gameId]
    if (!matrixClient) return null

    // 1. Try local timeline scan first
    const state = getGameState(gameId)
    if (state) return state

    // 2. Search room history via API
    try {
      // Filter for both state events and encrypted events (which might be states)
      const filter = { types: ['cc.jackg.ruby.game.state', 'm.room.encrypted'] }
      let from: string | undefined = undefined

      // Search up to 10 pages of 50 events
      for (let i = 0; i < 10; i++) {
        const response: any = await matrixClient.createMessagesRequest(roomId, from, 50, Direction.Backward, filter)
        if (!response.chunk?.length) break

        for (const eventData of response.chunk) {
          const event = new MatrixEvent(eventData)
          
          if (event.getType() === 'm.room.encrypted' && matrixClient.getCrypto()) {
            await matrixClient.decryptEventIfNeeded(event)
          }

          const content = event.isEncrypted() ? event.getClearContent() : event.getContent()
          const type = event.isEncrypted() ? content?.type : event.getType()

          if (type === 'cc.jackg.ruby.game.state' && content?.game_id === gameId) {
            console.log(`[GameGame] Found state for ${gameId} in history`)
            activityStore.updateGameState(gameId, content)
            return content
          }
        }
        
        if (!response.end) break
        from = response.end
      }
    } catch (e) {
      console.warn(`[GameGame] Failed to deep-search for game state ${gameId}:`, e)
    }

    return null
  }

  return { inviteToGame, updateGameState, sendGameAction, getGameState, findGameState }
}