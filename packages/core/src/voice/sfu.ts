import type { IOpenIDToken, MatrixClient } from "matrix-js-sdk";

/** Where to connect and the token to connect with. */
export interface SfuConfig {
    url: string;
    jwt: string;
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
