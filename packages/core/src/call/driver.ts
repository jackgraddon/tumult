import type { IOpenIDUpdate, IRoomEvent, ISendDelayedEventDetails, ISendEventDetails, ITurnServer, SimpleObservable } from "matrix-widget-api";
import { OpenIDRequestState, WidgetDriver } from "matrix-widget-api";
import type { MatrixClient } from "matrix-js-sdk";
import { UpdateDelayedEventAction } from "matrix-js-sdk/lib/@types/requests.js";

/**
 * The host half of the widget transport between us and the embedded call app.
 *
 * The call app (Element Call) is a widget: it has no login of its own, so every
 * Matrix operation it needs — send the call-membership state event, read who is
 * in the call, trade encryption keys by to-device message, mint a LiveKit token
 * — is asked of us over `postMessage`, and answered here with OUR client. That is
 * the whole point of embedding rather than iframing the standalone app: the
 * session, the crypto identity and the device ID are the ones the user already
 * has, so the call shows up as them, on this device.
 *
 * Trust: capabilities are approved wholesale. That is a deliberate decision, not
 * an oversight — the widget is the call app the operator configured
 * (`elementCallUrl`), loaded into a frame whose origin is pinned by CSP
 * `frame-src`, and the call is unusable without the full set (it requests
 * room-scoped send/receive grants it cannot enumerate ahead of time). A
 * per-capability prompt would be the place to tighten this if a third-party call
 * app were ever allowed.
 */
export class CallWidgetDriver extends WidgetDriver {
    private readonly client: MatrixClient;
    private readonly roomId: string;

    // No parameter properties: strip-only Node (node --test) rejects them.
    public constructor(client: MatrixClient, roomId: string) {
        super();
        this.client = client;
        this.roomId = roomId;
    }

    public override async validateCapabilities(requested: Set<string>): Promise<Set<string>> {
        return new Set(requested);
    }

    public override getKnownRooms(): string[] {
        return [this.roomId];
    }

    /** A widget may only act on the call's own room; a null id means "that room". */
    private room(roomId?: string | null): string {
        const id = roomId ?? this.roomId;
        if (id !== this.roomId) throw new Error(`The call app may only use ${this.roomId}, not ${id}`);
        return id;
    }

    public override async sendEvent(
        eventType: string,
        content: unknown,
        stateKey?: string | null,
        roomId?: string | null,
    ): Promise<ISendEventDetails> {
        const id = this.room(roomId);
        // The SDK types event content per known event type; the widget's is
        // opaque JSON by definition, so the cast is the boundary.
        const body = content as never;
        const sent =
            typeof stateKey === "string"
                ? await this.client.sendStateEvent(id, eventType as never, body, stateKey)
                : await this.client.sendEvent(id, eventType as never, body);
        return { roomId: id, eventId: sent.event_id };
    }

    public override async sendDelayedEvent(
        delay: number,
        eventType: string,
        content: unknown,
        stateKey?: string | null,
        roomId?: string | null,
    ): Promise<ISendDelayedEventDetails> {
        const id = this.room(roomId);
        const body = content as never;
        const sent =
            typeof stateKey === "string"
                ? await this.client._unstable_sendDelayedStateEvent(id, { delay }, eventType as never, body, stateKey)
                : await this.client._unstable_sendDelayedEvent(id, { delay }, null, eventType as never, body);
        return { roomId: id, delayId: sent.delay_id };
    }

    public override async sendStickyEvent(
        stickyDurationMs: number,
        eventType: string,
        content: unknown,
        roomId?: string | null,
    ): Promise<ISendEventDetails> {
        const id = this.room(roomId);
        const sent = await this.client._unstable_sendStickyEvent(id, stickyDurationMs, null, eventType as never, content as never);
        return { roomId: id, eventId: sent.event_id };
    }

    public override async sendDelayedStickyEvent(
        delay: number,
        stickyDurationMs: number,
        eventType: string,
        content: unknown,
        roomId?: string | null,
    ): Promise<ISendDelayedEventDetails> {
        const id = this.room(roomId);
        const sent = await this.client._unstable_sendStickyDelayedEvent(
            id,
            stickyDurationMs,
            { delay },
            null,
            eventType as never,
            content as never,
        );
        return { roomId: id, delayId: sent.delay_id };
    }

    public override async cancelScheduledDelayedEvent(delayId: string): Promise<void> {
        await this.client._unstable_updateDelayedEvent(delayId, UpdateDelayedEventAction.Cancel);
    }

    public override async restartScheduledDelayedEvent(delayId: string): Promise<void> {
        await this.client._unstable_updateDelayedEvent(delayId, UpdateDelayedEventAction.Restart);
    }

