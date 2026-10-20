/**
 * Turn the built bundle into the release manifest.
 *
 * The file committed in the repository (`tumult.plugin.json`) has no
 * `integrity`: there is nothing to hash until a bundle exists. This script
 * reads it, hashes `dist/plugin.js`, writes `integrity`, and emits the result
 * to `dist/tumult.plugin.json` — which is what the release workflow attaches
 * next to the bundle.
 *
 * `sha256-<base64>` of the raw bytes, the same shape Tumult verifies.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("tumult.plugin.json", "utf8"));
const entry = manifest.entry ?? "plugin.js";
const bytes = readFileSync(`dist/${entry}`);
const integrity = `sha256-${createHash("sha256").update(bytes).digest("base64")}`;

const release = { ...manifest, integrity };
writeFileSync("dist/tumult.plugin.json", `${JSON.stringify(release, null, 4)}\n`);

console.log(`${entry}  ${bytes.length} bytes`);
console.log(`integrity  ${integrity}`);
