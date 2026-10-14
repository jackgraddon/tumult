import type { Plugin } from "@tumult/ui";

import AdminBadge from "./AdminBadge.vue";
import SettingsShowcaseTab from "./SettingsShowcaseTab.vue";

/**
 * Reference plugins, registered by the app (not `packages/ui`), proving each
 * extension point end to end: manifest -> permission -> context API ->
 * per-shell registry. One per extension point, kept deliberately small.
 */

/** `commands` — `/shrug <text>` sends the message with the shrug appended. */
export const shrugCommand: Plugin = {
    manifest: {
        id: "cc.jackg.tumult.shrug",
        name: "Shrug",
        version: "1.0.0",
        author: "Tumult",
        description: "Send a message with ¯\\_(ツ)_/¯ appended.",
        permissions: ["commands"],
    },
    install(ctx) {
        ctx.addCommand({
            name: "shrug",
            description: "Append ¯\\_(ツ)_/¯ to your message",
            usage: "<text>",
            run: (command) => {
                const body = command.args ? `${command.args} ¯\\_(ツ)_/¯` : "¯\\_(ツ)_/¯";
                return command.client.send(command.roomId, body);
            },
        });
    },
};

/** `composer-actions` — a 👍 button that reacts to the newest reactable message. */
export const reactLastAction: Plugin = {
    manifest: {
        id: "cc.jackg.tumult.react-last",
        name: "React to last message",
        version: "1.0.0",
        author: "Tumult",
        description: "Adds a composer button that reacts 👍 to the latest message.",
        permissions: ["composer-actions"],
    },
    install(ctx) {
        ctx.addComposerAction({
            id: "cc.jackg.tumult.react-last",
            label: "React to the last message",
            icon: "👍",
            run: (action) => {
                const timeline = action.client.timeline(action.roomId).get();
                // Only a settled, decrypted, live message can take a reaction.
                const last = [...timeline]
                    .reverse()
                    .find((message) => message.status === "sent" && message.decryption === "ok" && !message.redacted);
                if (!last) return;
                return action.client.toggleReaction(action.roomId, last.id, "👍");
            },
        });
    },
};

/** `member-decorations` — a crown on room admins. */
export const adminBadge: Plugin = {
    manifest: {
        id: "cc.jackg.tumult.admin-badge",
        name: "Admin badge",
        version: "1.0.0",
        author: "Tumult",
        description: "Shows a crown next to members with power level 100 or higher.",
        permissions: ["member-decorations"],
    },
    install(ctx) {
        ctx.addMemberDecoration({
            id: "cc.jackg.tumult.admin-badge",
            component: AdminBadge,
            match: (member) => member.membership === "join" && member.powerLevel >= 100,
        });
    },
};

/**
 * `settings-tabs` + `styles` — a settings tab whose box is styled by an
 * injected stylesheet rather than by a scoped component style.
 *
 * Injected CSS is app-wide (the shell has no shadow root) and must be
 * self-contained: the shell refuses `@import` and any `url()` that is not
 * `data:`, `blob:` or a same-document fragment, so a plugin can never turn its
 * stylesheet into a third-party request.
 */
export const settingsShowcase: Plugin = {
    manifest: {
        id: "cc.jackg.tumult.settings-showcase",
        name: "Settings showcase",
        version: "1.0.0",
        author: "Tumult",
        description: "Adds a settings tab, styled by a stylesheet the plugin injects.",
        permissions: ["settings-tabs", "styles"],
    },
    install(ctx) {
        ctx.injectStylesheet(`
.tumult-showcase-note {
    --tumult-showcase-style: applied;
    margin: 0;
    padding: var(--space-3);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-pane);
    color: var(--text-secondary);
    font-size: var(--text-sm);
}
`);
        ctx.addSettingsTab({
            id: "cc.jackg.tumult.settings-showcase",
            title: "Plugin demo",
            component: SettingsShowcaseTab,
        });
    },
};
