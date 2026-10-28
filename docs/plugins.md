# Plugins — the extension API

Created: 2026-10-15
Scope: the per-shell plugin/extension API (Vencord-like), and how the app
installs third-party plugins from a GitHub release.
Companion to `docs/themes.md` (theming, which shares the same
"structure lives in code, values live in documents" split). Reference for
`packages/ui/src/plugins/`.

## TL;DR

- A plugin is a plain **TypeScript module** the app registers at runtime:
  a `manifest` plus `install(ctx)`. The registry never fetches, parses or
  evaluates anything — it receives a `Plugin` object (§1–§9).
- It extends the shell through **seven** APIs — timeline renderers, composer
  actions, slash commands, member decorations, settings tabs, stylesheets and
  workspace panes. Each one is gated by a **permission** the manifest declares.
- Everything a plugin registers is a **disposable**. Uninstall reverses all of
  it, and an install that throws is rolled back atomically — a half-installed
  plugin leaves no residue.
- The registry is **per shell** (provide/inject via `PluginsKey`), never a
  module singleton, so two shells on one page cannot share install state.
  The registry itself is in-memory; **installed third-party plugins are
  persisted by the app** and re-registered on every boot (§11).
- **Third-party plugins are installed from a GitHub repository** (§11): the app
  reads the release's `tumult.plugin.json`, validates it against
  `docs/plugin.schema.json`, shows a plain-language consent screen, downloads
  the bundle and refuses it unless its sha256 matches the manifest's
  `integrity`. There is no central gatekeeper: any repository installs.
- The **lane is derived, never declared** (`deriveLane`): a plugin whose
  permissions are all logic-only (`commands`, `composer-actions`, `styles`) is
  loaded into a **Worker** and reaches the shell only through the bridge; a
  plugin that contributes a live component (renderer, decoration, settings tab,
  workspace pane) runs **in-page at the app's trust level**, and the consent
  screen says so out loud. The in-page lane is an extension seam, **not** a
  sandbox.
- A plugin callback is **not** a component: use `ctx` inside `install`, `run`
  and `match`. The `inject()`-based hooks (`useSelection`, `usePluginRegistry`,
  …) only work inside components — renderers, decorations and settings tabs.


## 1. Where plugins live

| path | holds |
|---|---|
| `packages/ui/src/plugins/types.ts` | the contract: `Plugin`, `PluginManifest`, `PluginContext`, `PluginApi`, `PluginDeps`, `Permission`, `Disposable` |
| `packages/ui/src/plugins/api.ts` | the permission-checked, disposable-tracking API handed to `install(ctx)` |
| `packages/ui/src/plugins/registry.ts` | `PluginRegistry` (lifecycle, rollback, ordering) + `PluginsKey` / `usePluginRegistry` |
| `packages/ui/src/plugins/source.ts` | `parsePluginSource` — a pasted URL / `owner/repo` → a GitHub `PluginSource`; pure, no network |
| `packages/ui/src/plugins/verify.ts` | `hashBundle`, `checkReleaseManifest`, `needsConsent` — the trust arithmetic, network-free |
| `packages/ui/src/plugins/consent.ts` | `PERMISSION_SUMMARY` / `LANE_SUMMARY` — the plain-language consent copy |
| `packages/ui/src/plugins/installControls.ts` | `PluginInstallControls` + `PluginInstallKey` — the install seam the app implements |
| `packages/ui/src/plugins/authoring.ts` | the plugin-AUTHOR surface: an explicit re-export of exactly what a plugin may see, and the sole input to the generated `templates/plugin/types/plugin.d.ts` |
| `packages/ui/src/plugins/InstallConsentDialog.vue` | the consent screen (a `RoomDialog` composition) |
| `packages/ui/src/plugins/contributions.ts` | `ContributionList<T>` — the shared keyed registry behind three of the APIs |
| `packages/ui/src/plugins/sandbox/protocol.ts` | the Worker bridge's wire contract (message kinds, the client method/feed name lists, capability snapshot) |
| `packages/ui/src/plugins/sandbox/host.ts` | `sandboxPlugin()` — the host facade that runs a bundle in a Worker and answers its RPCs |
| `packages/ui/src/plugins/sandbox/worker/runtime.ts` | the Worker-side runtime factory (rebuilds `PluginContext` over RPC; tested in-process) |
| `packages/ui/src/plugins/sandbox/worker/shim.ts` | `@tumult/ui/sandbox` — binds the runtime to the real Worker globals |
| `packages/ui/src/plugins/styles.ts` | `injectStylesheet` — the owner-tagged `<style>` injector and its CSP guard |
| `packages/ui/src/plugins/lane.ts` | `deriveLane`, `PluginLane`, `SANDBOXABLE_PERMISSIONS` — the trust-lane rule (§11): every-sandboxable → Worker, any component permission → in-page |
| `packages/ui/src/plugins/compat.ts` | `PLUGIN_API_VERSION`, `compareVersions`, `checkManifestCompatibility` — the install-time `minUI`/`minCore` gate |
| `packages/ui/src/plugins/schema.ts` | `validatePluginManifest` + the release `tumult.plugin.json` schema builder |
| `packages/ui/src/plugins/vueBridge.ts` | `installVueBridge` — hands a third-party bundle the host's `vue` (`globalThis.__tumult.vue`), so a bundled copy can `inject()` |
| `packages/ui/src/timeline/registry.ts` | `TimelineRegistry` — renderer resolution by event type; `addRenderer`'s target |
| `packages/ui/src/timeline/composer-actions.ts` | `ComposerActionsRegistry` + `ComposerAction` |
| `packages/ui/src/timeline/commands.ts` | `CommandsRegistry` + `Command` (name normalization, `suggest()`, `resolve()`) |
| `packages/ui/src/members/decorations.ts` | `MemberDecorationsRegistry` + `MemberDecoration` |
| `packages/ui/src/settings/tabs.ts` | `SettingsTabsRegistry` + `SettingsTab` |
| `packages/ui/src/panes/registry.ts` | `WorkspacePanesRegistry` + `WorkspacePane` (`useWorkspacePanes`) — the 6th extension point; `addPane`'s target |
| `packages/ui/src/shell/TumultShell.vue` | constructs the one `PluginRegistry`, provides every key, `defineExpose({ registry, plugins, hrefFor })` |
| `apps/web/src/plugins/showcase.ts` | the app's reference plugins, one per extension point |
| `apps/web/src/plugins/installer.ts` | the network + blob-import half of an install (GitHub fetch, hash verify, `loadPlugin` lane routing) |
| `apps/web/src/plugins/sandbox.worker.ts` | the app's Worker entry for the sandbox lane (one import of `@tumult/ui/sandbox`) |
| `apps/web/src/plugins/store.ts` | IndexedDB persistence for installed third-party plugins |
| `apps/web/src/plugins/controller.ts` | `PluginInstallControls` implementation — prepare → consent → commit → persist, and the boot restore |
| `packages/ui/test/plugins.test.ts` | the registry's unit contract (lifecycle, permissions, isolation) |
| `apps/web/test/browser.test.ts` | one end-to-end assertion per extension point, in a real browser |

