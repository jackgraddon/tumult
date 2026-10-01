/** Extract `--name` refs from `var(--name[, fallback])` occurrences. */
export function extractRefs(value: string): string[] {
    const out: string[] = [];
    const re = /var\(--([\w-]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(value)) !== null) {
        const name = m[1];
        if (name) out.push(name);
    }
    return out;
}

export function hasUrl(value: string): boolean {
    return /(^|[^\w-])url\(/i.test(value);
}

/** Find a cycle reachable from `start` through `edges`. Returns the cycle path or null. */
export function findCycle(start: string, edges: ReadonlyMap<string, readonly string[]>): string[] | null {
    const stack: string[] = [];
    const onStack = new Set<string>();
    const visited = new Set<string>();
    let found: string[] | null = null;

    const dfs = (node: string): void => {
        if (found) return;
        visited.add(node);
        onStack.add(node);
        stack.push(node);
        for (const next of edges.get(node) ?? []) {
            if (found) break;
            if (!visited.has(next)) {
                dfs(next);
            } else if (onStack.has(next)) {
                found = [...stack.slice(stack.indexOf(next)), next];
            }
        }
        stack.pop();
        onStack.delete(node);
    };

    dfs(start);
    return found;
}
