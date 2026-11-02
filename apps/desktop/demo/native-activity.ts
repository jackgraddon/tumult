/**
 * A reference native client for Tumult's rich-presence RPC — the template a real
 * native app on this machine would link against to report "what I'm doing".
 *
 * It is the *sending* end of the loopback RPC the desktop app serves: a tiny
 * `node:net` client (here, `NativeActivityClient` from `../src/native-client.ts`)
 * that connects to `127.0.0.1:<port>`, pushes one newline-terminated frame per
 * change, and — because a producer that quits must not leave a ghost on the
 * feed — writes a `clear` on the way out. Run it with the desktop app open and a
 * `native-activity` permission granted, and the activity appears in the member
 * list and user bar exactly as an in-app `/activity` would.
 *
 * Why a Node/TS demo and not, say, a focused-window reader: passive
 * window/process detection is platform-specific (and not viable on Wayland), so
 * this is the cross-platform half — the wire, the caps, the connect/retry/quit
 * contract — that any app-language binding or a real detector would send the same
 * frames. The demo pushes a plausible, overridable activity; a real app feeds it
 * its own.
 *
 * Usage: `node demo/native-activity.ts [options]` (Node 22+ runs .ts directly;
 * the project's tests do the same). See --help.
 */
import process from "node:process";

import { NativeActivityClient, type NativeActivityClientEvent } from "../src/native-client.ts";
import type { NativeActivity } from "../src/native-wire.ts";

interface Args {
    host: string;
    port?: number;
    activity: NativeActivity;
    clear: boolean;
    durationMs: number | null;
}

const HELP = `Tumult native activity — a reference RPC producer.

Options:
  --host <host>        Host to relay through. Default 127.0.0.1 (loopback only — this is a
                       per-machine signal, never a network one).
  --port <port>        Port of the desktop app's RPC. Default: $TUMULT_NATIVE_ACTIVITY_PORT,
                       else 18731 (the desktop's own default).
  --type <type>        playing | listening | watching | custom. Default "playing".
  --name <name>        The headline (e.g. "VLC", "Visual Studio Code").
  --details <text>     A second line of context (e.g. a track or file name).
  --state <text>       A third line (e.g. a progress or current state).
  --emoji <glyph>      A short glyph shown by the headline.
  --clear              Clear the feed, then exit — the "the app quit, so the activity
                       goes away" path. No activity is reported.
  --duration <sec>     Report the activity, then clear and exit after N seconds
                       (a scripted run). Default: report until Ctrl-C / SIGTERM.
  -h, --help           Show this help.
`;

/** Read the options a producer passed on the command line. */
function parseArgs(argv: string[]): Args {
    const host = value("host", argv) ?? "127.0.0.1";
    const portRaw = value("port", argv);
    const port = portRaw ? Number.parseInt(portRaw, 10) : undefined;

    // A producer's own activity; the demo's default is a plausible "you are
    // running this" line, overridable field by field. Optional fields are added
    // only when supplied, so they never reach the wire as empty.
    const type = (value("type", argv) as NativeActivity["type"]) ?? "playing";
    const name = value("name", argv) ?? "Tumult Rich Presence Demo";
    const emoji = value("emoji", argv);
    const details = value("details", argv);
    const state = value("state", argv);
    const activity: NativeActivity = { type, name, startedAt: Date.now() };
    if (details) activity.details = details;
    if (state) activity.state = state;
    if (emoji) activity.emoji = emoji;

    const clear = argv.includes("--clear");
    const durationRaw = value("duration", argv);
    const durationMs = durationRaw ? Math.max(0, Number(durationRaw) * 1000) : null;

    return { host, activity, clear, durationMs, ...(port !== undefined ? { port } : {}) };
}

/** A `--key value` reader: the value is the next arg, unless it begins with `--`. */
function value(key: string, argv: string[]): string | undefined {
    const at = argv.indexOf(`--${key}`);
    if (at === -1) return undefined;
    const next = argv[at + 1];
    return next && !next.startsWith("--") ? next : undefined;
}

function log(message: string): void {
    process.stdout.write(`[rich-presence] ${message}\n`);
}

async function main(): Promise<void> {
    let args: Args;
    try {
        args = parseArgs(process.argv.slice(2));
    } catch {
        process.stderr.write(HELP);
        process.exitCode = 2;
        return;
    }

    const client = new NativeActivityClient({
        host: args.host,
        ...(args.port !== undefined ? { port: args.port } : {}),
        // A producer may start before the app (the RPC server) is up: retry, do
        // not give up — a game that launches before Tumult is still "playing."
        onEvent: (event: NativeActivityClientEvent) => {
            if (event.type === "connected") log(`connected to Tumult on ${args.host}:${args.port ?? "default"}`);
            else if (event.type === "disconnected") log("Tumult went away; reconnecting");
            else if (event.type === "retry") log(`retry ${event.attempt} in ${event.delayMs} ms`);
        },
    });

    // The producer must clear when it quits, so the activity disappears instead
    // of lingering: wire the exit signals to a single, awaited shutdown.
    let shuttingDown = false;
    const shutdown = async (): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        log("exiting — clearing the activity");
        await client.stop();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    await client.start();

    if (args.clear) {
        // The "app quit" path: clear whatever the feed held, then leave it.
        await client.clear();
        await client.stop();
        log("cleared");
        return;
    }

    if (!client.set(args.activity)) {
        process.stderr.write("the activity failed validation; nothing was reported\n");
        process.exitCode = 1;
        return;
    }
    log(`reporting: ${describe(args.activity)}`);

    // A scripted run: report, then clear and exit after the duration.
    if (args.durationMs !== null) {
        const timer = setTimeout(() => void shutdown(), Math.max(args.durationMs, 1));
        timer.unref?.();
    }
}

/** One human line for the activity being reported. */
function describe(activity: NativeActivity): string {
    const parts = [activity.name, activity.details, activity.state].filter(Boolean);
    const head = `(${activity.type}) ${parts.join(" — ")}`;
    return activity.emoji ? `${activity.emoji} ${head}` : head;
}

void main();
