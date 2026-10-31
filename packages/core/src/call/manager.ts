import { ClientWidgetApi, Widget } from "matrix-widget-api";
import type { IRoomEvent } from "matrix-widget-api";
import { ClientEvent, MatrixEventEvent } from "matrix-js-sdk";
import type { MatrixClient, MatrixEvent } from "matrix-js-sdk";
import type { CallState, CallView } from "../contract.ts";
import { Observable } from "../observable.ts";
import { CallWidgetDriver } from "./driver.ts";

/**
 * Widget actions Element Call speaks with its host (`src/widget.ts` in the
 * element-call repo). `JoinCall`/`HangupCall` are sent BY the app to say it
 * joined or left, and sent TO the app to make it hang up.
 */
const ACTION_JOINED = "io.element.join";
const ACTION_HANGUP = "im.vector.hangup";
const ACTION_CLOSE = "io.element.close";

/** How long the widget has to finish its handshake before we call it dead. */
const HANDSHAKE_TIMEOUT_MS = 30_000;
/** How long a polite hang-up may take before the frame is torn down anyway. */
const HANGUP_TIMEOUT_MS = 2_000;

/**
 * Build the call app's URL for one call. The embedded package is served at the
 * app's root (no `/room` part) and takes its parameters in the fragment so
 * they never reach the call app's server. `$…` tokens are the widget-API
 * template variables, substituted (and URL-encoded) by `Widget.getCompleteUrl`.
 * Parameters are documented in element-call `docs/url_params.md`.
 */
export function callUrlTemplate(base: string, params: { origin: string; intent: string }): string {
    // The app's router sends the path `/` to its standalone home page ("Start
    // new call") and every other path to the call, widget or not. Element Web
    // never notices: it serves the package from a subdirectory. A call app
    // deployed at an origin's root must be addressed by its `index.html`,
    // which still resolves the package's relative chunks (VERIFIED in the
    // Element Call browser test: at `/` the handshake completed and the frame
    // still showed the home page).
    const trimmed = base.replace(/\/+$/, "");
    const root = new URL(`${trimmed}/`).pathname === "/" ? `${trimmed}/index.html` : `${trimmed}/`;
    const query = [
        "widgetId=$matrix_widget_id",
        `parentUrl=${encodeURIComponent(params.origin)}`,
        "userId=$matrix_user_id",
        "deviceId=$org.matrix.msc3819.matrix_device_id",
        "baseUrl=$org.matrix.msc4039.matrix_base_url",
        "roomId=$matrix_room_id",
        "theme=$org.matrix.msc2873.client_theme",
        "lang=$org.matrix.msc2873.client_language",
        `intent=${params.intent}`,
        // We draw our own chrome around the frame, and the user should not be
        // able to navigate away from the room inside it.
        "header=none",
        "confineToRoom=true",
    ].join("&");
    return `${root}#?${query}`;
}

/** Element Call's intent for a call: voice-only and DM variants are distinct. */
export function callIntent(video: boolean, isDm: boolean): string {
    return `start_call${isDm ? "_dm" : ""}${video ? "" : "_voice"}`;
}

type ToDeviceMessage = Parameters<ClientWidgetApi["feedToDevice"]>[0];

interface Attached {
    api: ClientWidgetApi;
    detach: () => void;
}

/**
 * Owns the embedded call: builds its URL, runs the widget transport once a frame
 * is attached, feeds it the room's events, and publishes a snapshot of the call.
 *
 * One call per window, by construction: a second `join` leaves the first, so
 * there is never more than one widget transport (and one set of client
 * listeners) alive.
 */
export class CallManager {
    private readonly client: MatrixClient;
    private readonly elementCallUrl: string;
    private readonly feed: Observable<CallView | null>;
    private widget: Widget | null = null;
    private attached: Attached | null = null;

    /**
     * `feed` is owned by the caller so `call` can be read before the client
     * starts (it is simply `null` until a call exists).
     */
    public constructor(client: MatrixClient, elementCallUrl: string, feed: Observable<CallView | null>) {
        this.client = client;
        this.elementCallUrl = elementCallUrl;
        this.feed = feed;
    }

