/**
 * Fake capture devices and in-page media probes for the call tests
 * (rtc-media.test.ts: native voice; element-call.test.ts: the embedded app).
 *
 * Each person's fake microphone plays one pure tone and their fake camera shows
 * one solid colour (Chromium's `--use-file-for-fake-*-capture`), so a test can
 * prove the OTHER side's media arrived and decrypted: a wrong or missing E2EE
 * key decodes to garbage — no tone, no colour — where counting bytes would pass.
 *
 * The in-page probes are plain strings, not functions: tsx wraps named
 * functions in `__name()`, which does not exist in the page (see AGENTS.md).
 */
import { writeFileSync } from "node:fs";

export type Rgb = [number, number, number];

/** A mono 16-bit 48 kHz WAV of one sine tone. Chromium loops the file. */
export function writeTone(path: string, hz: number): void {
    const rate = 48000;
    const samples = rate * 2;
    const data = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) {
        data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 0.5 * 32767), i * 2);
    }
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write("WAVEfmt ", 8);
    header.writeUInt32LE(16, 16); // fmt chunk size
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 2, 28); // byte rate
    header.writeUInt16LE(2, 32); // block align
    header.writeUInt16LE(16, 34); // bits per sample
    header.write("data", 36);
    header.writeUInt32LE(data.length, 40);
    writeFileSync(path, Buffer.concat([header, data]));
}

/** A Y4M (4:2:0, full-range BT.601) of one solid colour. Chromium loops it. */
export function writeColour(path: string, [r, g, b]: Rgb): void {
    const width = 320;
    const height = 240;
    const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    const u = Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5 * b);
    const v = Math.round(128 + 0.5 * r - 0.418688 * g - 0.081312 * b);
    const frame = Buffer.concat([
        Buffer.from("FRAME\n"),
        Buffer.alloc(width * height, y),
        Buffer.alloc((width / 2) * (height / 2), u),
        Buffer.alloc((width / 2) * (height / 2), v),
    ]);
    const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F15:1 Ip A1:1 C420jpeg\n`);
    writeFileSync(path, Buffer.concat([header, ...Array.from({ length: 15 }, () => frame)]));
}

/** Chromium flags that make this person's mic and camera the given files. */
export function fakeCaptureArgs(wav: string, y4m: string): string[] {
    return [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-audio-capture=${wav}`,
        `--use-file-for-fake-video-capture=${y4m}`,
        "--autoplay-policy=no-user-gesture-required",
    ];
}

/**
 * Runs before any page script — in every frame, including a call app's
 * iframe: record every track a peer connection receives.
 */
export const CAPTURE_REMOTE_TRACKS = `
(() => {
    const Native = window.RTCPeerConnection;
    window.__tumultRemoteTracks = [];
    window.__tumultPeerConnections = [];
    function Recording(...args) {
        const pc = new Native(...args);
        window.__tumultPeerConnections.push(pc);
        pc.addEventListener("track", (event) => window.__tumultRemoteTracks.push(event.track));
        return pc;
    }
    Recording.prototype = Native.prototype;
    Object.setPrototypeOf(Recording, Native);
    window.RTCPeerConnection = Recording;
})();
`;

/**
 * The dominant frequency of each live remote audio track, after listening for
 * a moment. Each track is also played through a muted element: Chromium only
 * feeds a remote WebRTC track to Web Audio while something is playing it.
 */
export const HEARD = `
(async () => {
    const tracks = window.__tumultRemoteTracks.filter((t) => t.kind === "audio" && t.readyState === "live");
    const ctx = new AudioContext();
    await ctx.resume();
    const probes = tracks.map((track) => {
        const stream = new MediaStream([track]);
        const element = new Audio();
        element.muted = true;
        element.srcObject = stream;
        element.play().catch(() => {});
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 8192;
        ctx.createMediaStreamSource(stream).connect(analyser);
        return analyser;
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const heard = probes.map((analyser) => {
        const bins = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(bins);
        const binHz = ctx.sampleRate / analyser.fftSize;
        let best = Math.ceil(100 / binHz);
        for (let i = best; i < bins.length; i++) if (bins[i] > bins[best]) best = i;
        return { hz: Math.round(best * binHz), db: Math.round(bins[best]) };
    });
    await ctx.close();
    return heard;
})()
`;

/** The average colour (and frame count) of every `selector` video showing frames. */
export function seenScript(selector: string): string {
    return `
(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    return [...document.querySelectorAll(${JSON.stringify(selector)})]
        .filter((video) => video.videoWidth > 0)
        .map((video) => {
            g.drawImage(video, 0, 0, 16, 16);
            const px = g.getImageData(0, 0, 16, 16).data;
            const sum = [0, 0, 0];
            for (let i = 0; i < px.length; i += 4) {
                sum[0] += px[i];
                sum[1] += px[i + 1];
                sum[2] += px[i + 2];
            }
            return { rgb: sum.map((c) => Math.round(c / 256)), frames: video.getVideoPlaybackQuality().totalVideoFrames };
        });
})()
`;
}

/** What the peer connections say they received: the diagnosis when media is missing. */
export const STATS = `
(async () => {
    const out = [];
    for (const pc of window.__tumultPeerConnections) {
        (await pc.getStats()).forEach((s) => {
            if (s.type === "inbound-rtp") {
                out.push({ kind: s.kind, bytes: s.bytesReceived, energy: s.totalAudioEnergy, decoded: s.framesDecoded, lost: s.packetsLost });
            }
        });
        out.push({ pc: pc.connectionState });
    }
    return out;
})()
`;

/**
 * Which of the two test colours this is, by dominant channel; null for neither.
 * Coarse on purpose: VP8 shifts a flat colour a little, and black (no frames
 * decoded) or E2EE garbage must not pass.
 */
export function colourOf(rgb: readonly number[]): "red" | "blue" | null {
    const [r = 0, g = 0, b = 0] = rgb;
    if (r > g + 60 && r > b + 60) return "red";
    if (b > r + 60 && b > g + 60) return "blue";
    return null;
}

/** The two test people: far apart in pitch and colour, so nothing can confuse them. */
export const PEOPLE: readonly { name: string; tone: number; colour: Rgb }[] = [
    { name: "alice", tone: 440, colour: [200, 40, 40] },
    { name: "bob", tone: 1000, colour: [40, 40, 200] },
];
