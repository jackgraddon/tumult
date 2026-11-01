import { DEFAULT_VOICE_SETTINGS } from "../contract.ts";
import type { VoiceSettings } from "../contract.ts";

/**
 * Whatever was stored, made into a complete settings object. Storage is shared
 * with older and newer builds, so a missing or mistyped field falls back to its
 * default instead of failing, and unknown fields are dropped.
 */
export function normalizeVoiceSettings(raw: unknown): VoiceSettings {
    const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const pick = (key: keyof VoiceSettings): boolean => (typeof source[key] === "boolean" ? source[key] : DEFAULT_VOICE_SETTINGS[key]);
    return {
        echoCancellation: pick("echoCancellation"),
        noiseSuppression: pick("noiseSuppression"),
        autoGainControl: pick("autoGainControl"),
    };
}
