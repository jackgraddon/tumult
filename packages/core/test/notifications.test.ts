import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";

import { NotificationTracker } from "../src/notifications/tracker.ts";

/** Minimal event stub satisfying the tracker's calls. */
function timelineEvent(over: Record<string, unknown> = {}): MatrixEvent {
    return {
        getId: () => "$evt:localhost",
        getSender: () => "@alice:localhost",
        getContent: () => ({ body: "hello world" }),
        isRedacted: () => false,
        ...over,
    } as unknown as MatrixEvent;
}

interface RoomStub {
    room: Room;
    emit(event: MatrixEvent): void;
    listenerCount(): number;
}

function stubRoom(roomId = "!room:localhost"): RoomStub {
    const listeners = new Set<(event: MatrixEvent) => void>();
    const room = {
        roomId,
        on(_name: string, fn: (event: MatrixEvent) => void) {
            listeners.add(fn);
        },
        removeListener(_name: string, fn: (event: MatrixEvent) => void) {
            listeners.delete(fn);
        },
    } as unknown as Room;
    return {
        room,
        emit(event: MatrixEvent) {
            for (const fn of listeners) fn(event);
        },
        listenerCount: () => listeners.size,
    };
}

function stubMatrix(rooms: Room[], ownUserId = "@me:localhost"): MatrixClient {
    return {
        getRooms: () => rooms,
        getUserId: () => ownUserId,
        on: () => undefined,
        removeListener: () => undefined,
    } as unknown as MatrixClient;
}

type FakePermission = "default" | "denied" | "granted";

/** Collects Notification constructions for assertions. */
class FakeNotification {
    public static permission: FakePermission = "granted";
    public static instances: { title: string; body: string; tag: string | undefined }[] = [];
    public static requested = false;
    public static result: FakePermission = "granted";

    public title: string;
    public options: { body?: string; tag?: string };

    constructor(title: string, options: { body?: string; tag?: string } = {}) {
        FakeNotification.instances.push({ title, body: options.body ?? "", tag: options.tag });
        this.title = title;
        this.options = options;
    }

    static requestPermission(): Promise<FakePermission> {
        FakeNotification.requested = true;
        return Promise.resolve(FakeNotification.result);
    }

    static reset(): void {
        FakeNotification.permission = "granted";
        FakeNotification.instances = [];
        FakeNotification.requested = false;
        FakeNotification.result = "granted";
    }
}

/** Installs Notification + a fireable window stub; returns a handle for the test. */
function installGlobals(): {
    fire(type: "focus" | "blur"): void;
    listenerCount(type: string): number;
    restore(): void;
} {
    const g = globalThis as Record<string, unknown>;
    const prevNotification = g["Notification"];
    const prevWindow = g["window"];
    g["Notification"] = FakeNotification;

    const listeners = new Map<string, Set<() => void>>();
    g["window"] = {
        addEventListener(type: string, fn: () => void) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type)?.add(fn);
        },
        removeEventListener(type: string, fn: () => void) {
            listeners.get(type)?.delete(fn);
        },
    };

    return {
        fire(type) {
            for (const fn of listeners.get(type) ?? []) fn();
        },
        listenerCount(type) {
            return listeners.get(type)?.size ?? 0;
        },
        restore() {
            g["Notification"] = prevNotification;
            g["window"] = prevWindow;
        },
    };
}