    public override async sendScheduledDelayedEvent(delayId: string): Promise<void> {
        await this.client._unstable_updateDelayedEvent(delayId, UpdateDelayedEventAction.Send);
    }

    public override async sendToDevice(
        eventType: string,
        encrypted: boolean,
        contentMap: { [userId: string]: { [deviceId: string]: object } },
    ): Promise<void> {
        const batch: { userId: string; deviceId: string; payload: object }[] = [];
        for (const [userId, devices] of Object.entries(contentMap)) {
            for (const [deviceId, payload] of Object.entries(devices)) batch.push({ userId, deviceId, payload });
        }
        if (!encrypted) {
            await this.client.queueToDevice({ eventType, batch });
            return;
        }
        // Call keys must be Olm-encrypted; refusing beats silently sending them
        // in the clear when there is no crypto stack.
        const crypto = this.client.getCrypto();
        if (!crypto) throw new Error("Cannot send an encrypted to-device message without crypto");
        const out = { eventType, batch: [] as Awaited<ReturnType<typeof crypto.encryptToDeviceMessages>>["batch"] };
        for (const { userId, deviceId, payload } of batch) {
            const encryptedBatch = await crypto.encryptToDeviceMessages(eventType, [{ userId, deviceId }], payload as never);
            out.batch.push(...encryptedBatch.batch);
            out.eventType = encryptedBatch.eventType;
        }
        await this.client.queueToDevice(out);
    }

    public override async readStateEvents(
        eventType: string,
        stateKey: string | undefined,
        limit: number,
        roomIds?: string[] | null,
    ): Promise<IRoomEvent[]> {
        if (roomIds && !roomIds.includes(this.roomId) && !roomIds.includes("*")) return [];
        return this.readRoomState(this.roomId, eventType, stateKey).then((events) => events.slice(0, limit));
    }

    public override async readRoomState(roomId: string, eventType: string, stateKey: string | undefined): Promise<IRoomEvent[]> {
        const state = this.client.getRoom(this.room(roomId))?.currentState;
        if (!state) return [];
        const events = stateKey === undefined ? state.getStateEvents(eventType) : [state.getStateEvents(eventType, stateKey)];
        return events.filter((event) => event != null).map((event) => event.getEffectiveEvent() as unknown as IRoomEvent);
    }

    public override async readStickyEvents(roomId: string): Promise<IRoomEvent[]> {
        const room = this.client.getRoom(this.room(roomId));
        if (!room) return [];
        return [...room._unstable_getStickyEvents()].map((entry) => entry.event as unknown as IRoomEvent);
    }

    public override askOpenID(observer: SimpleObservable<IOpenIDUpdate>): void {
        this.client.getOpenIdToken().then(
            (token) => observer.update({ state: OpenIDRequestState.Allowed, token }),
            () => observer.update({ state: OpenIDRequestState.Blocked }),
        );
    }

    public override async *getTurnServers(): AsyncGenerator<ITurnServer> {
        await this.client.checkTurnServers();
        for (const server of this.client.getTurnServers()) {
            yield { uris: server.urls, username: server.username, password: server.credential };
        }
    }

    public override async getRtcTransports(): Promise<Awaited<ReturnType<WidgetDriver["getRtcTransports"]>>> {
        // The widget API's key is `rtc_transports` (MSC4143's unstable
        // response key). This once returned `{ transports }` behind an
        // `as never`, so Element Call read `undefined`, concluded the server
        // could not host calls and showed MISSING_MATRIX_RTC_TRANSPORT.
        return { rtc_transports: await this.client._unstable_getRTCTransports() };
    }

    public override async getRtcLivekitToken(data: Parameters<WidgetDriver["getRtcLivekitToken"]>[0]) {
        const { jwt } = await this.client._unstable_getLivekitToken({
            url: data.url,
            room_id: data.room_id,
            slot_id: data.slot_id,
            member: data.member,
            server_name: data.server_name,
        });
        return { jwt };
    }

    public override async delegateRtcLivekitDelayedLeave(data: Parameters<WidgetDriver["delegateRtcLivekitDelayedLeave"]>[0]) {
        // The widget-api type for this request omits `url`, but the call app
        // forwards the SDK's whole request body, and the server needs the SFU
        // WebSocket URL the member is connected to (it rejects anything that is
        // not one of its own SFUs). Passing the data through is the only way to
        // honour it — deriving it here from the RTC transports would send the
        // JWT service URL, which is a different thing.
        await this.client._unstable_delegateDelayedLeave(data as never);
        return {};
    }
}