The split mirrors the theme package: `packages/ui` owns the **structure** of the
extension points and never decides what is installed; the **app** owns
registration (`apps/web/src/views/AppView.vue` installs the reference plugins).
A host that renders `TumultShell` without installing anything gets a fully
working client with no plugin surface — that is a supported configuration, not
a degraded one.

## 2. Anatomy of a plugin

```ts
import type { Plugin } from "@tumult/ui";

export const shrug: Plugin = {
    manifest: {
        id: "cc.example.shrug",
        name: "Shrug",
        version: "1.0.0",
        author: "You",
        description: "Send a message with ¯\\_(ツ)_/¯ appended.",
        permissions: ["commands"],
    },
    install(ctx) {
        ctx.addCommand({
            name: "shrug",
            description: "Append ¯\\_(ツ)_/¯ to your message",
            usage: "<text>",
            run: ({ args, roomId, client }) =>
                client.send(roomId, args ? `${args} ¯\\_(ツ)_/¯` : "¯\\_(ツ)_/¯"),
        });
    },
};
```

`PluginManifest` — what the plugin says about itself (and what the Plugins tab
lists):

| field | required | notes |
|---|---|---|
| `id` | yes | stable, namespaced (e.g. `cc.example.shrug`). The registry keys installs by it; a second install of the same id is **refused**. |
| `name` | yes | display name in the settings Plugins tab. |
| `version` | yes | display only. |
| `author` | no | display only. |
| `description` | no | display only. |
| `minCore` / `minUI` | no | **enforced at install**: the registry refuses a plugin whose requirement is newer than the running build (`@tumult/core`'s `CONTRACT_VERSION` / `@tumult/ui`'s `PLUGIN_API_VERSION`), naming both versions. Compared as dotted numerics; better to omit than to guess. |
| `permissions` | yes | the enforced part — see §4. Forgetting one makes the matching API call throw. |
| `entry` | release only | filename of the built bundle attached to a release (e.g. `plugin.js`). Absent for plugins compiled into the app; the installer refuses a release manifest without it (§11). |
| `integrity` | release only | `sha256-<base64>` of that bundle, added by the template's release workflow. The installer refuses a download that does not hash to it. |

`Plugin` — the object itself:

| member | notes |
|---|---|
| `manifest` | required. |
| `install(ctx)` | required. Runs **once** per install, **synchronously** (`void \| Disposable`). Return a disposable to undo anything you set up outside `ctx` (timers, subscriptions). |
| `uninstall()` | optional. Runs **after** the context disposables on uninstall — for teardown the context cannot know about. |

## 3. Lifecycle

**Install** (`PluginRegistry.install(plugin)`):

1. Refuses a duplicate `id`.
2. Refuses a plugin demanding a newer `minUI`/`minCore` than this build
   provides (§2).
3. Builds the permission-checked context (§4).
4. Calls `plugin.install(ctx)`.
5. If it throws, **every registration made so far is rolled back** before the
   error is rethrown — a failed install leaves the shell exactly as it was.

**Uninstall** (`PluginRegistry.uninstall(id)`), in this order, each step
individually guarded so one throw never blocks the rest:

1. every context disposable (renderers unregistered, styles removed, …),
2. the disposable `install()` returned, if any,
3. `plugin.uninstall()`, if present.

`uninstall` resolves `false` for an unknown id. Installing again after a
successful uninstall is allowed. `uninstallAll()` runs on shell unmount, so a
re-mount starts clean.

**Disposables are tracked for you.** Every `ctx.*` call returns a `Disposable`
*and* records it, so uninstall reverses the registration even if the plugin
dropped the return value. Calling a disposable twice is a no-op, and a stale
disposable cannot remove a replacement registered under the same key.

**Nothing is persisted here.** The registry is an in-memory `Map` rebuilt each
boot; the app re-installs on mount. There is no plugin-directory scan. If you
want a plugin to be conditionally active, gate the `install()` call in the app.
Third-party plugins are persisted by the *app* (enable/disable, remove), which
then re-registers the enabled ones at boot — see §11.

**Reactivity.** `PluginRegistry.version` is a `Ref` bumped on every install and
uninstall, and each contribution registry has the same version-counter shape.
A consumer that reads `.value` inside a `computed` re-runs when a plugin
registers after first paint — which is the normal case, because the app installs
its plugins once the shell is up. That is also why the Plugins tab updates
without a reload.

## 4. Permissions

`Permission` is a closed union of eight strings; each API demands exactly one:

| permission | API it unlocks |
|---|---|
| `timeline-renderers` | `addRenderer` |
| `composer-actions` | `addComposerAction` |
| `commands` | `addCommand` |
| `member-decorations` | `addMemberDecoration` |
| `activity-renderers` | `addActivityRenderer` |
| `settings-tabs` | `addSettingsTab` |
| `styles` | `injectStylesheet` |
| `workspace-panes` | `addPane` |

Calling an API whose permission is not in `manifest.permissions` throws
immediately — and because the throw happens during `install`, the whole install
rolls back:

```
[tumult] plugin "cc.example.x" tried to use "commands" without declaring it in its manifest
```

This is a **capability declaration, not a security boundary**: it makes a
plugin's reach explicit and auditable (the Plugins tab prints the list, and the
installer shows it before installing), and it catches the "I forgot to declare
it" bug at install time rather than producing a silently missing feature. For a
plugin compiled into the app it is honesty, not enforcement against a hostile
module. For a third-party plugin it is also the input to the lane rule (§11) —
which is why an undeclared permission is a hard failure, and an *unknown*
permission refuses the install outright rather than being ignored.

## 5. The eight APIs

`PluginContext` extends `PluginApi`, so the eight methods below are simply
`ctx.addRenderer(…)`, `ctx.addCommand(…)` and so on. All live in
`packages/ui/src/plugins/api.ts` (permission gate + tracking) over the
per-shell registries in §1.

### 5.1 `addRenderer(type, entry)` — `timeline-renderers`

Renders one Matrix event type in the timeline. The renderer registry resolves by
`message.type`; the built-in `m.room.message` fallbacks are `MediaMessage`
(priority 10, `match`ing media msgtypes) and `TextMessage` (priority 0, no
`match`), and unknown types fall back to `UnknownEvent`.

```ts
addRenderer(type: string, entry: RendererEntry): Disposable

interface RendererEntry {
    component: Component;              // receives { message: MessageView }
    priority: number;                  // REQUIRED. Higher wins.
    match?(message: MessageView): boolean;  // no match → always eligible
}
```

