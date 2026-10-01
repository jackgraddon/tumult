import type { ChatClient } from "@tumult/core";
import { createChat } from "./chat.fake.ts";

// Slice 3 swaps this one import to "./chat.real.ts". No env plumbing, no
// runtime branch — the unimported module simply isn't in the graph.

export const chat: ChatClient = createChat();
