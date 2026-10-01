/** Levenshtein-based did-you-mean over token names. */
export function suggestToken(unknown: string, candidates: readonly string[]): string | undefined {
    let best: string | undefined;
    let bestDist = Infinity;
    for (const c of candidates) {
        const d = distance(unknown, c);
        if (d < bestDist) {
            bestDist = d;
            best = c;
        }
    }
    if (best === undefined) return undefined;
    // Only suggest when plausibly a typo (<= 1/3 of length, min 2).
    const limit = Math.max(2, Math.floor(best.length / 3));
    return bestDist <= limit ? best : undefined;
}

function distance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
        let prev = dp[0] ?? 0;
        dp[0] = i;
        for (let j = 1; j <= n; j++) {
            const cur = dp[j] ?? 0;
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[j] = Math.min((dp[j] ?? 0) + 1, (dp[j - 1] ?? 0) + 1, prev + cost);
            prev = cur;
        }
    }
    return dp[n] ?? Infinity;
}
