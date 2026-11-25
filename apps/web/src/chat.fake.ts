import type { ChatClient } from "@tumult/core";
import { createFakeChatClient, type FakeTestHooks } from "@tumult/core/fake";

/**
 * Fake client for slice 2: deterministic fixtures (seed 1337), no Matrix code
 * in the graph — the crypto WASM never loads.
 */
export function createChat(): ChatClient {
    const chat = createFakeChatClient();
    // The browser smoke suite drives this fake-only handle to simulate a second
    // device writing account data. It is confined to the fake build, which is
    // never deployed; the real chat.ts keeps its dev-only diagnostics instead.
    if (typeof window !== "undefined") {
        (window as unknown as { __tumultFake?: FakeTestHooks }).__tumultFake = chat;
    }
    return chat;
}
