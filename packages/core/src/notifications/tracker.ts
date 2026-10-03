import { ClientEvent, RoomEvent, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";

import type { NotificationPermission, NotificationState } from "../contract.ts";
import { Observable } from "../observable.ts";

/**
 * Fires browser notifications for new messages when the window is blurred.
 *
 * Listens to `RoomEvent.Timeline` on every joined room, tracks seen event
 * IDs to avoid duplicates, and calls `new Notification(...)` when a new
 * message arrives from another user while the window is unfocused.
 *
 * Permission state is tracked and published through an Observable so the
 * UI can prompt the user to grant permission. The actual notification
 * firing is best-effort: a denied or unsupported Notification API is
 * silently skipped.
 */
export class NotificationTracker {
    private readonly matrix: MatrixClient;
    private readonly state: Observable<NotificationState>;
    private readonly seen = new Set<string>();
    private windowFocused = true;
    private detachFns: (() => void)[] = [];
    private roomDetachFns = new Map<string, () => void>();

    private readonly onSync: () => void;

    // No parameter properties: Node's type-stripping only supports erasable syntax.
    public constructor(matrix: MatrixClient) {
        this.matrix = matrix;
        this.state = new Observable<NotificationState>({
            permission: this.getPermission(),
            supported: this.isSupported(),
        });
        this.setupWindowListeners();
        this.attachAll();
        // Rooms enter the store on sync batches — attach to any we missed
        // at construction time (the room list is empty before the first sync).
        this.onSync = () => this.attachAll();
        this.matrix.on(ClientEvent.Sync, this.onSync);
        // Ask for permission as soon as the tracker exists if it has never
        // been asked before. Browsers may defer to the first user gesture,
        // but we should not wait for the UI to make the call.
        if (this.state.get().permission === "default") {
            void this.requestPermission().catch(() => undefined);
        }
    }

    public get snapshot(): NotificationState {
        return this.state.get();
    }

    public subscribe(listener: (value: NotificationState) => void): { unsubscribe: () => void } {
        return this.state.subscribe(listener);
    }

    public async requestPermission(): Promise<NotificationPermission> {
        if (!this.isSupported()) return "denied";
        const permission = await Notification.requestPermission();
        this.state.set({ permission, supported: true });
        return permission;
    }

    public detachAll(): void {
        this.matrix.removeListener(ClientEvent.Sync, this.onSync);
        for (const fn of this.detachFns) fn();
        this.detachFns = [];
        for (const fn of this.roomDetachFns.values()) fn();
        this.roomDetachFns.clear();
    }

    private isSupported(): boolean {
        return typeof Notification !== "undefined";
    }

    private getPermission(): NotificationPermission {
        return this.isSupported() ? Notification.permission : "denied";
    }

    private setupWindowListeners(): void {
        if (typeof window === "undefined") return;
        const onFocus = (): void => {
            this.windowFocused = true;
        };
        const onBlur = (): void => {
            this.windowFocused = false;
        };
        window.addEventListener("focus", onFocus);
        window.addEventListener("blur", onBlur);
        this.detachFns.push(() => {
            window.removeEventListener("focus", onFocus);
            window.removeEventListener("blur", onBlur);
        });
    }

    private attachAll(): void {
        for (const room of this.matrix.getRooms()) {
            this.attach(room);
        }
    }

    private attach(room: Room): void {
        if (this.roomDetachFns.has(room.roomId)) return;
        const handler = (event: MatrixEvent): void => {
            this.onTimelineEvent(room, event);
        };
        room.on(RoomEvent.Timeline, handler);
        this.roomDetachFns.set(room.roomId, () => {
            room.removeListener(RoomEvent.Timeline, handler);
        });
    }

    private onTimelineEvent(room: Room, event: MatrixEvent): void {
        const id = event.getId();
        if (!id || this.seen.has(id)) return;
        this.seen.add(id);
        if (this.windowFocused) return;
        if (this.state.get().permission !== "granted") return;
        if (event.getSender() === this.matrix.getUserId()) return;
        if (event.isRedacted()) return;
        this.notify(room, event);
    }

    private notify(room: Room, event: MatrixEvent): void {
        const content = event.getContent();
        const body = typeof content["body"] === "string" ? content["body"] : "";
        const sender = event.getSender() ?? "Unknown";
        try {
            new Notification(sender, {
                body,
                tag: room.roomId,
            });
        } catch {
            // Notification construction can throw in some environments
            // (e.g. missing permission, unsupported platform). Silently skip.
        }
    }
}
