import type { MessageView } from "@tumult/core";

export interface UnknownEventDescription {
    /** Headline: what the user is looking at, in plain language. */
    label: string;
    /** Optional second line: why we can't show it, or its body when useful. */
    detail: string | null;
}

function friendlyCategory(type: string): string | null {
    if (type === "com.beeper.message_send_status") return "Bridge send status";
    if (type.startsWith("com.beeper.")) return "Beeper event";
    if (type.includes("poll")) return "Poll event";
    if (type.startsWith("m.call.") || type.includes("rtc")) return "Call event";
    if (type.startsWith("m.key.verification.")) return "Verification event";
    if (type.startsWith("org.example.")) return "Example event";
    return null;
}

/** Derive an honest, non-alarmist description of a renderer-less row. */
export function describeUnknownEvent(message: MessageView): UnknownEventDescription {
    const category = friendlyCategory(message.type) ?? "Event";
    const body = message.body.trim();
    const isTypePlaceholder = body === `[${message.type}]`;
    const detail = body.length > 0 && !isTypePlaceholder ? body : null;
    return {
        label: `Can't display this ${category.toLowerCase()} yet`,
        detail,
    };
}