Resolution: within a type's bucket, entries sort by descending `priority`, with
`match`-less entries last **within their priority**; the first entry whose
`match` accepts (or that has none) wins.

`MessageView` carries `type`, `body`, the plain-JSON `content` (the renderer
owns its shape), `status`, `decryption`, `redacted`, `edited`, `reply`,
`reactions`, `readBy`, plus sender fields. Gate on `decryption`/`status`/
`redacted` yourself if a row should not render mid-decryption.

**Example — a custom event type.**

```ts
install(ctx) {
    const ConfettiRow = defineComponent({
        props: { message: { type: Object as PropType<MessageView>, required: true } },
        setup: (props) => () => h("p", { class: "confetti" }, `🎉 ${props.message.body}`),
    });
    ctx.addRenderer("cc.example.confetti", { component: ConfettiRow, priority: 10 });
}
```

**Example — override part of `m.room.message` with `match`.** A higher priority
than a built-in (here 5, above `TextMessage`'s 0 but below `MediaMessage`'s 10)
takes only the messages it claims:

```ts
install(ctx) {
    const CodeBlock = defineComponent({
        props: { message: { type: Object as PropType<MessageView>, required: true } },
        setup: (props) => () =>
            h("pre", [h("code", props.message.body.replace(/^```[^\n]*\n?/, ""))]),
    });
    ctx.addRenderer("m.room.message", {
        component: CodeBlock,
        priority: 5,
        match: (message) => message.body.startsWith("```"),
    });
}
```

**Example — resolve media from a custom payload.** The context's `media` handles
`mxc://` through the client's authenticated media (token refresh included), so a
renderer never builds a URL by hand:

```ts
install(ctx) {
    const SnapshotRow = defineComponent({
        props: { message: { type: Object as PropType<MessageView>, required: true } },
        setup(props) {
            const src = ref<string | null>(null);
            watch(
                () => props.message.content["url"],
                async (url) => {
                    src.value = typeof url === "string" ? await ctx.media.resolve(url, 256) : null;
                },
                { immediate: true },
            );
            return () =>
                src.value === null
                    ? h("p", props.message.body)
                    : h("img", { src: src.value, alt: props.message.body });
        },
    });
    ctx.addRenderer("cc.example.snapshot", { component: SnapshotRow, priority: 10 });
}
```

### 5.2 `addComposerAction(action)` — `composer-actions`

Adds a button to the composer's action row. The action runs only when a room and
client are present (never in the thread composer).

```ts
addComposerAction(action: ComposerAction): Disposable

interface ComposerAction {
    id: string;            // keys the registration
    label: string;         // REQUIRED: accessible name AND tooltip
    icon?: string;         // icon name for the button (see Icons); falls back to label text
    priority?: number;     // higher sorts further LEFT. Default 0.
    run(ctx: ComposerActionContext): void | Promise<void>;
}

interface ComposerActionContext {
    roomId: string;
    draft: string;                                  // exactly as typed when it ran
    client: ChatClient;                             // the same contract the UI uses
    setDraft(text: string): void;                   // replace the draft without sending
}
```

**Example — act on the newest message** (the shape of the shipped `reactLastAction`):
only a settled, decrypted, un-redacted message can take a reaction.

```ts
ctx.addComposerAction({
    id: "cc.example.react-last",
    label: "React to the last message",
    icon: "thumb-up",
    run: (action) => {
        const timeline = action.client.timeline(action.roomId).get();
        const last = [...timeline]
            .reverse()
            .find((message) =>
                message.status === "sent" && message.decryption === "ok" && !message.redacted);
        if (!last) return;
        return action.client.toggleReaction(action.roomId, last.id, "👍");
    },
});
```

**Example — edit the draft without sending.** `setDraft` is the only way an
action touches the composer text:

```ts
const template = "**Yesterday:** …\n**Today:** …\n**Blockers:** none";
ctx.addComposerAction({
    id: "cc.example.standup",
    label: "Insert standup template",
    icon: "clipboard-text",
    run: ({ draft, setDraft }) => {
        setDraft(draft.trim() ? `${draft}\n\n${template}` : template);
    },
});
```

**Example — send straight away.** `priority: 5` sorts it left of default-0
buttons; the return value is awaited by the composer, so an error surfaces in
the same logged-not-thrown path as a failed send:

```ts
const action: ComposerAction = {
    id: "cc.example.shrug-send",
    label: "Send a shrug",
    icon: "emoticon-neutral",
    priority: 5,
    run: ({ roomId, client }) => client.send(roomId, "¯\\_(ツ)_/¯"),
};
ctx.addComposerAction(action);
```

### 5.3 `addCommand(command)` — `commands`

Registers a `/name` command. When the composer's text is `/name args` and the
name resolves, the command runs **instead of** sending the text; an unknown
command (or `//name`) is sent literally, never guessed at.

```ts
addCommand(command: Command): Disposable

interface Command {
    name: string;             // lowercase, without the slash (normalized for you)
    description?: string;     // palette line under the name
    usage?: string;           // palette hint, e.g. "<text>"
    run(ctx: CommandContext): void | Promise<void>;
}

interface CommandContext {
    roomId: string;
    client: ChatClient;
    args: string;             // everything after "/name", trimmed ("" if none)
    raw: string;              // the full typed line, e.g. "/shrug deal with it"
}
```

Names normalize to **one lowercase token** (a leading `/` is stripped; a second
slash or whitespace is refused). The suggestion list is built from `name` +
`description` + `usage`; clicking completes, Enter runs.

**Example — args in, message out** (the shipped `/shrug`):

```ts
ctx.addCommand({
    name: "shrug",
    description: "Append ¯\\_(ツ)_/¯ to your message",
    usage: "<text>",
    run: (command) => {
        const body = command.args ? `${command.args} ¯\\_(ツ)_/¯` : "¯\\_(ツ)_/¯";
        return command.client.send(command.roomId, body);
    },
});
```

**Example — parse args and answer.** A command that validates its own input and
explains itself rather than throwing:

```ts
ctx.addCommand({
    name: "roll",
    description: "Roll dice, e.g. /roll 2d6",
    usage: "<count>d<sides>",
    run: ({ args, roomId, client }) => {
        const match = /^(\d*)d(\d+)$/.exec(args.trim());
        if (!match) return client.send(roomId, "Usage: /roll 2d6");
        const count = Number(match[1] || "1");
        const sides = Number(match[2]);
        const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
        const total = rolls.reduce((sum, roll) => sum + roll, 0);
        return client.send(roomId, `🎲 ${count}d${sides} → ${rolls.join(" + ")} = ${total}`);
    },
});
```

**Example — navigate, through the context.** `run` is not a component, so reach
the shell through `ctx` (here `ctx.selection`), never through an
`inject()`-based hook:

