import * as sdk from "matrix-js-sdk";
import type { OidcClientConfig, ValidatedAuthMetadata } from "matrix-js-sdk";
import { getPref } from "~/composables/useAppStorage";

// Helper to get config safely (prevents top-level crash)
export const getHomeserverUrl = async () => {
  const persisted = await getPref<string | null>('matrix_homeserver_url', null);
  if (persisted) return persisted;
  try {
    const config = useRuntimeConfig();
    if (config.public?.matrix?.baseUrl) {
      return 'https://' + config.public.matrix.baseUrl;
    }
  } catch (e) {
    // runtime config might not be available
  }
  return 'https://matrix.org'; // Final fallback
}

// Helper to get dynamic device name for Matrix
export async function getDeviceDisplayName(): Promise<string> {
  // Check if we are running in Tauri
  const isTauri = import.meta.client && !!(window as any).__TAURI_INTERNALS__;
  if (!isTauri) {
    return 'Tumult (Web)';
  }

  try {
    const { hostname, type, version } = await import('@tauri-apps/plugin-os');
    const host = await hostname();
    const osType = type();
    const osVersion = version();

    return `Tumult on ${host} (${osType} ${osVersion})`;
  } catch (err) {
    console.warn('Could not fetch OS details, falling back to default name', err);
    return 'Tumult Desktop';
  }
}

// Helper to get redirect URI safely (web/PWA only)
const getRedirectUri = () => {
  if (import.meta.client) {
    return window.location.origin + "/auth/callback";
  }
  return ""; // Fallback during SSR (won't be used)
}

// Discovery
export async function getOidcConfig(homeserverUrl?: string): Promise<OidcClientConfig> {
  const url = homeserverUrl || (await getHomeserverUrl());
  // Create a temp client just to fetch metadata
  const client = sdk.createClient({ baseUrl: url });
  return await client.getAuthMetadata();
}

// Registration
// If a redirectUri is provided (e.g. loopback), use it; otherwise fall back to the web redirect URI.
export async function registerClient(authConfig: OidcClientConfig, redirectUri?: string): Promise<string> {
  const effectiveRedirectUri = redirectUri || getRedirectUri();
  const deviceName = await getDeviceDisplayName();

  console.log('Auth config: ' + authConfig, 'Redirect URI: ' + effectiveRedirectUri, 'Device Name:', deviceName);

  // Note: These keys are translated to snake_case by the sdk.registerOidcClient helper
  return await sdk.registerOidcClient(
    authConfig,
    {
      clientName: "Tumult",
      clientUri: 'https://jackg.cc',
      logoUri: 'https://external-content.duckduckgo.com/iu/?u=https%3A%2F%2Fwww.clipartmax.com%2Fpng%2Fmiddle%2F238-2382091_keyhole-markup-language-icons-ruby-language-ruby-icon.png&f=1&nofb=1&ipt=bf51112a0814370434c449c7fc111e5ee70469651b590634d709ddf579343bab',
      applicationType: "native",
      redirectUris: [effectiveRedirectUri], // MUST match what you use in getLoginUrl
      contacts: ["jack@jackgraddon.com"],
      tosUri: 'https://jackg.cc/tos',
      policyUri: 'https://jackg.cc/policy',
    }
  );
}

// Generate URL
// If a redirectUri is provided (e.g. loopback), use it; otherwise fall back to the web redirect URI.
export async function getLoginUrl(
  authConfig: OidcClientConfig,
  clientId: string,
  nonce: string,
  redirectUri?: string,
  homeserverUrl?: string
): Promise<string> {
  const metadata = authConfig as unknown as ValidatedAuthMetadata;
  const url = homeserverUrl || (await getHomeserverUrl());
  const effectiveRedirectUri = redirectUri || getRedirectUri();

  return await sdk.generateOidcAuthorizationUrl({
    metadata: metadata,
    clientId: clientId,
    redirectUri: effectiveRedirectUri, // Matches registration above
    homeserverUrl: url,
    nonce: nonce,
  });
}

// Complete flow
export async function completeLoginFlow(authCode: string, state: string): Promise<any> {
  return await sdk.completeAuthorizationCodeGrant(authCode, state);
}