describe("NotificationTracker", () => {
    it("reports supported + permission state from the Notification API", () => {
        const env = installGlobals();
        FakeNotification.reset();
        FakeNotification.permission = "default";
        try {
            const tracker = new NotificationTracker(stubMatrix([]));
            assert.deepEqual(tracker.snapshot, { permission: "default", supported: true });
            tracker.detachAll();
        } finally {
            env.restore();
        }
    });

    it("reports unsupported when Notification is missing", () => {
        const g = globalThis as Record<string, unknown>;
        const prev = g["Notification"];
        delete g["Notification"];
        try {
            const tracker = new NotificationTracker(stubMatrix([]));
            assert.deepEqual(tracker.snapshot, { permission: "denied", supported: false });
            tracker.detachAll();
        } finally {
            g["Notification"] = prev;
        }
    });

    it("requestPermission calls the API and updates the snapshot", async () => {
        const env = installGlobals();
        FakeNotification.reset();
        FakeNotification.result = "granted";
        try {
            const tracker = new NotificationTracker(stubMatrix([]));
            assert.equal(FakeNotification.requested, false);
            const result = await tracker.requestPermission();
            assert.equal(result, "granted");
            assert.equal(FakeNotification.requested, true);
            assert.equal(tracker.snapshot.permission, "granted");
            tracker.detachAll();
        } finally {
            env.restore();
        }
    });

    it("requestPermission returns denied when unsupported", async () => {
        const g = globalThis as Record<string, unknown>;
        const prev = g["Notification"];
        delete g["Notification"];
        try {
            const tracker = new NotificationTracker(stubMatrix([]));
            const result = await tracker.requestPermission();
            assert.equal(result, "denied");
            tracker.detachAll();
        } finally {
            g["Notification"] = prev;
        }
    });

    it("fires a notification for a new event from another user while blurred", () => {
        const env = installGlobals();
        FakeNotification.reset();
        FakeNotification.permission = "granted";
        try {
            const rs = stubRoom();
            const tracker = new NotificationTracker(stubMatrix([rs.room]));
            env.fire("blur");
            rs.emit(timelineEvent());
            assert.equal(FakeNotification.instances.length, 1);
            assert.equal(FakeNotification.instances[0]?.title, "@alice:localhost");
            assert.equal(FakeNotification.instances[0]?.body, "hello world");
            assert.equal(FakeNotification.instances[0]?.tag, "!room:localhost");
            tracker.detachAll();
        } finally {
            env.restore();
        }
    });

    it("does not fire when the window is focused", () => {
        const env = installGlobals();
        FakeNotification.reset();
        FakeNotification.permission = "granted";
        try {
            const rs = stubRoom();
            const tracker = new NotificationTracker(stubMatrix([rs.room]));
            rs.emit(timelineEvent());
            assert.equal(FakeNotification.instances.length, 0);
            tracker.detachAll();
        } finally {
            env.restore();
        }
    });

    it("does not fire when permission is not granted", () => {
        const env = installGlobals();
        FakeNotification.reset();
        FakeNotification.permission = "denied";
        try {
            const rs = stubRoom();
            const tracker = new NotificationTracker(stubMatrix([rs.room]));
            env.fire("blur");
            rs.emit(timelineEvent());
            assert.equal(FakeNotification.instances.length, 0);
            tracker.detachAll();
        } finally {
            env.restore();
        }
    });

    it("does not fire for our own messages", () => {
        const env = installGlobals();
        FakeNotification.reset();
        FakeNotification.permission = "granted";
        try {
            const rs = stubRoom();
            const tracker = new NotificationTracker(stubMatrix([rs.room], "@me:localhost"));
            env.fire("blur");
            rs.emit(timelineEvent({ getSender: () => "@me:localhost" }));
            assert.equal(FakeNotification.instances.length, 0);
            tracker.detachAll();
        } finally {
            env.restore();
        }
    });

    it("does not fire for redacted events", () => {
        const env = installGlobals();
        FakeNotification.reset();
        FakeNotification.permission = "granted";
        try {
            const rs = stubRoom();
            const tracker = new NotificationTracker(stubMatrix([rs.room]));
            env.fire("blur");
            rs.emit(timelineEvent({ isRedacted: () => true }));
            assert.equal(FakeNotification.instances.length, 0);
            tracker.detachAll();
        } finally {
            env.restore();
        }
    });

    it("does not fire twice for the same event id", () => {
        const env = installGlobals();
        FakeNotification.reset();
        FakeNotification.permission = "granted";
        try {
            const rs = stubRoom();
            const tracker = new NotificationTracker(stubMatrix([rs.room]));
            env.fire("blur");
            const ev = timelineEvent();
            rs.emit(ev);
            rs.emit(ev);
            assert.equal(FakeNotification.instances.length, 1);
            tracker.detachAll();
        } finally {
            env.restore();
        }
    });

    it("requests permission automatically on construction when state is default", async () => {
        const env = installGlobals();
        FakeNotification.reset();
        FakeNotification.permission = "default";
        FakeNotification.result = "granted";
        try {
            const tracker = new NotificationTracker(stubMatrix([]));
            assert.equal(FakeNotification.requested, true);
            // Give the microtask a chance to resolve the promise.
            await Promise.resolve();
            assert.equal(tracker.snapshot.permission, "granted");
            tracker.detachAll();
        } finally {
            env.restore();
        }
    });

    it("does not re-request permission when already granted", async () => {
        const env = installGlobals();
        FakeNotification.reset();
        FakeNotification.permission = "granted";
        try {
            const tracker = new NotificationTracker(stubMatrix([]));
            await Promise.resolve();
            assert.equal(FakeNotification.requested, false);
            tracker.detachAll();
        } finally {
            env.restore();
        }
    });

    it("does not re-request permission when already denied", async () => {
        const env = installGlobals();
        FakeNotification.reset();
        FakeNotification.permission = "denied";
        try {
            const tracker = new NotificationTracker(stubMatrix([]));
            await Promise.resolve();
            assert.equal(FakeNotification.requested, false);
            tracker.detachAll();
        } finally {
            env.restore();
        }
    });

    it("detachAll removes room listeners", () => {
        const env = installGlobals();
        FakeNotification.reset();
        try {
            const rs = stubRoom();
            const tracker = new NotificationTracker(stubMatrix([rs.room]));
            assert.equal(rs.listenerCount(), 1);
            tracker.detachAll();
            assert.equal(rs.listenerCount(), 0);
        } finally {
            env.restore();
        }
    });

    it("detachAll removes window listeners", () => {
        const env = installGlobals();
        try {
            const tracker = new NotificationTracker(stubMatrix([]));
            assert.equal(env.listenerCount("focus"), 1);
            assert.equal(env.listenerCount("blur"), 1);
            tracker.detachAll();
            assert.equal(env.listenerCount("focus"), 0);
            assert.equal(env.listenerCount("blur"), 0);
        } finally {
            env.restore();
        }
    });
});