```ts
install(ctx) {
    const { selection } = ctx; // capture: run() has no component instance to inject from
    ctx.addCommand({
        name: "dms",
        description: "Jump to your direct messages",
        run: () => selection.select({ view: "dms" }),
    });
}
```

### 5.4 `addMemberDecoration(decoration)` — `member-decorations`

Renders a small component **after** a member row's built-in badges (Invited /
Banned) — role icons, bot flags, status marks.

```ts
addMemberDecoration(decoration: MemberDecoration): Disposable

interface MemberDecoration {
    id: string;                       // keys the registration
    component: Component;             // receives { member: MemberView, roomId: string }
    priority?: number;                // higher sorts further RIGHT. Default 0.
    match?(member: MemberView): boolean;  // no match → every member
}
```

`match` runs on **every roster rebuild** (presence, power level, renames), so
keep it cheap. `MemberView` gives `userId`, `displayName`, `avatarUrl`,
`membership`, `powerLevel`, `isSelf`, `presence` (`"online" \| "offline" \|
"unknown"`) and `lastActiveTs`.

**Example — a badge for a permission level:**

```ts
const AdminBadge = defineComponent({
    props: { member: { type: Object as PropType<MemberView>, required: true } },
    setup: () => () => h("span", { class: "tumult-admin-badge", title: "Admin" }, "👑"),
});
ctx.addMemberDecoration({
    id: "cc.example.admin-badge",
    component: AdminBadge,
    match: (member) => member.membership === "join" && member.powerLevel >= 100,
});
```

**Example — a convention-based bot flag, ordered after the crown.** Higher
`priority` sits further right:

```ts
const BotBadge = defineComponent({
    props: { member: { type: Object as PropType<MemberView>, required: true } },
    setup: (props) => () => h("span", { class: "tumult-bot-badge" }, props.member.displayName),
});
const bot: MemberDecoration = {
    id: "cc.example.bot-badge",
    component: BotBadge,
    priority: 5,
    match: (member) => member.userId.includes("bot"),
};
ctx.addMemberDecoration(bot);
```

**Example — a presence mark that sorts left of everything** (negative priority):

```ts
const AwayDot = defineComponent({
    props: { member: { type: Object as PropType<MemberView>, required: true } },
    setup: () => () => h("span", { class: "tumult-away-dot", title: "Not online" }, "·"),
});
ctx.addMemberDecoration({
    id: "cc.example.away-dot",
    component: AwayDot,
    priority: -10,
    match: (member) => !member.isSelf && member.presence !== "online",
});
```

### 5.5 `addSettingsTab(tab)` — `settings-tabs`

Adds a page to the settings overlay (the full-screen view the account menu
and the user bar's gear open). Its sidebar is grouped into three sections, in
this order:

| `section` | Heading | The shell's own pages |
|---|---|---|
| `"account"` | User settings | My Account (priority 10), Security (0) |
| `"app"` | App settings | Appearance (10), Themes (0) — only when the app provides theme controls |
| `"plugins"` | Plugins | Installed (100) |

A page that names no section lands under **Plugins**, after the shell's
"Installed" list; `priority` orders pages *within* a section, and a section
with no pages draws no heading. The overlay titles the page with its `title`
and owns the close button, so a page renders only its body — use the shared
`tumult-settings-section` / `tumult-settings-heading` / `tumult-settings-note`
classes to match the built-in pages (consecutive sections get a divider).

```ts
addSettingsTab(tab: SettingsTab): Disposable

interface SettingsTab {
    id: string;                 // keys the registration
    title: string;              // label in the sidebar, and the page title
    component: Component;       // receives { client: ChatClient, close(): void }
    section?: SettingsSection;  // "account" | "app" | "plugins". Default "plugins".
    priority?: number;          // higher sorts earlier within its section. Default 0.
}
```

A tab is a normal component **inside this shell's tree**, so it can also
`inject()` anything the shell provides — the plugin registry, the theme
controls, the media resolvers — on top of its props.

**Example — a tab that reads the client and closes itself:**

```ts
const DiagnosticsTab = defineComponent({
    props: {
        client: { type: Object as PropType<{ connection: unknown }>, required: true },
        close: { type: Function as PropType<() => void>, required: true },
    },
    setup(props) {
        const away = computed(() => String(props.client.connection));
        // A settings tab IS a component: hooks work here.
        const selection = useSelection();
        return () =>
            h("section", [
                h("p", `Connection: ${away.value}`),
                h("button", { onClick: () => selection.select({ view: "dms" }) }, "Go to DMs"),
                h("button", { onClick: props.close }, "Done"),
            ]);
    },
});
ctx.addSettingsTab({ id: "cc.example.diagnostics", title: "Diagnostics", component: DiagnosticsTab });
```

**Example — a tab that shows the active theme.** `useTheme()` is the same seam
the Appearance page uses; it stays registry- and storage-free for the plugin:

```ts
const ThemePeek = defineComponent({
    setup() {
        const theme = useTheme();
        return () => h("p", `Active theme: ${theme.state.value.active}`);
    },
});
const tab: SettingsTab = {
    id: "cc.example.theme-peek",
    title: "Theme",
    component: ThemePeek,
    priority: -5,
};
ctx.addSettingsTab(tab);
```

**Example — a tab that reads the install state.** Read through the registry's
`version` so a plugin installed after the tab first painted still appears:

```ts
const PluginList = defineComponent({
    setup() {
        const plugins = usePluginRegistry();
        const names = computed(() => {
            void plugins.version.value;
            return plugins.list().map((manifest) => manifest.name);
        });
        return () => h("ul", names.value.map((name) => h("li", name)));
    },
});
ctx.addSettingsTab({ id: "cc.example.plugin-list", title: "Mine", component: PluginList });
```

### 5.6 `injectStylesheet(css)` — `styles`

Appends a `<style>` element to the document head, owned by the plugin's manifest
id, and returns a disposable that removes it.

```ts
injectStylesheet(css: string): Disposable
```

The CSS is **not** scoped — the shell has no shadow root, so a plugin's sheet is
app-wide. It is app-authored CSS at the same trust level as the module that
injected it; what the guard buys is that it can never become a **third-party
request**: `@import` and any `url()` other than `data:`, `blob:` or a
same-document `#fragment` throw at install (rolling the plugin back) instead of
failing silently against `style-src 'self'`. The same rule lives in
`@tumult/theme/runtime` and is what the app's own advanced-CSS opt-in uses.

**Example — style a class your renderer emits**, with tokens rather than
literals so an installed theme still drives it (see `docs/themes.md`):

```ts
ctx.injectStylesheet(`
.confetti {
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-pane);
    color: var(--accent);
}
`);
```

**Example — decorate a component another plugin renders.** Injected CSS is
app-wide, so a plugin can style a class it does not own (here the bot badge from
§5.4). Keep the class name namespaced to avoid collisions:

