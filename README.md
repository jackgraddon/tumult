# Tumult

A Matrix client inspired by Discord built with Nuxt 4 and Tauri 2.

## Why?

The goal of this project is to create a functional replacement for Discord that operates on the [Matrix](https://matrix.org/) protocol. I've decided to create a Matrix client that is more in line with what I believe a good chat client should be. 

### Tumult?

Discord got its name because it ["sounds cool and has to do with talking"](https://web.archive.org/web/20150706094918/https://blog.discordapp.com/2015-05-21-ama-transcript/#:~:text=sounds%20cool%20and%20has%20to%20do%20with%20talking). Tumult's name means 'uproar', or 'a loud noise, especially that produced by an excited crowd, or a state of confusion, change, or uncertainty'. During this time of uncertainty with the future of Discord, the community has been quite vocal in their feelings about the changes Discord is making to their platform.

## Development

This project uses Yarn Berry with Corepack, so make sure to have that prepped before continuing.

Make sure to install dependencies:

```bash
corepack yarn
```

And sync git submodules:

```bash
git submodule update --init
```

Start the development server on `http://localhost:3000`:

```bash
# Just the web server
corepack yarn dev

# With the Tauri client
corepack yarn tauri dev
```

Build the application for production:

```bash
corepack yarn tauri build
```
