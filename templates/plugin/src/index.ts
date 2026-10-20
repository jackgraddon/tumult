/**
 * Shrug — the template plugin.
 *
 * Replace this file with your own. It stays small on purpose: one command, one
 * stylesheet, no Vue import. A logic-only plugin like this one runs in the
 * **sandbox lane** (Tumult derives that from the permissions below — you never
 * declare it), which means it cannot touch the DOM even if it wanted to.
 *
 * The manifest in `tumult.plugin.json` at the repository root is the same
 * manifest declared here; keep the two in step (the release workflow copies
 * this one into the release asset).
 */
import type { Plugin, PluginManifest } from "@tumult/ui";

const manifest: PluginManifest = {
    id: "cc.example.shrug",
    name: "Shrug",
    version: "1.0.0",
    author: "You",
    description: "Append ¯\\_(ツ)_/¯ to a message with /shrug.",
    permissions: ["commands", "styles"],
    // Leave this out until you have published a release with it: Tumult
    // refuses to install a plugin that asks for a newer API than it provides.
    // minUI: "1.0.0",
};

export const plugin: Plugin = {
    manifest,

    install(ctx) {
        ctx.injectStylesheet(`
            .cc-example-shrug-message { font-family: var(--font-family-monospace, monospace); }
        `);

        ctx.addCommand({
            name: "shrug",
            description: "Append ¯\\_(ツ)_/¯ to your message",
            usage: "<text>",
            run: ({ args, roomId, client }) => {
                const body = args ? `${args} ¯\\_(ツ)_/¯` : "¯\\_(ツ)_/¯";
                return client.send(roomId, body);
            },
        });
    },
};

export default plugin;
