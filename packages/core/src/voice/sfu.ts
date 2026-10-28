import type { IOpenIDToken, MatrixClient } from "matrix-js-sdk";
import { isLivekitTransportConfig } from "matrix-js-sdk/lib/matrixrtc/index.js";
import type { LivekitTransportConfig } from "matrix-js-sdk/lib/matrixrtc/index.js";

/** Where to connect and the token to connect with. */
export interface SfuConfig {
    url: string;
    jwt: string;
}

/** One discovery route and how it went, so a failure can name what was asked. */
export interface FocusAttempt {
    /** The request that was made, phrased for an error message. */
    asked: string;
    /** Why it produced nothing, or `null` when it did. */
    error: string | null;
}

export interface FocusDiscovery {
    foci: LivekitTransportConfig[];
    attempts: FocusAttempt[];
}

/** The MSC4143 transport-discovery endpoint, under its unstable prefix. */
const TRANSPORTS_PATH = "/_matrix/client/unstable/org.matrix.msc4143/rtc/transports";

/**
 * Find the LiveKit foci this user's homeserver offers.
 *
 * MSC4143 has moved its discovery mechanism, and a deployment may implement
 * either revision of it:
 *
 *  - `GET /_matrix/client/unstable/org.matrix.msc4143/rtc/transports`: the
 *    current revision. Authenticated and answered by the homeserver itself,
 *    which is exactly why the MSC rejected the well-known form that came before
 *    it — transports stay invisible to unauthenticated users, and enterprise
 *    deployments that do not own their `.well-known` stay configurable.
 *  - `org.matrix.msc4143.rtc_foci` in `.well-known/matrix/client`: the earlier
 *    revision, still consumed by Element Call and still the ONLY thing
 *    matrix.org publishes (`livekit-jwt.call.matrix.org`). The current MSC
 *    lists it under "Alternatives", so this is a revision gap, not an
 *    official/unofficial split.
 *
 * Both are tried, in that order, because supporting only the first leaves every
 * matrix.org account unable to join a call at all. Nothing here throws: the
 * attempt list is what the caller turns into an honest error message.
 */
export async function discoverFoci(
    client: Pick<MatrixClient, "_unstable_getRTCTransports" | "getDomain">,
    fetchImpl: typeof fetch = fetch,
): Promise<FocusDiscovery> {
    const attempts: FocusAttempt[] = [];

    try {
        const transports = await client._unstable_getRTCTransports();
        const foci = (Array.isArray(transports) ? transports : []).filter(isLivekitFocus);
        attempts.push({ asked: `GET ${TRANSPORTS_PATH}`, error: foci.length > 0 ? null : "answered with no LiveKit transport" });
        if (foci.length > 0) return { foci, attempts };
    } catch (error) {
        attempts.push({ asked: `GET ${TRANSPORTS_PATH}`, error: reason(error) });
    }

    const url = wellKnownUrl(client);
    if (!url) return { foci: [], attempts };
    try {
        const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const foci = livekitFoci(await response.json());
        attempts.push({ asked: `GET ${url}`, error: foci.length > 0 ? null : "listed no LiveKit focus" });
        if (foci.length > 0) return { foci, attempts };
    } catch (error) {
        attempts.push({ asked: `GET ${url}`, error: reason(error) });
    }
    return { foci: [], attempts };
}

/**
 * The well-known document lives on the SERVER NAME, not on the homeserver base
 * URL: matrix.org's base URL is `matrix-client.matrix.org`, but its `.well-known`
 * is served by `matrix.org`. `getDomain()` is the MXID's server name, which is
 * also the name the RTC focus depends on.
 */
function wellKnownUrl(client: Pick<MatrixClient, "getDomain">): string | null {
    try {
        const domain = client.getDomain();
        return domain ? `https://${domain}/.well-known/matrix/client` : null;
    } catch {
        return null;
    }
}

/**
 * LiveKit foci from a well-known document.
 *
 * Two keys are read: the earlier revision's `rtc_foci`, and `rtc.transports`
 * (the CS-API response shape, which a later well-known draft reused). Both
 * carry the same transport objects, so the same guard applies to each.
 */
function livekitFoci(document: unknown): LivekitTransportConfig[] {
    if (typeof document !== "object" || document === null) return [];
    const record = document as Record<string, unknown>;
    const foci: LivekitTransportConfig[] = [];
    for (const key of ["org.matrix.msc4143.rtc_foci", "org.matrix.msc4143.rtc.transports"]) {
        const list = record[key];
        if (!Array.isArray(list)) continue;
        for (const item of list) if (isLivekitFocus(item)) foci.push(item);
    }
    // A document naming the same service under both keys is one focus.
    return foci.filter((focus, index) => foci.findIndex((other) => other.livekit_service_url === focus.livekit_service_url) === index);
}

/**
 * The SDK's own `isLivekitTransportConfig` is NOT null-safe (it reads
 * `object.type` directly, so it throws on `undefined`), and both of our sources
 * can hand us nothing: `getFocusInUse()` returns `undefined` until a membership
 * names a focus, and a well-known array can hold anything.
 */
export function isLivekitFocus(value: unknown): value is LivekitTransportConfig {
    return value != null && isLivekitTransportConfig(value);
}

function reason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Ask the MatrixRTC authorization service (lk-jwt-service) for a LiveKit
 * connection, using the legacy `/sfu/get` endpoint.
 *
 * Why the legacy endpoint: it is the one that answers with BOTH the SFU's
 * WebSocket url and a JWT in one round trip, and assigns the participant
 * identity `<user_id>:<device_id>`, which is what Element Call's default
 * ("compatibility") mode and every deployed service speak. The newer
 * `/get_token` (hashed identities, Matrix-2.0 mode) needs sticky events and a
 * different identity scheme; moving to it is a deliberate protocol change, not
 * a drive-by, and is why the manager keeps this call in one place.
 *
 * The service verifies `openid_token` against the user's homeserver, so no
 * Matrix access token ever leaves the client.
 */
export async function getSfuConfig(
    client: Pick<MatrixClient, "getOpenIdToken">,
    serviceUrl: string,
    roomId: string,
    deviceId: string,
    fetchImpl: typeof fetch = fetch,
): Promise<SfuConfig> {
    const openIdToken: IOpenIDToken = await client.getOpenIdToken();
    const response = await fetchImpl(`${serviceUrl.replace(/\/+$/, "")}/sfu/get`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `room` is the MATRIX room id: the service derives the LiveKit room
        // alias from it, so two clients in one room always meet in one SFU room.
        body: JSON.stringify({ room: roomId, openid_token: openIdToken, device_id: deviceId }),
    });
    if (!response.ok) {
        throw new Error(`The call server refused us (${response.status}): ${await response.text().catch(() => "")}`.trim());
    }
    const body = (await response.json()) as Partial<SfuConfig>;
    if (typeof body.url !== "string" || typeof body.jwt !== "string") {
        throw new Error("The call server answered without an SFU url and token");
    }
    return { url: body.url, jwt: body.jwt };
}
