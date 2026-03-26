# Tumult Discord Voice Bridge

This microservice bridges Matrix voice calls to Discord voice channels. It handles raw RTP media relaying, signaling, and encryption between both platforms.

## Prerequisites

1. **Discord Bot Token**:
   - Create an application in the [Discord Developer Portal](https://discord.com/developers/applications).
   - Create a Bot and enable the following **Privileged Gateway Intents**:
     - `Guild Voice States`
     - `Guild Messages`
     - `Message Content`
   - Invite the bot to your server using an OAuth2 URL with `bot` scope and `View Channels`, `Send Messages`, `Connect`, and `Speak` permissions.

2. **LiveKit Cloud or Self-Hosted**:
   - Create a project at [LiveKit Cloud](https://cloud.livekit.io).
   - Obtain your **API Key**, **API Secret**, and **WSS URL**.
   - Note: Public Matrix LiveKit instances (like `livekit.call.matrix.org`) usually do not support the Ingress API required for bridging.

3. **Fly.io Account** (Recommended for hosting):
   - Install the `flyctl` CLI.
   - The bridge requires a long-running process with raw UDP socket support, which Vercel does not provide.

## Deployment Setup

### 1. Deploy to Fly.io

Run the following commands from the project root:

```bash
cd packages/tumult-bridge
fly launch
```

- Say **Yes** to using the existing `fly.toml` and `Dockerfile`.
- When prompted for settings, Fly will automatically detect the UDP port exposures (10000-10002) defined in the configuration.

### 2. Configure Environment Variables

Set your secrets on Fly.io:

```bash
fly secrets set \
  DISCORD_TOKEN="your_discord_bot_token" \
  LIVEKIT_URL="wss://your-instance.livekit.cloud" \
  LIVEKIT_API_KEY="your_api_key" \
  LIVEKIT_API_SECRET="your_api_secret" \
  MATRIX_URL="https://matrix.org" \
  MATRIX_TOKEN="your_matrix_access_token"
```

*Note: `MATRIX_TOKEN` should belong to a user account that the bridge will use to watch for state events in rooms. It does not need to be an admin.*

## Linking a Channel

Once the bridge is running:

1. Open **Tumult** and navigate to a Matrix room.
2. Open **Room Settings** (Gear icon).
3. Select the **Integrations** tab.
4. Enter your **Discord Server ID** and **Voice Channel ID**.
   - *Tip: Enable "Developer Mode" in Discord Settings > Advanced to right-click and "Copy ID".*
5. Click **Link Channel**.

The bridge microservice will automatically detect this state event and command the Discord bot to join the voice channel.

## Technical Architecture

- **Stage 1 (Discord Gateway)**: Connects to Discord's Voice WebSocket for signaling and handles UDP IP discovery. Decrypts incoming XSalsa20-Poly1305 packets.
- **Stage 2 (mediasoup Router)**: Acts as a media relay, ingesting decrypted Opus RTP from Discord.
- **Stage 3 (LiveKit Ingress)**: Pushes RTP streams from mediasoup into LiveKit as virtual participants.
- **Stage 4 (Return Path)**: Subscribes to Matrix tracks via `@livekit/rtc-node`, encodes them to Opus, and forwards them to the Discord bot's voice stream.
