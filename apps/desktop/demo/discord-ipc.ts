/**
 * A reference Discord-IPC producer — the "any app that already speaks Discord
 * RPC" path into Tumult's native activity feed.
 *
 * It handshakes on a local `discord-ipc-N` socket, sends one `SET_ACTIVITY`
 * frame, and clears on exit. That is exactly the shape Cider and other
 * Discord-RPC producers already send, so it is a quick manual check of the sink
 * without changing a real app's configuration. Run it with the desktop app
 * open; the released Rich Presence plugin shows the result in the user bar.
 *
 * Usage: `node demo/discord-ipc.ts [options]`; see --help.
 */
import process from "node:process";
import { connect, type Socket } from "node:net";

import { DISCORD_OP, DiscordFrameFramer, encodeDiscordFrame } from "../src/discord-ipc.ts";
import type { DiscordFrame } from "../src/discord-ipc.ts";
import { discordIpcSocketPaths } from "../src/discord-ipc-server.ts";

type ActivityType = "playing" | "listening" | "watching" | "custom";

interface ButtonArg {
    label: string;
    url: string;
}

interface Args {
    path: string | undefined;
    type: ActivityType;
    app: string;
    details: string | undefined;
    state: string | undefined;
    album: string | undefined;
    buttons: ButtonArg[];
    clear: boolean;
    durationMs: number | null;
}

const DISCORD_TYPES: Record<ActivityType, number> = {
    playing: 0,
    listening: 2,
    watching: 3,
    custom: 5,
};

const HELP = `Tumult Discord IPC — a reference rich-presence producer.

Options:
  --path <path>       Exact IPC socket/pipe. Default: scan Discord's 0-9 indices.
  --type <type>       playing | listening | watching | custom. Default "listening".
  --app <name>        Application name (e.g. "Cider"). Default "Cider".
  --details <text>    Discord's details line — for music, the track title.
  --state <text>      Discord's state line — for music, the artist.
  --album <text>      assets.large_text — shown as the album/medium line.
  --button <label> <url>
                       A rich-presence link; repeat up to two times.
   --clear             Send an empty activity, then exit.
  --duration <sec>    Clear and exit after N seconds. Default: until Ctrl-C/SIGTERM.
  -h, --help          Show this help.

Examples:
  node demo/discord-ipc.ts --details "Song" --state "Artist" --album "Record"
  node demo/discord-ipc.ts --clear
`;

function value(key: string, argv: string[]): string | undefined {
    const at = argv.indexOf(`--${key}`);
    if (at === -1) return undefined;
    const next = argv[at + 1];
    return next && !next.startsWith("--") ? next : undefined;
}

function buttonValues(argv: string[]): ButtonArg[] {
    const out: ButtonArg[] = [];
    for (let at = 0; at < argv.length - 2; at += 1) {
        if (argv[at] !== "--button") continue;
        const label = argv[at + 1]!;
        const url = argv[at + 2]!;
        if (!label.startsWith("--") && !url.startsWith("--")) out.push({ label, url });
        at += 2;
    }
    return out;
}

function parseArgs(argv: string[]): Args {
    if (argv.includes("--help") || argv.includes("-h")) {
        process.stdout.write(HELP);
        process.exit(0);
    }
    const typeRaw = (value("type", argv) ?? "listening") as ActivityType;
    if (!(typeRaw in DISCORD_TYPES)) throw new Error(`unknown activity type: ${typeRaw}`);
    const durationRaw = value("duration", argv);
    return {
        path: value("path", argv),
        type: typeRaw,
        app: value("app", argv) ?? "Cider",
        details: value("details", argv),
        state: value("state", argv),
        album: value("album", argv),
        buttons: buttonValues(argv).slice(0, 2),
        clear: argv.includes("--clear"),
        durationMs: durationRaw ? Math.max(0, Number(durationRaw) * 1000) : null,
    };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message: string) => process.stdout.write(`[discord-ipc] ${message}\n`);

/** Try every candidate for up to 30 s: a producer may start before Tumult. */
async function connectProducer(args: Args): Promise<{ socket: Socket; path: string }> {
    const paths = args.path ? [args.path] : discordIpcSocketPaths();
    const deadline = Date.now() + 30_000;
    for (;;) {
        for (const path of paths) {
            try {
                const socket = await new Promise<Socket>((resolve, reject) => {
                    const candidate = connect(path);
                    candidate.once("error", reject);
                    candidate.once("connect", () => {
                        candidate.off("error", reject);
                        resolve(candidate);
                    });
                });
                return { socket, path };
            } catch {
                // Try the next index, then the next pass.
            }
        }
        if (Date.now() >= deadline) throw new Error(`no Discord IPC endpoint accepted a connection (tried ${paths.length} paths)`);
        await delay(500);
    }
}

async function main(): Promise<void> {
    let args: Args;
    try {
        args = parseArgs(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${HELP}`);
        process.exitCode = 2;
        return;
    }

    const { socket, path } = await connectProducer(args);
    log(`connected to ${path}`);
    const framer = new DiscordFrameFramer();
    const received: DiscordFrame[] = [];
    socket.on("data", (chunk) => received.push(...framer.push(chunk)));
    const waitFor = async (predicate: (frame: DiscordFrame) => boolean) => {
        const deadline = Date.now() + 5000;
        while (!received.some(predicate)) {
            if (Date.now() >= deadline) throw new Error("Tumult did not answer the IPC frame");
            await delay(10);
        }
    };

    socket.write(encodeDiscordFrame(DISCORD_OP.HANDSHAKE, { v: 1, client_id: "tumult-demo" }));
    await waitFor((frame) => frame.payload?.evt === "READY");

    let shuttingDown = false;
    const setActivity = async (activity: Record<string, unknown> | null, nonce: string) => {
        socket.write(
            encodeDiscordFrame(DISCORD_OP.FRAME, {
                cmd: "SET_ACTIVITY",
                nonce,
                args: { pid: process.pid, activity },
            }),
        );
        await waitFor((frame) => frame.payload?.nonce === nonce);
    };
    const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        if (!args.clear) {
            log("exiting — clearing the activity");
            await setActivity(null, "demo-clear");
        }
        socket.destroy();
        process.exit(0);
    };
    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());

    if (args.clear) {
        await setActivity(null, "demo-clear");
        socket.destroy();
        log("cleared");
        return;
    }

    const activity: Record<string, unknown> = { type: DISCORD_TYPES[args.type], name: args.app };
    if (args.details) activity.details = args.details;
    if (args.state) activity.state = args.state;
    if (args.album) activity.assets = { large_text: args.album };
    if (args.buttons.length) activity.buttons = args.buttons;
    activity.timestamps = { start: Math.floor(Date.now() / 1000) };
    await setActivity(activity, "demo-set");
    log(`reporting (${args.type}) ${[args.app, args.details, args.state, args.album].filter(Boolean).join(" — ")}`);

    if (args.durationMs !== null) {
        const timer = setTimeout(() => void shutdown(), Math.max(args.durationMs, 1));
        timer.unref?.();
    }
}

void main();
