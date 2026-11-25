# WeKnora Mobile

English | [简体中文](./README.md)

A mobile client for [WeKnora](https://github.com/Tencent/WeKnora), built to solve the poor mobile browsing experience of the WeKnora web UI.

WeKnora's web interface is designed for desktop. On a phone, the layout is cramped, tables overflow, and the wiki views are hard to navigate. This project packages a purpose-built mobile UI into an Android WebView APK, so you can use a self-hosted WeKnora instance comfortably from your phone.

## Features

- Connect to a self-hosted WeKnora API
- Knowledge base list, detail and settings (models, indexing strategy, wiki extraction granularity, etc.)
- Copy / move knowledge bases
- Knowledge base statistics and retrieval evaluation
- Infinite scrolling, filtering and batch operations for knowledge documents
- Wiki view and entity-relation graph view (requires the corresponding index to be enabled)
- FAQ-type knowledge base entry management
- Tag management (create, edit, delete)
- Add knowledge from files, web URLs, or manually written content
- Browse documents, agents, sessions, models and system information
- Diagnostics page for troubleshooting API issues
- Responsive mobile layout
- Markdown rendering with LaTeX math (KaTeX), GFM tables and code highlighting

## Why a WebView APK?

The current release bundles the web app into an APK and loads it from a local `file://` origin inside a native WebView. This is deliberate:

- **No browser dependency** — you don't need Chrome to be the system default browser.
- **No mixed-content blocking** — HTTPS pages loading HTTP APIs are rejected by normal browsers; the local `file://` origin avoids this.
- **Works with Tailscale / LAN / self-hosted HTTP backends** — no valid TLS certificate required.

The trade-off is that a WebView shell has to be rebuilt to ship front-end changes, which is why releases are versioned APKs rather than a hosted site.

## Tech Stack

| Layer | Technology |
|---|---|
| UI | React 18, React Router 6, Tailwind CSS, Lucide icons |
| Build | Vite 5, vite-plugin-pwa (manifest + service worker) |
| Markdown | react-markdown, remark-gfm, remark-math, rehype-katex, rehype-raw |
| Shell | Native Android WebView (`MainActivity.java`) |

## Requirements

- Node.js 18+
- An accessible WeKnora instance with API access enabled
- For APK builds: Android SDK, JDK 18+

## Local Development

```bash
npm install
npm run dev
```

## Testing

The project uses dependency-free Node scripts instead of a test framework:

```bash
npm run check
```

This runs the full suite: stream termination semantics, citation markers, knowledge-base settings payload, markdown URL whitelist, chat math rendering, answer diagnostics, auth, graph data, plus a secrets scan and a React hooks ordering check.

Individual suites can be run directly, e.g. `npm run test:chat-katex`.

## Build the PWA

```bash
npm run build
npm run preview
```

## Build the Android APK

1. Build the WebView-specific PWA:

```bash
npm run build -- --config vite.config.webview.js
```

2. Copy the build output into the Android assets directory:

```bash
rm -rf webview-app/app/src/main/assets
mkdir -p webview-app/app/src/main/assets/web
cp -r dist-webview/* webview-app/app/src/main/assets/web/
mv webview-app/app/src/main/assets/web/index-webview.html \
   webview-app/app/src/main/assets/web/index.html
```

3. Build and sign the APK:

```bash
cd webview-app
export ANDROID_HOME="../.android-sdk"
export GRADLE_USER_HOME="../.gradle-home"
export JAVA_HOME="D:/Program Files/Java/jdk-18.0.2.1"
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew assembleRelease

../.android-sdk/build-tools/35.0.0/apksigner sign \
  --ks ../android/android.keystore \
  --out app/build/outputs/apk/release/app-release.apk \
  app/build/outputs/apk/release/app-release-unsigned.apk
```

The signed APK is written to `webview-app/app/build/outputs/apk/release/app-release.apk`.

Releases are produced automatically by GitHub Actions when a version tag (`v*`) is pushed; see `.github/workflows/` for the pipeline.

## Release Process

1. Bump the version in `package.json` and `webview-app/app/build.gradle` (`versionCode` / `versionName`).
2. Update `RELEASE_NOTES.md` (the CI uses it as the release body).
3. Commit, then push a tag:

```bash
git tag v1.9.7
git push origin v1.9.7
```

The workflow builds the web bundle, packages the WebView assets, builds and signs the APK, and publishes a GitHub Release.

## Configuration

Server address and API key are configured inside the app on first launch (Settings page), not at build time. Nothing sensitive is compiled into the APK.

## Known Limitations

- **Wiki images may not display.** Wiki pages reference images through `resource://` handles. If the server deployment lacks the route that resolves those handles (e.g. `/api/v1/files` returns 404), images fail to load in the browser *and* in the app. This is a server-side issue, not a client one. Viewing the original document instead of the wiki page works around it.
- **Two dollar signs in one sentence** may be misparsed as a LaTeX formula (e.g. `$100-$200`). This comes from `remark-math` and is accepted in exchange for inline math support. Escape amounts as `\$100`.
- **System info page** depends on a `/system/info` endpoint; it shows an empty state when unavailable.

## License

No license file is currently included. All rights reserved by the author unless stated otherwise.
