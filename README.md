# spotify-controller-bridge

Node.js (CommonJS) bridge that replicates [josephdadams/spotify-controller](https://github.com/josephdadams/spotify-controller)'s Socket.io and REST API so [bitfocus/companion-module-techministry-spotifycontroller](https://github.com/bitfocus/companion-module-techministry-spotifycontroller) works without AppleScript. Control is done via the **Spotify Web API** using a **Refresh Token**.

- **Express + Socket.io** on port **8801** by default
- **allowEIO3: true** for Companion compatibility
- Requires **Node 18+** (uses global `fetch`)

## Setup

### 1. Spotify App (Client ID & Secret)

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Create an app (or use an existing one).
3. Note the **Client ID** and **Client Secret**.
4. In the app settings, add **Redirect URI**: `http://127.0.0.1:8888/callback` (must be exactly this for the auth helper).

### 2. Get a Refresh Token

1. Copy `.env.example` to `.env`.
2. Set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in `.env`.
3. Run the auth helper (starts a loopback server on 127.0.0.1:8888 and prints the auth URL):

   ```bash
   npm run auth
   ```

4. Open the printed URL in your browser, log in with Spotify, and approve the scopes.
5. Copy the **refresh token** printed in the terminal and set it in `.env` as `SPOTIFY_REFRESH_TOKEN`.

### 3. Install and Run

```bash
npm install
npm start
```

The server listens on `http://0.0.0.0:8801` (HTTP + Socket.io). Configure Companion to use host `localhost` (or your machine IP) and port **8801**.

### Web UI

A simple “now playing” UI is available at **http://localhost:8801/ui** (or **/ui.html**). It shows track title, artist, album, album art, progress bar, connection status, and device name, and updates live via Socket.io.

## Programmatic API

The server is created via `createServer()`; it does **not** call `server.listen()` when the module is required.

```js
const { createServer } = require('./server.js');

const { app, server, io, start, stop } = createServer({ spotifyClientOverride: null });

await start(8801);   // optional port, defaults to PORT env or 8801
// ...
await stop();        // stops polling, ramp timer, and closes the HTTP server
```

- **createServer({ spotifyClientOverride })**  
  Returns `{ app, server, io, start, stop }`. If `spotifyClientOverride` is provided, it is used instead of building a `SpotifyWebAPI` from env (useful for tests or custom clients).
- **start(port)**  
  Starts polling, optional device transfer, and listens on `port`. Returns a Promise that resolves when listening (or rejects on listen error).
- **stop()**  
  Stops the poll interval, clears any volume-ramp timer, and closes the HTTP server. Returns a Promise that resolves when the server is closed.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8801` | HTTP and Socket.io port |
| `POLL_INTERVAL_MS` | `1000` | Playback state poll interval (ms) |
| `ALLOW_CONTROL` | `true` | If `false` or `0`, control commands are rejected; state still emitted |
| `SPOTIFY_CLIENT_ID` | — | Required. Spotify app Client ID |
| `SPOTIFY_CLIENT_SECRET` | — | Required. Spotify app Client Secret |
| `SPOTIFY_REFRESH_TOKEN` | — | Required. From `npm run auth` |
| `SPOTIFY_DEVICE_NAME` | — | Optional. Target device by name |
| `SPOTIFY_DEVICE_ID` | — | Optional. Target device by ID |
| `SPOTIFY_AUTO_TRANSFER_ON_START` | `true` | Transfer playback to configured device on startup |

## API (Companion compatibility)

### Socket.io events (incoming)

- `version`, `control_status`, `state`
- `play`, `pause`, `playToggle`
- `movePlayerPosition` (seconds), `setPlayerPosition` (seconds)
- `playtrack` (trackUriOrId), `playtrackincontext` (trackUriOrId, contextUriOrId)
- `next`, `previous`
- `volumeUp`, `volumeDown`, `setVolume` (volume 0–100)
- `rampVolume` (targetVolume, changePercent, rampTimeSeconds)
- `mute`, `unmute`
- `repeatOn`, `repeatOff`, `shuffleOn`, `shuffleOff`

### Socket.io events (emitted)

- `version` (string)
- `control_status` (boolean)
- `state_change` (`{ playbackInfo, state }`)
- `ramping_state` (boolean)

### REST GET endpoints

- `/version`, `/control_status`, `/state`
- `/play`, `/pause`, `/playToggle`, `/next`, `/previous`
- `/playTrack/:track`, `/playTrackInContext/:track/:context`
- `/movePlayerPosition/:seconds`, `/setPlayerPosition/:seconds`
- `/volumeUp`, `/volumeDown`, `/setVolume/:volume`
- `/rampVolume/:volume/:changePercent/:rampTime`
- `/mute`, `/unmute`, `/repeatOn`, `/repeatOff`, `/shuffleOn`, `/shuffleOff`

### State shape

- **playbackInfo**: `{ name, artist, album, duration (ms), playbackPosition (seconds), trackId (spotify:track:...), playerState ('Playing'|'Paused'|'Stopped'), albumArtUrl, deviceName, deviceIsActive }`
- **state**: `{ track_id, volume (0–100), position (seconds), state ('playing'|'paused'|'stopped'), isRepeating, isShuffling }`

## Testing

- **Unit/integration tests** (Node built-in test runner):

  ```bash
  npm test
  ```

  - **test/fake-spotify.js** – Fake Spotify client implementing `getPlaybackState`, `play`, `pause`, `next`, `previous`, `seek`, `setVolume`, `setRepeat`, `setShuffle`, `getDevices`, `transferPlayback` for use in tests.
  - **test/http.test.js** – Uses [supertest](https://github.com/ladjs/supertest) to assert `/version`, `/control_status`, `/state` response shape, and `/playToggle` toggling playback.
  - **test/socket.test.js** – Uses [socket.io-client](https://github.com/socketio/socket.io-client) to assert `version` and `control_status` on connect, and that emitting `playToggle` results in a `state_change` event.

- **Smoke test (real bridge)** – Connects to a running bridge at `http://127.0.0.1:8801`, logs `state_change` events, and emits `state`, `playToggle`, `next`, `volumeDown`, `pause` in sequence. Exits 0 if at least one `state_change` was received and no socket errors; otherwise exits 1.

  ```bash
  npm start          # in one terminal
  npm run smoke:real # in another
  ```

## Repository

- **Clone / upload**: You can upload this folder to GitHub manually. Do not commit `node_modules/` or `.env` (see `.gitignore`).
- **License**: MIT (see [LICENSE](LICENSE)).

## License

MIT