    public async join(roomId: string, video: boolean): Promise<void> {
        const room = this.client.getRoom(roomId);
        if (!room) throw new Error(`Cannot call unknown room ${roomId}`);
        await this.leave();

        const userId = this.client.getUserId();
        if (!userId) throw new Error("Cannot call without a session");
        const isDm = room.getJoinedMemberCount() === 2;
        const deviceId = this.client.getDeviceId();
        const widget = new Widget({
            id: `tumult-call-${Date.now().toString(36)}`,
            creatorUserId: userId,
            type: "m.custom",
            url: callUrlTemplate(this.elementCallUrl, {
                origin: globalThis.location.origin,
                intent: callIntent(video, isDm),
            }),
            // The call app announces itself with ContentLoaded (as Element Web
            // expects: it sets this false too). With `true` the host instead
            // starts the handshake on the iframe's `load` event, which has
            // usually fired before attach() can listen, so the capabilities
            // exchange never began and the app logged "Improper sequence".
            waitForIframeLoad: false,
        });
        const url = widget.getCompleteUrl({
            widgetRoomId: roomId,
            currentUserId: userId,
            ...(deviceId ? { deviceId } : {}),
            baseUrl: this.client.baseUrl,
            clientTheme: document.documentElement.dataset.mode === "light" ? "light" : "dark",
            clientLanguage: document.documentElement.lang || "en",
        });
        this.widget = widget;
        this.feed.set({ roomId, url, video, state: "connecting" });
    }

    public attach(frame: HTMLIFrameElement): () => void {
        const view = this.feed.get();
        const widget = this.widget;
        if (!view || !widget) throw new Error("No call to attach a frame to");
        this.detach();

        const api = new ClientWidgetApi(widget, frame, new CallWidgetDriver(this.client, view.roomId));
        const roomId = view.roomId;

        // Each handler guards on the room because the client emits every event
        // it syncs; the widget only has a grant for this room.
        const onEvent = (event: MatrixEvent): void => {
            if (event.getRoomId() !== roomId) return;
            // An undecrypted event has no usable type or content yet; it is fed
            // from `Decrypted` below once it has.
            if (event.getType() === "m.room.encrypted") return;
            void api.feedEvent(event.getEffectiveEvent() as unknown as IRoomEvent, roomId).catch(logFeedError);
        };
        const onDecrypted = (event: MatrixEvent): void => {
            if (event.getRoomId() !== roomId || event.isDecryptionFailure()) return;
            void api.feedEvent(event.getEffectiveEvent() as unknown as IRoomEvent, roomId).catch(logFeedError);
        };
        const onToDevice = (event: MatrixEvent): void => {
            void api.feedToDevice(event.getEffectiveEvent() as unknown as ToDeviceMessage, event.isEncrypted()).catch(logFeedError);
        };
        this.client.on(ClientEvent.Event, onEvent);
        this.client.on(MatrixEventEvent.Decrypted, onDecrypted);
        this.client.on(ClientEvent.ToDeviceEvent, onToDevice);

        const timer = setTimeout(() => this.setState("error"), HANDSHAKE_TIMEOUT_MS);
        api.once("ready", () => clearTimeout(timer));
        api.on(`action:${ACTION_JOINED}`, (ev: CustomEvent) => {
            ev.preventDefault();
            api.transport.reply(ev.detail, {});
            this.setState("joined");
        });
        const finished = (ev: CustomEvent): void => {
            ev.preventDefault();
            api.transport.reply(ev.detail, {});
            // The app left (or asked to close): the call is over, so drop it.
            void this.leave();
        };
        api.on(`action:${ACTION_HANGUP}`, finished);
        api.on(`action:${ACTION_CLOSE}`, finished);

        const detach = (): void => {
            clearTimeout(timer);
            this.client.off(ClientEvent.Event, onEvent);
            this.client.off(MatrixEventEvent.Decrypted, onDecrypted);
            this.client.off(ClientEvent.ToDeviceEvent, onToDevice);
            api.removeAllListeners();
            api.stop();
        };
        this.attached = { api, detach };
        return () => {
            // Only the attachment that created this closure may tear it down:
            // a stale callback from a remounted frame must not kill the new one.
            if (this.attached?.detach === detach) this.detach();
        };
    }

    /** Hang up politely, then drop the frame wiring and the call. */
    public async leave(): Promise<void> {
        const attached = this.attached;
        if (attached) {
            // Ask the app to leave first so it removes our call membership; a
            // killed frame would leave a ghost participant until the delayed
            // leave event fires.
            await Promise.race([
                attached.api.transport.send(ACTION_HANGUP as never, {}).catch(() => undefined),
                new Promise((resolve) => setTimeout(resolve, HANGUP_TIMEOUT_MS)),
            ]);
        }
        this.detach();
        this.widget = null;
        this.feed.set(null);
    }

    /** Drop listeners without touching the published call (used on stop()). */
    public detachAll(): void {
        this.detach();
        this.widget = null;
        this.feed.set(null);
    }

    private detach(): void {
        const attached = this.attached;
        this.attached = null;
        attached?.detach();
    }

    private setState(state: CallState): void {
        const view = this.feed.get();
        if (view && view.state !== state) this.feed.set({ ...view, state });
    }
}

function logFeedError(error: unknown): void {
    console.error("[tumult] could not pass an event to the call app", error);
}
