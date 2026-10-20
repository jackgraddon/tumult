# Tumult plugin template

A starting point for a [Tumult](https://github.com/jackgraddon/tumult) plugin:
a manifest, one source file, a bundle step, and a release workflow that
publishes what Tumult installs.

## Use it

1. **Create your repository.** "Use this template" on GitHub, or copy the
   directory. Your repository URL is what people paste into Tumult.
2. **Edit `src/index.ts` and `tumult.plugin.json`.** Keep the two manifests in
   step: `tumult.plugin.json` is what Tumult reads, `src/index.ts` is what your
   code carries (Tumult checks they agree before running anything).
3. **Install and build.**

   ```sh
   pnpm install
   pnpm build          # writes dist/plugin.js
   pnpm typecheck      # your code against the vendored plugin types
   ```

4. **Tag a release.** Push a tag matching the manifest `version`:

   ```sh
   git tag v1.0.0 && git push origin v1.0.0
   ```

   The workflow builds, hashes and attaches `plugin.js` and
   `tumult.plugin.json`. (Enable Actions in **Settings → Actions** on a fresh
   repository; template repositories ship with workflows disabled.)
5. **Install it in Tumult.** Settings → Plugins → paste your repository URL.
   Tumult finds the release manifest, shows you the consent screen, and
   verifies the hash before anything runs.

## What lives where

| path | what it is |
|---|---|
| `tumult.plugin.json` | the release manifest — id, permissions, `entry`, and (once released) `integrity`. Validated against `tumult.plugin.schema.json`. |
| `src/index.ts` | your plugin: a manifest and `install(ctx)`. The template's example is a `/shrug` command. |
| `src/shims/vue.ts` | the `vue` your bundle builds against — see below. |
| `types/plugin.d.ts` | the whole plugin API, vendored so you need no Tumult packages installed. **Generated** in the Tumult repo — do not edit it here. |
| `esbuild.config.mjs` | the bundle step. |
| `scripts/make-release-manifest.mjs` | computes `integrity` for the built bundle. |
| `.github/workflows/release.yml` | tag → build → hash → release. |

## How a plugin talks to Tumult

Your bundle exports a `Plugin`: a manifest plus `install(ctx)`. Everything
else goes through `ctx` — the chat client, the room selection, media
resolution, and the six extension points (timeline renderers, composer
actions, slash commands, member decorations, settings tabs, stylesheets), each
gated by a **permission** you declare:

```ts
import type { Plugin } from "@tumult/ui";

export const plugin: Plugin = {
    manifest: {
        id: "cc.example.shrug",
        name: "Shrug",
        version: "1.0.0",
        permissions: ["commands"],
    },
    install(ctx) {
        ctx.addCommand({
            name: "shrug",
            description: "Append ¯\\_(ツ)_/¯ to your message",
            run: ({ args, roomId, client }) =>
                client.send(roomId, args ? `${args} ¯\\_(ツ)_/¯` : "¯\\_(ツ)_/¯"),
        });
    },
};
```

Declare every permission you use. An undeclared one is not a warning: the call
throws and the install is rolled back. An unknown one refuses the install
outright, because Tumult can only ask the user to consent to capabilities it
can name.

### Lanes: sandboxed vs in-page

Tumult **derives** your lane from your permissions — you never declare it, and
neither does a reviewer:

| permission | lane |
|---|---|
| `commands`, `composer-actions`, `styles` | **sandbox** — your code runs inside a Worker and reaches Tumult only through the message bridge. No DOM, no `window`. |
| `timeline-renderers`, `member-decorations`, `settings-tabs` | **trusted** — your code runs in the page, at Tumult's own trust level. Tumult warns the user clearly before installing. |

Stay in the sandbox if you can. A plugin that only sends messages, reacts,
transforms text or ships stylesheets can do a lot without ever needing the DOM.

### Vue components

A component permission (`timeline-renderers`, `member-decorations`,
`settings-tabs`) means you contribute a Vue component, which puts you in the
trusted lane. Import `vue` normally for its types, and build through
`esbuild.config.mjs`, which aliases `vue` to `src/shims/vue.ts` — that shim
forwards to the host's Vue instance, because a second copy of Vue in your
bundle would render but could not `inject()` anything from Tumult.

`vue` is a **devDependency** here on purpose: it is for types only. Do not
bundle a copy.

### Compatibility

`minUI` (the plugin API) and `minCore` (the chat-client contract) are enforced:
Tumult refuses to install a plugin asking for a newer version than it
provides. Omit them until you actually need them. The versions these vendored
types describe are `1.0.0` and `1.0.0`.

## Versioning and updates

Re-installing is the update path, and it always goes through the consent
screen — so if a new version asks for permissions the user never agreed to,
they are asked again. Bump `version` in both manifests and push a new tag.

Your users' trust is bound to a hash, not to your repository name: Tumult
verifies the bundle against the `integrity` in the release manifest, and
re-verifies the stored copy on every start. Move a tag or replace a release
asset and the installs that already exist keep working; new installs get what
the new release says.

## License

Do whatever you want with this template. Your plugin is yours.
