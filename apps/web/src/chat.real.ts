import { createChatClient } from "@tumult/core";
import type { ChatClient } from "@tumult/core";

/**
 * MAS will not accept a loopback address as `client_uri`, so it cannot be
 * derived from `window.location` during local development. It identifies the
 * *application*, not the instance, so it is configuration.
 *
 * Set `VITE_CLIENT_URI` in `apps/web/.env.local` — see `.env.example`.
 */
const clientUri = import.meta.env.VITE_CLIENT_URI;

if (!clientUri) {
    throw new Error(
        "VITE_CLIENT_URI is not set. It must be a public https URL you control " +
            "(MAS rejects http and rejects localhost). See apps/web/.env.example.",
    );
}

// Narrowed once at module scope (the guard above does not narrow inside
// createChat's body, so keep a non-optional binding here).
const appClientUri: string = clientUri;

const redirectUri = `${window.location.origin}/auth/callback`;

/**
 * A browser app served over http can only be on loopback, and MAS only permits
 * a loopback redirect for a `native` client. So the application type follows
 * from how this instance is actually served: https deployment registers as
 * `web`, local dev registers as `native`.
 */
const applicationType = window.location.protocol === "https:" ? "web" : "native";

/**
 * The single ChatClient for this window.
 *
 * One instance per renderer is a hard requirement, not a convenience: the
 * crypto stack is not thread-safe, and two MatrixClients against the same
 * IndexedDB will corrupt the store and break decryption.
 */
export function createChat(): ChatClient {
    return createChatClient({
        clientMetadata: {
            clientName: "Tumult",
            clientUri: appClientUri,
            redirectUri,
            applicationType,
        },
    });
}