```ts
ctx.injectStylesheet(`.tumult-bot-badge::before { content: "🤖 "; }`);
```

**Refused, on purpose.** Each of these throws at install and rolls the plugin
back — there is no "it just won't load" version:

```ts
ctx.injectStylesheet(`@import url("https://evil.example/x.css");`);   // throws
ctx.injectStylesheet(`.a { background: url(https://cdn.example/i.png); }`); // throws
ctx.injectStylesheet(`.a { background: url(data:image/png;base64,…); }`);   // OK
```

### 5.7 `addPane(pane)` — `workspace-panes`

Adds a **workspace pane**: a top-level screen of the app's own, opened from a
tile in the guild rail. It is the extension point for a plugin that wants a
whole region to itself — a media library, a notes app, a dashboard — rather
than a decoration inside somebody else's region.

```ts
addPane(pane: WorkspacePane): Disposable

interface WorkspacePane {
    id: string;            // keys the registration (namespaced, stable)
    label: string;         // the rail tile's tooltip and accessible name
    icon?: string;         // icon name for the tile (see Icons); defaults to the label's first letter
    priority?: number;     // higher sorts nearer the top of the rail. Default 0.
    content: Component;    // the main area
    sidebar?: Component;   // the left nav (where the channel list normally is)
    footer?: Component;    // the bottom bar (a player, a status strip, …)
}
```

The shell keeps its layout and hands the pane three slots:

| slot | where it lands |
|---|---|
| `sidebar` | the left track — the same place the channel list lives, and the same ☰ toggle collapses it |
| `content` | the main track — where the timeline normally is |
| `footer` | a bar under the workspace, spanning the pane's width |

A pane is opened by selecting it: `ctx.selection.select({ view: "pane", paneId })`,
and `ctx.selection.hrefFor({ view: "pane", paneId })` gives its URL. The shell
renders a rail tile for every registered pane, directly under the DMs button.

The components are normal components **inside the shell's tree**, so they can
`inject()` anything the shell provides (`useSelection`, the plugin registry,
the theme controls) on top of their props. A pane is *not* a replacement for a
region: the shell's own chrome, the rail and the layout stay where they are
(§10).

**Example — a pane with all three slots.**

```ts
install(ctx) {
    ctx.addPane({
        id: "cc.example.library",
        label: "Library",
        icon: "bookshelf",
        content: LibraryView,
        sidebar: LibraryNav,
        footer: NowPlayingBar,
    });
}
```

**Example — opening it from a command.** A pane is just a selection, so a
slash command can open one:

```ts
ctx.addCommand({
    name: "library",
    description: "Open the library",
    run: () => {
        ctx.selection.select({ view: "pane", paneId: "cc.example.library" });
    },
});
```

### Icons

`icon` on a composer action or a workspace pane is an **icon name**, not a glyph.
A bare name (`"thumb-up"`, `"cog"`, `"bookshelf"`) is a [Material Design
Icons](https://pictogrammers.com/library/mdi/) name — Tumult bundles the
library, so any name on that site works. The first-party chrome's icons render
instantly; any other name loads the rest of the set on first use, and shows the
label's initial (a pane) or the label text (a composer action) until — or
instead, if the name is unknown.

A name may carry a pack prefix, `"pack:name"`. Only the built-in `mdi` pack
exists today (a bare name is `mdi:name`), but the registry (`IconRegistry`,
`IconPack`) is built for more: a pack is `resolve(name) → { path, viewBox? }`
(one SVG path, drawn in `currentColor`), so a pack for another library — or a
custom one — keeps its own naming instead of being forced into Material's. A
host adds one with `registry.addPack("solar", pack)`; plugin-supplied packs are
not exposed yet.

Legacy: a string that is not a valid icon name (an emoji, say) still renders as
literal text, so a plugin written against the old glyph API keeps working. New
plugins should use names — emoji do not follow the theme's colour.

### 5.8 `addActivityRenderer(renderer)` — `activity-renderers`

Draws a user's **activity** ("Playing Chess · 12m") in place of their status
line, from one of their extended-profile fields (MSC4133, see §6). Tumult
defines no activity format: the field and its shape belong to the plugin that
registers the renderer, so vanilla Tumult stays spec-only.

```ts
addActivityRenderer(renderer: ActivityRenderer): Disposable

interface ActivityRenderer {
    id: string;                     // keys the registration
    key: string;                    // the profile field to read, e.g. "app.tumult.activity"
    component: Component;           // receives { userId, value, variant: "row" | "self" }
    priority?: number;              // highest wins when several accept. Default 0.
    match?(value: unknown): boolean; // accept a non-null value. Default: any.
}
```

Where it draws:

| `variant` | surface | rule |
|---|---|---|
| `row` | a subtitle under the name in the member list | **one line**, truncated — rows are virtualized on a height estimate |
| `self` | the user bar's status line (still a button that opens the status editor) | one line |

The shell reads only the fields some renderer asks for, and only for members
the virtualizer has mounted — a shell with no activity plugin fetches nothing.
The winner is the highest-priority renderer whose field is non-null and whose
`match` accepts it (a throwing `match` counts as a refusal). With no winner the
surface shows what it showed before: the status message on the user bar,
nothing extra on a member row. Validate the value in `match`: it is whatever
JSON the user's account stored, and any client can write it.

```ts
ctx.addActivityRenderer({
    id: "cc.example.activity",
    key: "cc.example.activity",
    component: ActivityLine,
    match: (value) => typeof (value as { name?: unknown })?.name === "string",
});
```

## 6. The context

Beyond the eight APIs, `PluginContext` is the whole read/write surface a plugin
gets. There is deliberately **no `window`, no `document`, no router and no
storage** — data flows through the same `ChatClient` contract the UI itself
uses.

| member | what it is |
|---|---|
| `manifest` | this plugin's own `PluginManifest` (handy for prefixing ids or reading your permissions). |
| `client` | the `ChatClient` — `rooms`, `timeline(roomId)`, `send`, `toggleReaction`, `members`, `searchUsers`, `createChannel`, `setOwnPresence`, `profileField`/`setProfileField`, `connection`, `media` resolvers, … See `packages/core/src/contract.ts`. |
| `selection` | `{ current, select(next), hrefFor(next) }` — the current room/guild selection and navigation. |
| `actions` | the cross-pane channel to the shell: `requestLeave(target)` and `requestModeration({ kind, roomId, member })` open its dialogs, `requestMarkRead(roomId)` calls the client (a list row has no client of its own). |
| `media` | `resolve(mxcUri, size)`, `resolveDownload(mxcUri)`, `resolveEncrypted(file)` — `mxc://` → loadable URL. |

Presence is on that same client, and it is a **user-level** setting, not a
per-device one: `setOwnPresence(presence, statusMessage?)` writes what every
other Matrix client shows next to your name, and `ownPresence.get()` reads it
back (the same feed the user bar renders). Omitting the message — or passing
whitespace — clears it; `null` means "no status" rather than an empty string.

Two things to know before relying on it. The **presence value is
`"online" | "offline" | "unavailable"`** — `unavailable` is what the user bar
labels "Away"; there is no "invisible". And the status is **shared account
state**: a second plugin (or another device) writing one overwrites yours, so a
"now playing" plugin should write on start and clear on stop rather than fight
for the slot.

```ts
install(ctx) {
    void ctx.client.setOwnPresence("online", "Now playing: Four Tet — Two Thousand and Seventeen");

    // Clear it on teardown; fire-and-forget, since uninstall is synchronous.
    return () => {
        void ctx.client.setOwnPresence("online");
    };
}
```

**Extended profile fields** (MSC4133) are the place for structured, public,
per-user data such as an activity: `setProfileField(key, value)` writes one of
your own (`null` deletes it), and `profileField(userId, key)` reads anyone's as
a cached `Subscribable` (the same instance per user and key). Keys must be
namespaced (`cc.example.field`); `displayname`/`avatar_url` are refused. Profile
fields do not arrive through sync, so another user's change shows up on a later
read (the cache holds an answer for a few minutes), not live. Not every
homeserver supports them: check `profileFieldsSupported()` first. Without
support, reads are `null` and writes reject, so a plugin that wants its data
seen everywhere should also mirror a plain-text version into the status message.

Snapshots are read with `.get()` and watched with `.subscribe(listener)`, which
returns a `Subscription` you call `.unsubscribe()` on:

```ts
install(ctx) {
    const stop = ctx.addCommand({
        name: "leave-here",
        run: ({ roomId }) => {
            const room = ctx.client.rooms.get().find((candidate) => candidate.id === roomId);
            if (room) {
                ctx.actions.requestLeave({ id: room.id, name: room.name, isSpace: room.isSpace });
            }
        },
    });

    const href = ctx.selection.hrefFor({ view: "guild", guildId: "!space:example.org" });
    void href;

    const subscription = ctx.client.connection.subscribe((state) => {
        console.log("connection", state);
    });

    // Return a teardown for what the context does not own (the subscription).
    return () => {
        stop();
        subscription.unsubscribe();
    };
}
```

`install` is synchronous. Anything you must *await* (a media fetch, a first
snapshot) happens inside a callback or a floating async function you clean up in
`uninstall()` — the registry does not wait for promises returned from `install`.

## 7. Authoring walkthrough

A plugin from nothing to a live affordance, end to end.

This walkthrough adds a plugin **compiled into the app** (the simplest path, and
the only one available to a plugin that renders components *and* needs no
distribution). To ship a plugin other people can install from a URL, start from
`templates/plugin/` instead — see §11.

**1. Write the module.** One file, no build step of its own — it is app code:

```ts
// apps/web/src/plugins/dice.ts
import { defineComponent, h, type PropType } from "vue";
import type { MessageView } from "@tumult/core";
import type { Plugin } from "@tumult/ui";

export const dice: Plugin = {
    manifest: {
        id: "cc.example.dice",
        name: "Dice",
        version: "0.1.0",
        author: "You",
        description: "Renders cc.example.dice events and adds /roll.",
        permissions: ["timeline-renderers", "commands", "styles"],
    },
    install(ctx) {
        ctx.injectStylesheet(`.cc-dice { font-variant-numeric: tabular-nums; }`);

        const DiceRow = defineComponent({
            props: { message: { type: Object as PropType<MessageView>, required: true } },
            setup: (props) => () => h("p", { class: "cc-dice" }, String(props.message.content["total"])),
        });
        ctx.addRenderer("cc.example.dice", { component: DiceRow, priority: 10 });

        ctx.addCommand({
            name: "dice",
            description: "Show the last dice result",
            run: ({ roomId, client }) =>
                client.send(roomId, String(client.timeline(roomId).get().length)),
        });
    },
};
```

**2. Register it from the app**, where the shell ref is live. In
`apps/web/src/views/AppView.vue` the installs run after `await client.start()`
and after the template has mounted, so `shell.value` exists:

```ts
onMounted(async () => {
    // …restore the session and start the client…
    shell.value?.plugins.install(dice);
});
```

Installing before the shell is mounted throws on `shell.value` being `null`;
installing the same `id` twice throws. Both are loud on purpose.

**3. See it.** The plugin's affordances appear immediately (the contribution
registries are reactive, §3) and the **Plugins** tab in Settings lists its
manifest and permissions. Uninstall by calling
`shell.value.plugins.uninstall("cc.example.dice")` — everything it registered
comes back out.

## 8. Host embedding

`TumultShell` builds all of this for you: one `PluginRegistry` per shell,
`provide`d under `PluginsKey` (plus a key per contribution registry), and exposed
on the component instance so a parent can install:

```ts
const shell = ref<InstanceType<typeof TumultShell> | null>(null);
shell.value?.plugins.install(myPlugin);
```

| injected under | value | accessor |
|---|---|---|
| `PluginsKey` | `PluginRegistry` | `usePluginRegistry()` (throws outside a shell) |
| `RegistryKey` | `TimelineRegistry` | `useTimelineRegistry()` (throws) |
| `ComposerActionsKey` | `ComposerActionsRegistry` | `useComposerActions()` → `null` outside a shell |
| `CommandsKey` | `CommandsRegistry` | `useCommands()` → `null` outside a shell |
| `MemberDecorationsKey` | `MemberDecorationsRegistry` | `useMemberDecorations()` (throws) |
| `SettingsTabsKey` | `SettingsTabsRegistry` | `useSettingsTabs()` (throws) |
| `SelectionKey` | `SelectionContext` | `useSelection()` (throws) |
| `ActionsKey` | `ActionsContext` | `useActions()` (throws) |
| `MediaKey` / `MediaDownloadKey` | media resolvers | `useMediaResolver()` / `useMediaDownloadResolver()` → `undefined` outside a shell (the encrypted-media key is internal to `@tumult/ui`) |

If you are not rendering `TumultShell` — a harness, a story, a different shell —
construct the registry yourself from `PluginDeps`:

| `PluginDeps` field | what to pass |
|---|---|
| `client` | a `ChatClient` (the fake from `@tumult/core/fake` is a valid stand-in). |
| `timeline`, `composerActions`, `commands`, `memberDecorations`, `settingsTabs` | fresh per-shell registry instances. |
| `selection`, `actions` | your `SelectionContext` / `ActionsContext` implementations. |
| `media` | `{ resolve, resolveDownload, resolveEncrypted }` — wire to the client's media methods. |
| `injectStylesheet(css, owner)` | the DOM injector; `PluginRegistry` binds each plugin's id (or `"shell"`) as the owner. |

```ts
const plugins = new PluginRegistry({
    client,
    timeline: new TimelineRegistry(),
    composerActions: new ComposerActionsRegistry(),
    commands: new CommandsRegistry(),
    memberDecorations: new MemberDecorationsRegistry(),
    settingsTabs: new SettingsTabsRegistry(),
    selection,
    actions,
    media,
    injectStylesheet,
});
plugins.install(myPlugin);
```

The registry also exposes **unpermissioned** `addRenderer` / `addComposerAction`
/ `addCommand` / `addMemberDecoration` / `addSettingsTab` / `injectStylesheet`
for the **shell's own** built-ins (the built-in renderers and settings tabs go
through exactly these). Use `install()` for anything you would call a plugin;
the unpermissioned methods exist so the shell does not have to fake a manifest.

