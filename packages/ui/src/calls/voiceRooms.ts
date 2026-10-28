import { inject, shallowRef, type InjectionKey, type Ref } from "vue";

/**
 * Who is in each room's voice session (user ids), provided by the shell from
 * the client's `voiceRooms` feed. A room row has no client of its own, so this
 * is how it learns to show a participant count — the same channel pattern as
 * `ActionsContext`.
 *
 * Injection is optional: an old host (or a test mounting a row alone) gets an
 * empty map and renders no indicator.
 */
export const VoiceRoomsKey: InjectionKey<Readonly<Ref<Record<string, string[]>>>> = Symbol("tumult/voice-rooms");

const EMPTY = shallowRef<Record<string, string[]>>({});

export function useVoiceRooms(): Readonly<Ref<Record<string, string[]>>> {
    return inject(VoiceRoomsKey, EMPTY);
}
