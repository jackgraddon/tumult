# Tumult Auto-Update and Remote Frontend Setup

This document explains how the new auto-update and remote frontend system works, and how to set it up.

## How it works

1. **Remote Frontend**: The Tauri app now attempts to load `https://tumult.jackg.cc` on startup. If successful, users get the latest frontend updates as soon as you push them to Vercel, while still maintaining access to local Rust features like game detection.
2. **Failover**: If the app cannot reach the remote server (e.g., no internet or Vercel is down), it falls back to the local bundled assets. A small "Offline Mode" notice will appear in the bottom right corner.
3. **Auto-Updater**: The app uses the Tauri 2 Updater plugin. It checks `https://tumult.jackg.cc/api/update` for new versions of the desktop app (Rust backend). This endpoint fetches the latest release from GitHub and returns the necessary metadata.
4. **Offline Builds**: You can build the app to *always* use local assets by setting the `BUILD_FOR_OFFLINE=1` environment variable during the build process.

## Setup Instructions

To enable secure auto-updates, you need to sign your application. Since you don't have a commercial certificate, you can use Tauri's free private key signing.

### 1. Generate Signing Keys

Run the following command in your terminal (using the Tauri CLI):

```bash
npx tauri signer generate -w ~/.tauri/tumult.key
```

- When prompted for a password, choose a strong one.
- This will generate two things:
    - A **Private Key** (saved to `~/.tauri/tumult.key`).
    - A **Public Key** (printed in your terminal).

### 2. Configure Public Key

Copy the **Public Key** from the terminal and add it to your `src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "publisher": "cc.jackg.tumult",
    "updater": {
      "pubkey": "YOUR_PUBLIC_KEY_HERE"
    }
  }
}
```

### 3. Add GitHub Secrets

For the GitHub Action to sign your releases automatically, you must add the following secrets to your GitHub repository (**Settings > Secrets and variables > Actions > New repository secret**):

1. `TAURI_SIGNING_PRIVATE_KEY`: The **Base64-encoded** contents of your `~/.tauri/tumult.key` file. This ensures that the required header line (`untrusted comment: ...`) is preserved. Use this command to get the correct value:
   ```bash
   cat ~/.tauri/tumult.key | base64
   ```
2. `TAURI_SIGNING_PASSWORD`: The password you chose when generating the key.

### 4. Trigger a Release

To push a new update to users:
1. Update the version in `package.json` or `src-tauri/tauri.conf.json`.
2. Create and push a new tag to GitHub:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
3. GitHub Actions will build the app, sign it, and create a Draft Release.
4. Once you publish the release, the auto-updater will detect it and prompt users to update.
