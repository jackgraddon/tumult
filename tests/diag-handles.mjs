// TEMPORARY diagnostic (removed once the stop leak is found): what keeps a
// test process alive after its tests finish. Load with `node --import`.
// Records every timer of 10 s or more with the stack that created it, then
// prints what is still pending, plus open sockets, after DIAG_AT_MS.
const pending = new Map();
const wrap = (name, original, clear) => {
    globalThis[name] = function (fn, delay, ...rest) {
        const handle = original.call(this, fn, delay, ...rest);
        if (Number(delay) >= 10_000) {
            pending.set(handle, { kind: name, delay, stack: new Error().stack.split("\n").slice(2, 9).join(" | ") });
            if (name === "setTimeout") {
                const fired = () => pending.delete(handle);
                original.call(this, fired, delay).unref?.();
            }
        }
        return handle;
    };
    const originalClear = globalThis[clear];
    globalThis[clear] = function (handle) {
        pending.delete(handle);
        return originalClear.call(this, handle);
    };
};
wrap("setTimeout", globalThis.setTimeout, "clearTimeout");
wrap("setInterval", globalThis.setInterval, "clearInterval");

const report = globalThis.setTimeout.call(globalThis, () => {
    console.log("[diag] active resources:", JSON.stringify(process.getActiveResourcesInfo()));
    for (const [handle, info] of pending) {
        if (handle.hasRef?.() === false) continue;
        console.log(`[diag] pending ${info.kind}(${info.delay}ms) from: ${info.stack}`);
    }
    for (const h of process._getActiveHandles()) {
        const name = h?.constructor?.name;
        if (name === "Socket") console.log(`[diag] socket ${h.remoteAddress}:${h.remotePort} local ${h.localPort} destroyed=${h.destroyed}`);
        else if (name !== "WriteStream" && name !== "ReadStream") console.log(`[diag] handle ${name}`);
    }
}, Number(process.env.DIAG_AT_MS ?? 30_000));
report.unref();
