# Plugins — the extension API

Created: 2026-10-15
Scope: the per-shell, built-in plugin/extension API (Vencord-like).
Companion to `docs/themes.md` (theming, which shares the same
"structure lives in code, values live in documents" split). Reference for
`packages/ui/src/plugins/`.

## TL;DR

- A plugin is a plain **TypeScript module** the app registers at runtime:
  a `manifest` plus `install(ctx)`. Nothing is fetched, parsed from a string or
  evaluated — there is no `eval`, no remote script, no manifest file on disk.
- It extends the shell through **six** APIs — timeline renderers, composer
  actions, slash commands, member decorations, settings tabs and stylesheets.
  Each one is gated by a **permission** the manifest declares.
- Everything a plugin registers is a **disposable**. Uninstall reverses all of
  it, and an install that throws is rolled back atomically — a half-installed
  plugin leaves no residue.
- The registry is **per shell** (provide/inject via `PluginsKey`), never a
  module singleton, so two shells on one page cannot share install state.
  Installs are in-memory only: the app re-registers its plugins on every boot.
- Trust model, stated plainly: plugins are **app-authored code** at the app's
  own trust level (Vencord/BetterDiscord capability, first-party trust). The
  context deliberately carries no `window`/`document` handles, but this is an
  **extension seam, not a sandbox** against hostile code.
- A plugin callback is **not** a component: use `ctx` inside `install`, `run`
  and `match`. The `inject()`-based hooks (`useSelection`, `usePluginRegistry`,
  …) only work inside components — renderers, decorations and settings tabs.

## 1. Where plugins live

| path | holds |
|---|---|
| `packages/ui/src/plugins/types.ts` | the contract: `Plugin`, `PluginManifest`, `PluginContext`, `PluginApi`, `PluginDeps`, `Permission`, `Disposable` |
| `packages/ui/src/plugins/api.ts` | the permission-checked, disposable-tracking API handed to `install(ctx)` |
| `packages/ui/src/plugins/registry.ts` | `PluginRegistry` (lifecycle, rollback, ordering) + `PluginsKey` / `usePluginRegistry` |
| `packages/ui/src/plugins/contributions.ts` | `ContributionList<T>` — the shared keyed registry behind three of the APIs |
| `packages/ui/src/plugins/styles.ts` | `injectStylesheet` — the owner-tagged `<style>` injector and its CSP guard |
| `packages/ui/src/timeline/registry.ts` | `TimelineRegistry` — renderer resolution by event type; `addRenderer`'s target |
| `packages/ui/src/timeline/composer-actions.ts` | `ComposerActionsRegistry` + `ComposerAction` |
| `packages/ui/src/timeline/commands.ts` | `CommandsRegistry` + `Command` (name normalization, `suggest()`, `resolve()`) |
| `packages/ui/src/members/decorations.ts` | `MemberDecorationsRegistry` + `MemberDecoration` |
| `packages/ui/src/settings/tabs.ts` | `SettingsTabsRegistry` + `SettingsTab` |
| `packages/ui/src/shell/TumultShell.vue` | constructs the one `PluginRegistry`, provides every key, `defineExpose({ registry, plugins, hrefFor })` |
| `apps/web/src/plugins/showcase.ts` | the app's reference plugins, one per extension point |
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
| `minCore` / `minUI` | no | **declared but not enforced**: nothing reads them today. They document intent for a future compatibility check; do not rely on them to gate anything. |
| `permissions` | yes | the enforced part — see §4. Forgetting one makes the matching API call throw. |

`Plugin` — the object itself:

| member | notes |
|---|---|
| `manifest` | required. |
| `install(ctx)` | required. Runs **once** per install, **synchronously** (`void \| Disposable`). Return a disposable to undo anything you set up outside `ctx` (timers, subscriptions). |
| `uninstall()` | optional. Runs **after** the context disposables on uninstall — for teardown the context cannot know about. |

## 3. Lifecycle

**Install** (`PluginRegistry.install(plugin)`):

1. Refuses a duplicate `id`.
2. Builds the permission-checked context (§4).
3. Calls `plugin.install(ctx)`.
4. If it throws, **every registration made so far is rolled back** before the
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

**Nothing is persisted.** The registry is an in-memory `Map` rebuilt each boot;
the app re-installs on mount. There is no "enable/disable a plugin" store, no
plugin directory scan. If you want a plugin to be conditionally active, gate the
`install()` call in the app.

