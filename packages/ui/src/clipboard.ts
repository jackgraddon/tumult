/**
 * Copy `text` to the clipboard.
 *
 * `navigator.clipboard` only exists in a secure context, so a plain-http origin
 * (a LAN dev server, an http deploy before TLS lands) leaves it undefined — the
 * menu's Copy items still have to work there. The fallback is the legacy
 * `execCommand("copy")` route through a hidden textarea.
 *
 * Resolves `false` when neither route worked, so the caller can surface the
 * failure instead of pretending something was copied.
 */
export async function copyText(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // Permission/quota failure (or a non-secure context that still exposes
        // the API): fall through to the legacy path rather than give up.
    }

    try {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.setAttribute("aria-hidden", "true");
        // Off-screen but selectable: `display: none` / `visibility: hidden`
        // elements cannot hold a selection.
        area.style.position = "fixed";
        area.style.top = "0";
        area.style.opacity = "0";
        document.body.appendChild(area);
        try {
            area.select();
            return document.execCommand("copy");
        } finally {
            area.remove();
        }
    } catch {
        return false;
    }
}

/**
 * The context menus' shared "Copy" behaviour: copy, and when it did not work,
 * say so in the console rather than pretend. `what` names the payload so the
 * message is actionable ("Could not copy room link to the clipboard").
 */
export function copyOrLog(text: string, what: string): void {
    void copyText(text).then((ok) => {
        if (!ok) console.error(`Could not copy ${what} to the clipboard`);
    });
}