## 9. Testing a plugin

The registry is per-shell and dependency-injected, so a unit test constructs one
over stubs and asserts the registrations — no DOM, no Vue mounting. This is the
pattern in `packages/ui/test/plugins.test.ts`:

```ts
import { PluginRegistry } from "@tumult/ui";

const plugins = new PluginRegistry({
    client: {} as ChatClient,
    timeline: new TimelineRegistry(),
    composerActions: new ComposerActionsRegistry(),
    commands: new CommandsRegistry(),
    memberDecorations: new MemberDecorationsRegistry(),
    settingsTabs: new SettingsTabsRegistry(),
    selection: {} as SelectionContext,
    actions: {} as ActionsContext,
    media: { resolve: async () => "", resolveDownload: async () => "", resolveEncrypted: async () => "" },
    injectStylesheet: (css, owner) => { /* record it */ return () => { /* remove it */ }; },
});

plugins.install(myPlugin);
assert.ok(plugins.has("cc.example.dice"));

plugins.uninstall("cc.example.dice");
assert.equal(plugins.has("cc.example.dice"), false);
```

What the suite pins, and what a new plugin should be tested against:

- install registers through the context; uninstall removes it (`has`, `list`);
- a duplicate install is refused;
- an undeclared permission throws **and** leaves no residue (rollback);
- a throw inside `install()` rolls back what was registered before it;
- install teardown runs before `plugin.uninstall()`, and a throwing
  `uninstall()` does not break the rest;