**Reactivity.** `PluginRegistry.version` is a `Ref` bumped on every install and
uninstall, and each contribution registry has the same version-counter shape.
A consumer that reads `.value` inside a `computed` re-runs when a plugin
registers after first paint — which is the normal case, because the app installs
its plugins once the shell is up. That is also why the Plugins tab updates
without a reload.

## 4. Permissions

`Permission` is a closed union of six strings; each API demands exactly one:

| permission | API it unlocks |
|---|---|
| `timeline-renderers` | `addRenderer` |
| `composer-actions` | `addComposerAction` |
| `commands` | `addCommand` |
| `member-decorations` | `addMemberDecoration` |
| `settings-tabs` | `addSettingsTab` |
| `styles` | `injectStylesheet` |

Calling an API whose permission is not in `manifest.permissions` throws
immediately — and because the throw happens during `install`, the whole install
rolls back:

```
[tumult] plugin "cc.example.x" tried to use "commands" without declaring it in its manifest
```

This is a **capability declaration, not a security boundary**: it makes a
plugin's reach explicit and auditable (the Plugins tab prints the list), and it
catches the "I forgot to declare it" bug at install time rather than producing a
silently missing feature. Plugins are app code; the permission list is honesty,
not enforcement against a hostile module.

## 5. The six APIs

`PluginContext` extends `PluginApi`, so the six methods below are simply
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
    icon?: string;         // glyph in the button; falls back to label text
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
    icon: "👍",
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
    icon: "📋",
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
    icon: "🤷",
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

Adds a tab to the settings dialog (opened from the account menu). The shell
contributes its own tabs (`Appearance` at priority 10, `Plugins` at 0); plugin
tabs default after them.

```ts
addSettingsTab(tab: SettingsTab): Disposable

interface SettingsTab {
    id: string;            // keys the registration
    title: string;         // label in the tab strip
    component: Component;  // receives { client: ChatClient, close(): void }
    priority?: number;     // higher sorts earlier. Default 0.
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
the Appearance tab uses; it stays registry- and storage-free for the plugin:

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

## 6. The context

Beyond the six APIs, `PluginContext` is the whole read/write surface a plugin
gets. There is deliberately **no `window`, no `document`, no router and no
storage** — data flows through the same `ChatClient` contract the UI itself
uses.

| member | what it is |
|---|---|
| `manifest` | this plugin's own `PluginManifest` (handy for prefixing ids or reading your permissions). |
| `client` | the `ChatClient` — `rooms`, `timeline(roomId)`, `send`, `toggleReaction`, `members`, `searchUsers`, `createChannel`, `connection`, `media` resolvers, … See `packages/core/src/contract.ts`. |
| `selection` | `{ current, select(next), hrefFor(next) }` — the current room/guild selection and navigation. |
| `actions` | the cross-pane dialog channel: `requestLeave(target)`, `requestModeration({ kind, roomId, member })`. |
| `media` | `resolve(mxcUri, size)`, `resolveDownload(mxcUri)`, `resolveEncrypted(file)` — `mxc://` → loadable URL. |

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
one of the six permissions or six APIs. Change the API and that test names the
stale line.

## 10. Deliberately not supported

- **No remote or user-supplied plugins.** Nothing is fetched, scanned from a
  directory, or evaluated from a string. Plugins are TypeScript modules compiled
  into the app; installing one means adding it to app code. (A gallery like the
  theme one is conceivable later, but it would install *code*, which is a
  different trust decision than a theme document.)
- **No persistence or enable/disable UI.** The registry is per-shell and
  in-memory; the Plugins tab lists, it does not toggle. Conditional activation
  is the app's `install()` call.
- **No shell/pane replacement.** There is no API to replace a pane, reorder the
  shell or take over a region — the extension points decorate and add, they do
  not restructure. This keeps the layout stable and predictable.
- **No patch/hook type.** The `Patch` type from the original sketch is dropped
  on purpose: plugins register modules; nothing rewrites code strings, so a
  patch API would promise a surface we do not want.
- **No crypto/security API in the context.** A plugin gets the `ChatClient`
  surface, not verification, key backup or secret storage.
- **No `window`/`document` in the context.** Style through `injectStylesheet`
  (guarded, §5.6); there is no arbitrary DOM handle.
- **`minCore`/`minUI` are not enforced** (§2). They are inert metadata today.
