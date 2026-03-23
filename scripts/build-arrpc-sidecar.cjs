const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const arrpcDir = path.join(rootDir, 'server', 'arrpc');
const binariesDir = path.join(rootDir, 'src-tauri', 'binaries');
const distDir = path.join(arrpcDir, 'dist');

if (!fs.existsSync(binariesDir)) fs.mkdirSync(binariesDir, { recursive: true });
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

console.log('--- Building arRPC Sidecar (Stable Build) ---');

// 1. Determine Target Triple
let targetTriple = process.env.TAURI_ENV_TARGET_TRIPLE ||
  execSync('rustc -Vv').toString().split('\n').find(l => l.startsWith('host:')).split(' ')[1].trim();

const isWindows = targetTriple.includes('windows');
const isMac = targetTriple.includes('apple') || targetTriple.includes('darwin');
const binaryName = `arrpc-${targetTriple}${isWindows ? '.exe' : ''}`;
const outputPath = path.join(binariesDir, binaryName);

// 2. Bundle code
console.log('Step 1: Bundling with esbuild...');
const bundleFile = path.join(distDir, 'index.cjs');
execSync(`npx esbuild src/index.js --bundle --platform=node --format=cjs --outfile="${bundleFile}" --define:import.meta.url="__import_meta_url"`, {
  cwd: arrpcDir,
  stdio: 'inherit'
});

// 3. Asset Injection & Polyfills
console.log('Step 2: Injecting assets and directory polyfill...');
const detectableData = fs.readFileSync(path.join(arrpcDir, 'src', 'process', 'detectable.json'), 'utf8');
let code = fs.readFileSync(bundleFile, 'utf8');

// Strip shebang and prepend polyfill
code = code.replace(/^#!.*\n/, '');
const polyfillCode = `
const fs = require('fs');
const path = require('path');

process.env.ELECTRON_RUN_AS_NODE = '1';
process.env.QT_QPA_PLATFORM = 'offscreen';

process.chdir(require('os').tmpdir());

const _origRead = fs.readFileSync;
const _detectable = ${JSON.stringify(detectableData)};
fs.readFileSync = function(p, opts) {
  if (typeof p === 'string' && p.includes('detectable.json')) return _detectable;
  return _origRead.apply(this, arguments);
};
const __import_meta_url = require('url').pathToFileURL(__filename).href;
\n`;

fs.writeFileSync(bundleFile, polyfillCode + code);

// 4. Node SEA Blob
console.log('Step 3: Generating Node SEA Blob...');
const seaConf = path.join(distDir, 'sea-config.json');
fs.writeFileSync(seaConf, JSON.stringify({
  main: bundleFile,
  output: path.join(distDir, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true
}, null, 2));

execSync(`node --experimental-sea-config "${seaConf}"`, { stdio: 'inherit' });

// 5. Finalize Binary
console.log('Step 4: Preparing base binary...');
fs.copyFileSync(process.execPath, outputPath);

if (isMac) {
  console.log('... Handling macOS signatures and architecture');
  try { execSync(`codesign --remove-signature "${outputPath}"`); } catch (e) { }

  const info = execSync(`lipo -info "${outputPath}"`).toString();
  if (info.includes('Architectures in the fat file')) {
    const arch = targetTriple.startsWith('aarch64') ? 'arm64' : 'x86_64';
    execSync(`lipo "${outputPath}" -thin ${arch} -output "${outputPath}"`);
  }
} else if (isWindows) {
  try { execSync(`signtool remove /s "${outputPath}"`, { stdio: 'ignore' }); } catch (e) { }
}

// 6. Postject Injection
console.log('Step 5: Injecting blob into binary...');
let postjectArgs = `"${outputPath}" NODE_SEA_BLOB "${path.join(distDir, 'sea-prep.blob')}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`;
if (isMac) postjectArgs += ' --macho-segment-name NODE_SEA';

execSync(`npx postject ${postjectArgs}`, { stdio: 'inherit' });

if (isMac) {
  console.log('... Re-signing binary');
  execSync(`codesign -s - "${outputPath}"`);
}

console.log(`\nDone! Sidecar ready at: ${binaryName}`);