- two registries do not share state (per-shell isolation).

Run them (build `theme` and `core` first — `ui` resolves them through `dist`):

```sh
pnpm --filter @tumult/theme build && pnpm --filter @tumult/core build
pnpm --filter @tumult/ui test        # the registry's unit contract
pnpm --filter @tumult/ui emit:schema # after changing the manifest schema
pnpm --filter @tumult/web test:browser   # one live assertion per extension point
```

The browser suite (`apps/web/test/browser.test.ts`) is the only place the
**rendered** result is asserted: the demo poll renders, the composer action
button appears and reacts, `/shrug` shows its suggestion and sends, the admin
crown renders, and the plugin settings tab exists with its injected stylesheet
applied. A plugin that only extends a component-level surface should add its
assertion there.

This document is guarded too: `packages/ui/test/docs.test.ts` parses the fenced
code here and fails if it declares a permission or calls a `ctx.*` API that does
not exist, imports a name `@tumult/ui` does not export, or forgets to document
one of the seven permissions or seven APIs. Change the API and that test names the
stale line. The release schema is guarded separately:
`packages/ui/test/plugin-schema.test.ts` fails when the committed schema files
drift from the builder, when the schema and the runtime validator disagree, or
when the lane rule and the permission list fall out of step.

## 10. Deliberately not supported

