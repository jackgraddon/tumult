/**
 * `required_state` for every sliding-sync list and room subscription.
 *
 * Each entry is a `(type, state_key)` pair. The state_key is an EXACT match
 * except for the wildcard `"*"` — and `m.space.child` / `m.room.parent` are
 * keyed by the *other room's* id, so `""` matches nothing. Requesting `""`
 * therefore yields zero child links: every space looks parentless and every
 * room looks orphaned (all spaces in the guild rail, all rooms in DMs).
 *
 * The matching `MSC3575_WILDCARD` / `MSC3575_STATE_KEY_ME` constants live in
 * `matrix-js-sdk/lib/sliding-sync.js`; they are inlined here so this module
 * stays free of SDK value imports and can load under `node --test`.
 */
export const REQUIRED_STATE: string[][] = [
    ["m.room.name", ""],
    ["m.room.topic", ""],
    ["m.room.avatar", ""],
    ["m.room.canonical_alias", ""],
    ["m.room.encryption", ""],
    ["m.room.create", ""],
    ["m.room.power_levels", ""],
    ["m.room.join_rules", ""],
    // Keyed by the CHILD room id — only the wildcard returns the links.
    ["m.space.child", "*"],
    // Reciprocal link declared on the child, keyed by the PARENT space id.
    ["m.room.parent", "*"],
    // `m.room.member` is keyed by user id; `$ME` is the "me" pseudo-key. The
    // wildcard is load-bearing: without it sender displaynames and avatars
    // don't resolve and the timeline shows raw mxids.
    ["m.room.member", "$ME"],
    ["m.room.member", "*"],
];
