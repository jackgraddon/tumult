# Tumult

A Discord-like Matrix client with voice chat and activity status support. Built with Nuxt 4 and Tauri 2.

## Why?

With the recent actions taken by Discord and their handling of their community, I've decided to create a Matrix client that is more in line with what I believe a good chat client should be. 

## Development

Install dependencies:

```bash
corepack yarn install
```

You can set a custom homeserver as default by setting the `NUXT_PUBLIC_MATRIX_BASE_URL` environment variable. Do not include the `https://` prefix. For example: `NUXT_PUBLIC_MATRIX_BASE_URL=matrix.org`. This will let the app build with that as the default homeserver, but it is still possible to connect to other homeservers through the login screen.

Start the development server on `http://localhost:3000`:

```bash
# No Tauri application
corepack yarn dev

# With Tauri application
corepack yarn tauri dev
```

Build the application for production:

```bash
corepack yarn tauri build
```