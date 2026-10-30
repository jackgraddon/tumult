import { ClientEvent, RoomMemberEvent, type MatrixClient } from "matrix-js-sdk";

import type { TypingState } from "../contract.ts";
import { Observable } from "../observable.ts";

/**
 * Tracks per-room typing state over one `MatrixClient`.
 *
 * Typing events are ephemeral (not persisted by the SDK), so we read
 * `member.typing` from room members and publish a snapshot. Listens for
 * `RoomMember.typing` changes and rebuilds on sync as a backstop.
 */
export class TypingTracker {
    private readonly matrix: MatrixClient;
    private readonly state = new Observable<TypingState>({ rooms: {} });
    private readonly onMemberTyping: () => void;
    private readonly onSync: () => void;

    // No parameter properties: Node's type-stripping only supports erasable syntax.
    public constructor(matrix: MatrixClient) {
        this.matrix = matrix;
        this.onMemberTyping = () => this.rebuildAll();
        this.onSync = () => this.rebuildAll();
        this.matrix.on(RoomMemberEvent.Typing, this.onMemberTyping);
        this.matrix.on(ClientEvent.Sync, this.onSync);
        this.rebuildAll();
    }

    public get snapshot(): TypingState {
        return this.state.get();
    }

    public subscribe(listener: (value: TypingState) => void): { unsubscribe: () => void } {
        return this.state.subscribe(listener);
    }

    public async sendTyping(roomId: string, isTyping: boolean): Promise<void> {
        await this.matrix.sendTyping(roomId, isTyping, 20_000);
        // Optimistic: reflect immediately, then let sync confirm/clear.
        this.rebuildAll();
    }

    public detachAll(): void {
        this.matrix.removeListener(RoomMemberEvent.Typing, this.onMemberTyping);
        this.matrix.removeListener(ClientEvent.Sync, this.onSync);
    }

    private rebuildAll(): void {
        const selfId = this.matrix.getUserId();
        const rooms: Record<string, string[]> = {};
        for (const room of this.matrix.getRooms()) {
            const typing = room
                .getMembers()
                .filter((member) => member.typing && member.userId !== selfId)
                .map((member) => member.userId)
                .sort();
            if (typing.length > 0) rooms[room.roomId] = typing;
        }
        this.state.set({ rooms });
    }
}
