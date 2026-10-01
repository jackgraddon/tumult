import type { ChatClient } from "@tumult/core";
import { createFakeChatClient } from "@tumult/core/fake";

/**
 * Fake client for slice 2: deterministic fixtures (seed 1337), no Matrix code
 * in the graph — the crypto WASM never loads.
 */
export function createChat(): ChatClient {
    return createFakeChatClient();
}