- **No central gatekeeper, and no gallery yet.** Any GitHub repository installs
  (§11): there is no review queue and no allowlist. An index of *curated*
  repositories (the theme gallery's analogue) is planned, but it can only ever
  add a label to a hash — it will never be required to install.
- **No silent updates.** Nothing polls or replaces an installed plugin behind
  your back. An update is a user action, and a version that asks for **new**
  permissions re-opens the consent screen.
- **No shell/pane replacement.** A plugin can *add* a region of its own
  (§5.7), but it cannot replace one, reorder the shell or take over a region it
  was not given — the extension points decorate and add, they do not
  restructure. This keeps the layout stable and predictable.
- **No patch/hook type.** The `Patch` type from the original sketch is dropped
  on purpose: plugins register modules; nothing rewrites code strings on a live
  object.
- **No crypto/security API in the context.** A plugin gets the `ChatClient`
  surface, not verification, key backup or secret storage.
- **No `window`/`document` in the context.** Style through `injectStylesheet`
  (guarded, §5.6); there is no arbitrary DOM handle. (The *in-page* lane can
  reach the DOM by importing it directly — that is exactly why it is the
  trusted lane and why the consent screen says so.)

## 11. Third-party plugins (install, verify, persist)

The extension API above does not care where a `Plugin` object came from. This
section is about the path that produces one from a URL.

### The release manifest

A distributable plugin repository publishes two things on every release (the
template's workflow does both, §12):

| artifact | contents |
|---|---|
| the bundle | the built ESM module named by `entry` (e.g. `plugin.js`) |
| `tumult.plugin.json` | the manifest plus `entry` and `integrity` |

`docs/plugin.schema.json` describes that document; the template ships a copy as
`tumult.plugin.schema.json` so an editor validates it while you write.
`validatePluginManifest(value, { requireIntegrity: true })` is the runtime
check the installer runs before downloading anything. Unknown *top-level* fields
are tolerated (a newer template must not brick an older client); an unknown
**permission** is refused, because consent cannot be shown for a capability the
client cannot name.

### The lane, derived from permissions

```ts
import { deriveLane } from "@tumult/ui";

deriveLane({ permissions: ["commands", "styles"] });          // "sandbox"
deriveLane({ permissions: ["timeline-renderers"] });          // "trusted"
```

| lane | how it loads | what it may declare |
|---|---|---|
| `sandbox` | the bundle is loaded and run **inside a Worker**; every shell touch is an RPC over the bridge | `commands`, `composer-actions`, `styles` |
| `trusted` | the bundle is loaded **in-page**, at the app's trust level | anything, including component permissions (`timeline-renderers`, `member-decorations`, `activity-renderers`, `settings-tabs`, `workspace-panes`) |

Nothing in the manifest chooses this. `deriveLane` reads the declared
permissions, and the consent screen prints the resulting lane in plain words.

### The install flow

1. Paste a repository URL (`https://github.com/owner/repo`, `owner/repo` or a
   `…/tree/<ref>` link). The app asks GitHub's API for the release — CORS-open,
   so the release JSON reaches the browser directly — and takes its `tumult.plugin.json`
   asset if there is one, otherwise the file at the tag.
2. The manifest is validated (`requireIntegrity: true`) and the lane derived.
3. **Consent.** The app shows the name, author, source link, version, the exact
   permission list, the lane badge and the hash. For a `trusted` plugin the
   screen says, without hedging, that the plugin runs as part of the app and a
   malicious one could read what the app can read. Nothing is downloaded until
   you accept.
4. The bundle is fetched and hashed (`sha256-<base64>` via WebCrypto); a
   mismatch refuses the install and names both hashes.

### Fetching release assets (a hard browser constraint)

GitHub release assets are **not** fetchable cross-origin from a browser. Both
the `browser_download_url` (`github.com/…/releases/download/…`) and the API
asset URL (`api.github.com/…/releases/assets/{id}` with
`Accept: application/octet-stream`) 302-redirect to
`release-assets.githubusercontent.com`, which sends no
`Access-Control-Allow-Origin` — so a tab on `tumult.jackg.cc` cannot read the
bytes, and the fetch throws a `NetworkError`. Only `api.github.com` JSON,
`raw.githubusercontent.com` and jsDelivr answer with open CORS, and none of
those *serves a release asset*.

The app's own deployment therefore proxies the two asset downloads. Each goes to
`/api/plugin-asset?owner=&repo=&tag=&name=` on the app's origin
(`apps/web/api/plugin-asset.ts`), which fetches
`github.com/{owner}/{repo}/releases/download/{tag}/{name}` **server-side** and
forwards the bytes. The proxy is not open: it reconstructs the upstream URL from
four validated path segments (owner, repo, tag, asset name), so it is not a
general fetch-as-a-service. The integrity hash in step 4 still runs on the
proxied bytes — the proxy can deny service, but cannot tamper past the hash.
The raw-file fallback (a repo with no release) fetches
`raw.githubusercontent.com` directly, which is already CORS-open. A self-hosted
deployment must ship its own equivalent endpoint; the installer assumes the
`/api/plugin-asset` route exists.
5. The manifest is stored, the bundle is stored as text, and the plugin is
   installed through `PluginRegistry.install()` — so §3's rollback and
   disposables apply unchanged, and a throw during install means nothing was
   persisted. Before `install()` runs, the loaded bundle's own exported
   `manifest` is cross-checked against the one the user consented to: a bundle
   that declares a different id, or a permission the consent screen never
   showed, is refused. Consent is for the manifest, so the manifest has to be
   the truth.

Re-installing is the same flow, so a **changed permission list always re-asks**;
there is no path where new capabilities arrive without a consent screen.

### How the sandbox lane actually runs

A `sandbox`-lane plugin never executes in the page. `loadPlugin` hands the
verified bundle to `sandboxPlugin()`, which returns a `Plugin` facade — from
`PluginRegistry`'s point of view an ordinary plugin, same lifecycle and same
permission gate. Its `install(ctx)` boots a module Worker
(`apps/web/src/plugins/sandbox.worker.ts`, which is one import of
`@tumult/ui/sandbox`), posts the bundle text plus the consented manifest, and
then answers the Worker's requests against the real `ctx` the shell provided.

The plugin's `ctx` inside the Worker is the *same shape* as the in-page one, with
five differences the boundary forces:

- **Feeds become pushes.** `client.rooms`, `client.timeline(roomId)` and the rest
  are opened once by key; `.get()` returns the latest snapshot the host pushed,
  and `.subscribe()` fires on each push.
- **`media.resolve*` mints its own URL.** A `blob:` URL made on the host is
  unreachable in a Worker, so the resolvers fetch the bytes through the client
  and build a Worker-local `blob:` URL. That is also why they are `async`.
- **Functions stay in the Worker.** A command's `run` (and any other callback) is
  kept in a Worker-side table; the contribution the host receives carries
  `{ kind: "callback", id }` in its place, and the host calls back with `invoke`
  when the command actually runs.
- **The two synchronous members are snapshots.** `supportsThreads()` and
  `hasMoreRooms()` cannot await across a boundary, so their values ride along
  with the init/handshake messages rather than being guessed.
- **Component permissions are refused.** `addRenderer`, `addMemberDecoration` and
  `addSettingsTab` throw with "require the trusted lane" — the lane rule already
  excludes a plugin that declares them, so this is a backstop, not a path.

Because the host applies every contribution through the real `ctx`, a sandbox
plugin hits the **same** `api.ts` permission gate as an in-page one; there is no
second gate to keep in step. And because deaths are asynchronous, a Worker crash,
a throwing `install()` or a bundle that will not import is reported through
`SandboxHost.onFailed`, which uninstalls the plugin and disables its record —
a dead plugin is never left registered pretending to work.

### What the app stores, and why it re-verifies

Each install is one record — id, repository, tag, manifest, lane, the bundle
text and its hash, enabled flag (`apps/web/src/plugins/store.ts`, a dedicated
IndexedDB database so a plugin install can never touch the SDK's sync or crypto
store). On every boot the app re-hashes the stored bundle before loading it, so
a corrupted or hand-edited store entry fails closed: the controller disables it
rather than running it. The lane is re-derived from the stored manifest on load
too, so editing the store cannot move a plugin from the trusted lane into the
sandbox one. Disabling keeps the record (and the consented hash) so re-enabling
is offline; removing drops both `@tumult/ui`'s registration and the record.

Honest limitation: hashing pins *what was downloaded*, not *what the author
meant*. A plugin that bundles something malicious and hashes it honestly is
still malicious — the hash stops tampering and drift, not intent. That is what
the lane badge and the consent copy are for.

### What the host must allow

CSP needs `blob:` in `script-src` (the trusted lane imports a blob URL) —
`worker-src 'self' blob:` is already there for the sandbox lane. In this repo the
policy is one constant in `apps/web/vite.config.ts` applied to **both** the dev
server and `vite preview`, so the browser smoke test (which runs against
`preview`) actually exercises it. Hosts that render `TumultShell` without the
installer simply have no install UI: the extension API itself is unchanged and
needs no CSP relaxation.

## 12. Publishing a plugin (the template)

`templates/plugin/` is the canonical template repository. Copy it (or use it as
a GitHub *template*), edit `tumult.plugin.json` and `src/index.ts`, tag a
release, and the workflow builds the bundle, hashes it, injects `integrity` and
attaches both artifacts. Pasting that repository URL is then the whole install
story for your users. The template's README is the author-facing walkthrough;
the type definitions it vendors (`types/plugin.d.ts`) are **generated** — never
hand-edited — from `packages/ui/src/plugins/authoring.ts` by
`packages/ui/scripts/build-plugin-types.ts`, pinned to `PLUGIN_API_VERSION`, and
guarded three ways: `packages/ui/test/plugin-types.test.ts` fails when the
committed file drifts from the generator, and `templates/plugin`'s two typecheck
configurations pin the vendored surface against the real API (the author-facing
`tsconfig.json` against the file itself, `tsconfig.workspace.json` against the
workspace sources). Changing the plugin surface means editing `authoring.ts`,
running `pnpm --filter @tumult/ui emit:types`, and committing the result.
