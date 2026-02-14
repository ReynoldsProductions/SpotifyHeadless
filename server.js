/**
 * spotify-controller-bridge
 * Express + Socket.io server compatible with bitfocus/companion-module-techministry-spotifycontroller.
 * Replaces AppleScript with Spotify Web API (refresh token). Node 18+.
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { SpotifyWebAPI } = require('./spotify-web-api.js');

const PORT = Number(process.env.PORT) || 8801;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 1000;
const ALLOW_CONTROL = process.env.ALLOW_CONTROL !== 'false' && process.env.ALLOW_CONTROL !== '0';
const VERSION = '1.0.0-bridge';
const SPOTIFY_AUTO_TRANSFER_ON_START = process.env.SPOTIFY_AUTO_TRANSFER_ON_START !== 'false' && process.env.SPOTIFY_AUTO_TRANSFER_ON_START !== '0';

function createServer (options = {}) {
  const { spotifyClientOverride } = options;

  let spotify = null;
  let pollTimer = null;
  let lastStatePayload = null;
  let rampingState = false;
  let rampIntervalId = null;
  let lastNonZeroVolume = 50;

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    allowEIO3: true,
    cors: { origin: '*' }
  });

  function mapSpotifyToPlaybackInfo (player) {
    if (!player || !player.item) {
      return {
        name: '',
        artist: '',
        album: '',
        duration: 0,
        playbackPosition: 0,
        trackId: '',
        playerState: 'Stopped',
        albumArtUrl: '',
        deviceName: '',
        deviceIsActive: false
      };
    }
    const item = player.item;
    const isTrack = item.type === 'track';
    const name = item.name || '';
    const artist = isTrack && item.artists && item.artists.length
      ? item.artists.map(a => a.name).join(', ')
      : (item.show && item.show.name) || '';
    const album = isTrack && item.album ? item.album.name : '';
    const duration = item.duration_ms || 0;
    const playbackPosition = (player.progress_ms != null ? player.progress_ms : 0) / 1000;
    const trackId = item.uri || '';
    let playerState = 'Stopped';
    if (player.is_playing === true) playerState = 'Playing';
    else if (player.is_playing === false && (duration > 0 || playbackPosition > 0)) playerState = 'Paused';

    const albumArtUrl = (isTrack && item.album && item.album.images && item.album.images.length && item.album.images[0].url)
      ? item.album.images[0].url
      : '';
    const deviceName = (player.device && player.device.name) ? player.device.name : '';
    const deviceIsActive = !!(player.device && player.device.is_active);

    return {
      name,
      artist,
      album,
      duration,
      playbackPosition,
      trackId,
      playerState,
      albumArtUrl,
      deviceName,
      deviceIsActive
    };
  }

  function mapSpotifyToState (player) {
    const playbackInfo = mapSpotifyToPlaybackInfo(player);
    const trackId = playbackInfo.trackId || '';
    const position = playbackInfo.playbackPosition;
    let state = 'stopped';
    if (playbackInfo.playerState === 'Playing') state = 'playing';
    else if (playbackInfo.playerState === 'Paused') state = 'paused';
    const volume = (player && player.device && player.device.volume_percent != null)
      ? player.device.volume_percent
      : 0;
    const isRepeating = (player && player.repeat_state && player.repeat_state !== 'off') || false;
    const isShuffling = (player && player.shuffle_state) || false;

    return {
      track_id: trackId,
      volume,
      position,
      state,
      isRepeating,
      isShuffling
    };
  }

  function buildStateChangePayload (player) {
    const playbackInfo = mapSpotifyToPlaybackInfo(player);
    const state = mapSpotifyToState(player);
    return { playbackInfo, state };
  }

  function payloadEquals (a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    const s = (x) => JSON.stringify(x);
    return s(a.playbackInfo) === s(b.playbackInfo) && s(a.state) === s(b.state);
  }

  function broadcastStateChange (payload) {
    lastStatePayload = payload;
    io.emit('state_change', payload);
  }

  async function pollPlaybackState () {
    if (!spotify) return;
    try {
      const player = await spotify.getPlaybackState();
      const payload = buildStateChangePayload(player);
      if (payload.state && payload.state.volume > 0) {
        lastNonZeroVolume = payload.state.volume;
      }
      if (!payloadEquals(payload, lastStatePayload)) {
        broadcastStateChange(payload);
      }
    } catch (err) {
      if (err.message && !err.message.includes('No active device')) {
        console.error('Poll error:', err.message);
      }
    }
  }

  function startPolling () {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollPlaybackState, POLL_INTERVAL_MS);
    pollPlaybackState();
  }

  function stopPolling () {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function ensureDeviceAndTransfer () {
    const deviceId = process.env.SPOTIFY_DEVICE_ID;
    const deviceName = process.env.SPOTIFY_DEVICE_NAME;
    if (!spotify || (!deviceId && !deviceName)) return;
    try {
      const devices = await spotify.getDevices();
      let target = deviceId ? devices.find(d => d.id === deviceId) : null;
      if (!target && deviceName) {
        target = devices.find(d => (d.name || '').toLowerCase() === String(deviceName).toLowerCase());
      }
      if (target) {
        spotify.deviceId = target.id;
        console.log('Using device: ' + (target.name || 'Unknown') + ' (' + target.id + ')');
        if (SPOTIFY_AUTO_TRANSFER_ON_START) {
          await spotify.transferPlayback(target.id, false);
        }
      }
    } catch (e) {
      console.error('Transfer on start:', e.message);
    }
  }

  function initSpotify () {
    const hasCreds = process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET && process.env.SPOTIFY_REFRESH_TOKEN;
    if (!hasCreds) {
      console.warn('Spotify credentials missing (SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN). State polling disabled.');
      return;
    }
    spotify = new SpotifyWebAPI({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      refreshToken: process.env.SPOTIFY_REFRESH_TOKEN,
      deviceId: process.env.SPOTIFY_DEVICE_ID || null,
      deviceName: process.env.SPOTIFY_DEVICE_NAME || null
    });
    startPolling();
    ensureDeviceAndTransfer().catch(() => {});
  }

  function rampVolume (targetVolume, changePercent, rampTimeSeconds, done) {
    if (rampIntervalId) {
      clearInterval(rampIntervalId);
      rampIntervalId = null;
    }
    const currentPayload = lastStatePayload;
    const startVolume = (currentPayload && currentPayload.state && currentPayload.state.volume != null) ? currentPayload.state.volume : 0;
    const target = Math.max(0, Math.min(100, Math.round(Number(targetVolume) || 0)));
    const changePerStep = Math.max(1, Math.round(Number(changePercent) || 1));
    const steps = Math.ceil(Math.abs(target - startVolume) / changePerStep) || 1;
    const rampTimeMs = (Number(rampTimeSeconds) || 1) * 1000;
    const stepDelayMs = Math.max(100, Math.floor(rampTimeMs / steps));

    rampingState = true;
    io.emit('ramping_state', true);

    let step = 0;

    const tick = async () => {
      const volume = Math.max(0, Math.min(100, Math.round(startVolume + (target - startVolume) * (step / steps))));
      if (spotify && ALLOW_CONTROL) {
        try {
          await spotify.setVolume(volume);
        } catch (e) {
          console.error('Ramp setVolume:', e.message);
        }
      }
      if (step >= steps) {
        rampIntervalId = null;
        rampingState = false;
        io.emit('ramping_state', false);
        pollPlaybackState();
        if (typeof done === 'function') done();
        return;
      }
      step++;
    };

    rampIntervalId = setInterval(tick, stepDelayMs);
    tick();
  }

  // ---- Static UI ----

  app.use(express.static('public'));
  app.get('/ui', (req, res) => res.redirect('/ui.html'));

  // ---- REST GET endpoints (match spotify-controller) ----

  app.get('/version', (req, res) => {
    res.send(VERSION);
  });

  app.get('/control_status', (req, res) => {
    res.send(ALLOW_CONTROL ? 'true' : 'false');
  });

  app.get('/state', async (req, res) => {
    try {
      if (!spotify) {
        return res.json({ playbackInfo: mapSpotifyToPlaybackInfo(null), state: mapSpotifyToState(null) });
      }
      const player = await spotify.getPlaybackState();
      res.json(buildStateChangePayload(player));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  function restControl (req, res, fn) {
    if (!ALLOW_CONTROL) return res.status(403).send('Control disabled');
    if (!spotify) return res.status(503).send('Spotify not configured');
    Promise.resolve(fn()).then(() => res.send('OK')).catch(err => res.status(500).send(err.message));
  }

  app.get('/play', (req, res) => restControl(req, res, () => spotify.play()));
  app.get('/pause', (req, res) => restControl(req, res, () => spotify.pause()));
  app.get('/playToggle', async (req, res) => {
    if (!ALLOW_CONTROL || !spotify) {
      return res.status(ALLOW_CONTROL ? 503 : 403).send(ALLOW_CONTROL ? 'Spotify not configured' : 'Control disabled');
    }
    try {
      const player = await spotify.getPlaybackState();
      if (player && player.is_playing) await spotify.pause();
      else await spotify.play();
      res.send('OK');
    } catch (e) {
      res.status(500).send(e.message);
    }
  });
  app.get('/next', (req, res) => restControl(req, res, () => spotify.next()));
  app.get('/previous', (req, res) => restControl(req, res, () => spotify.previous()));

  app.get('/playTrack/:track', (req, res) => {
    restControl(req, res, () => spotify.playTrack(req.params.track));
  });

  app.get('/playTrackInContext/:track/:context', (req, res) => {
    restControl(req, res, () => spotify.playTrackInContext(req.params.track, req.params.context));
  });

  app.get('/movePlayerPosition/:seconds', (req, res) => {
    if (!ALLOW_CONTROL || !spotify) {
      return res.status(ALLOW_CONTROL ? 503 : 403).send(ALLOW_CONTROL ? 'Spotify not configured' : 'Control disabled');
    }
    const currentPayload = lastStatePayload;
    const currentPos = (currentPayload && currentPayload.state && currentPayload.state.position != null) ? currentPayload.state.position : 0;
    const delta = Number(req.params.seconds) || 0;
    const positionMs = Math.max(0, (currentPos + delta) * 1000);
    restControl(req, res, () => spotify.seek(positionMs));
  });

  app.get('/setPlayerPosition/:seconds', (req, res) => {
    const sec = Math.max(0, Number(req.params.seconds) || 0);
    restControl(req, res, () => spotify.seek(sec * 1000));
  });

  app.get('/volumeUp', (req, res) => {
    if (!ALLOW_CONTROL || !spotify) {
      return res.status(ALLOW_CONTROL ? 503 : 403).send(ALLOW_CONTROL ? 'Spotify not configured' : 'Control disabled');
    }
    if (rampingState) return res.status(409).send('Volume ramping in progress');
    const currentPayload = lastStatePayload;
    const v = (currentPayload && currentPayload.state && currentPayload.state.volume != null) ? currentPayload.state.volume : 50;
    restControl(req, res, () => spotify.setVolume(Math.min(100, v + 10)));
  });

  app.get('/volumeDown', (req, res) => {
    if (!ALLOW_CONTROL || !spotify) {
      return res.status(ALLOW_CONTROL ? 503 : 403).send(ALLOW_CONTROL ? 'Spotify not configured' : 'Control disabled');
    }
    if (rampingState) return res.status(409).send('Volume ramping in progress');
    const currentPayload = lastStatePayload;
    const v = (currentPayload && currentPayload.state && currentPayload.state.volume != null) ? currentPayload.state.volume : 50;
    restControl(req, res, () => spotify.setVolume(Math.max(0, v - 10)));
  });

  app.get('/setVolume/:volume', (req, res) => {
    if (rampingState) return res.status(409).send('Volume ramping in progress');
    const vol = Math.max(0, Math.min(100, Math.round(Number(req.params.volume) || 0)));
    restControl(req, res, () => spotify.setVolume(vol));
  });

  app.get('/rampVolume/:volume/:changePercent/:rampTime', (req, res) => {
    if (!ALLOW_CONTROL || !spotify) {
      return res.status(ALLOW_CONTROL ? 503 : 403).send(ALLOW_CONTROL ? 'Spotify not configured' : 'Control disabled');
    }
    const target = Number(req.params.volume) || 0;
    const changePercent = Number(req.params.changePercent) || 0;
    const rampTime = Number(req.params.rampTime) || 1;
    rampVolume(target, changePercent, rampTime, () => {});
    res.send('OK');
  });

  app.get('/mute', (req, res) => {
    if (rampingState) return res.status(409).send('Volume ramping in progress');
    return restControl(req, res, () => spotify.setVolume(0));
  });
  app.get('/unmute', (req, res) => {
    if (rampingState) return res.status(409).send('Volume ramping in progress');
    return restControl(req, res, () => spotify.setVolume(lastNonZeroVolume || 50));
  });
  app.get('/repeatOn', (req, res) => restControl(req, res, () => spotify.setRepeat('context')));
  app.get('/repeatOff', (req, res) => restControl(req, res, () => spotify.setRepeat('off')));
  app.get('/shuffleOn', (req, res) => restControl(req, res, () => spotify.setShuffle(true)));
  app.get('/shuffleOff', (req, res) => restControl(req, res, () => spotify.setShuffle(false)));

  // ---- Socket.io ----

  io.on('connection', (socket) => {
    socket.emit('version', VERSION);
    socket.emit('control_status', ALLOW_CONTROL);
    if (lastStatePayload) socket.emit('state_change', lastStatePayload);
    socket.emit('ramping_state', rampingState);

    socket.on('version', () => socket.emit('version', VERSION));
    socket.on('control_status', () => socket.emit('control_status', ALLOW_CONTROL));
    socket.on('state', () => {
      if (lastStatePayload) socket.emit('state_change', lastStatePayload);
      else pollPlaybackState();
    });

    socket.on('play', () => ALLOW_CONTROL && spotify && spotify.play().catch(e => console.error(e.message)));
    socket.on('pause', () => ALLOW_CONTROL && spotify && spotify.pause().catch(e => console.error(e.message)));
    socket.on('playToggle', async () => {
      if (!ALLOW_CONTROL || !spotify) return;
      try {
        const player = await spotify.getPlaybackState();
        if (player && player.is_playing) await spotify.pause();
        else await spotify.play();
      } catch (e) { console.error(e.message); }
    });
    socket.on('next', () => ALLOW_CONTROL && spotify && spotify.next().catch(e => console.error(e.message)));
    socket.on('previous', () => ALLOW_CONTROL && spotify && spotify.previous().catch(e => console.error(e.message)));

    socket.on('movePlayerPosition', (seconds) => {
      if (!ALLOW_CONTROL || !spotify) return;
      const currentPos = (lastStatePayload && lastStatePayload.state && lastStatePayload.state.position != null) ? lastStatePayload.state.position : 0;
      const delta = Number(seconds) || 0;
      const positionMs = Math.max(0, (currentPos + delta) * 1000);
      spotify.seek(positionMs).catch(e => console.error(e.message));
    });
    socket.on('setPlayerPosition', (seconds) => {
      if (!ALLOW_CONTROL || !spotify) return;
      const sec = Math.max(0, Number(seconds) || 0);
      spotify.seek(sec * 1000).catch(e => console.error(e.message));
    });

    socket.on('playtrack', (trackUriOrId) => ALLOW_CONTROL && spotify && spotify.playTrack(trackUriOrId).catch(e => console.error(e.message)));
    socket.on('playtrackincontext', (trackUriOrId, contextUriOrId) => {
      if (!ALLOW_CONTROL || !spotify) return;
      spotify.playTrackInContext(trackUriOrId, contextUriOrId).catch(e => console.error(e.message));
    });

    socket.on('volumeUp', () => {
      if (rampingState || !ALLOW_CONTROL || !spotify) return;
      const v = (lastStatePayload && lastStatePayload.state && lastStatePayload.state.volume != null) ? lastStatePayload.state.volume : 50;
      spotify.setVolume(Math.min(100, v + 10)).catch(e => console.error(e.message));
    });
    socket.on('volumeDown', () => {
      if (rampingState || !ALLOW_CONTROL || !spotify) return;
      const v = (lastStatePayload && lastStatePayload.state && lastStatePayload.state.volume != null) ? lastStatePayload.state.volume : 50;
      spotify.setVolume(Math.max(0, v - 10)).catch(e => console.error(e.message));
    });
    socket.on('setVolume', (volume0to100) => {
      if (rampingState || !ALLOW_CONTROL || !spotify) return;
      const v = Math.max(0, Math.min(100, Number(volume0to100) || 0));
      spotify.setVolume(v).catch(e => console.error(e.message));
    });
    socket.on('rampVolume', (targetVolume, changePercent, rampTimeSeconds) => {
      if (!ALLOW_CONTROL || !spotify) return;
      rampVolume(targetVolume, changePercent, rampTimeSeconds);
    });

    socket.on('mute', () => !rampingState && ALLOW_CONTROL && spotify && spotify.setVolume(0).catch(e => console.error(e.message)));
    socket.on('unmute', () => !rampingState && ALLOW_CONTROL && spotify && spotify.setVolume(lastNonZeroVolume || 50).catch(e => console.error(e.message)));
    socket.on('repeatOn', () => ALLOW_CONTROL && spotify && spotify.setRepeat('context').catch(e => console.error(e.message)));
    socket.on('repeatOff', () => ALLOW_CONTROL && spotify && spotify.setRepeat('off').catch(e => console.error(e.message)));
    socket.on('shuffleOn', () => ALLOW_CONTROL && spotify && spotify.setShuffle(true).catch(e => console.error(e.message)));
    socket.on('shuffleOff', () => ALLOW_CONTROL && spotify && spotify.setShuffle(false).catch(e => console.error(e.message)));
  });

  // ---- start / stop ----

  function start (port = PORT) {
    if (spotifyClientOverride) {
      spotify = spotifyClientOverride;
      startPolling();
      ensureDeviceAndTransfer().catch(() => {});
    } else {
      initSpotify();
    }
    return new Promise((resolve, reject) => {
      const onError = (err) => {
        server.removeListener('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        console.log(`spotify-controller-bridge listening on port ${port} (HTTP + Socket.io)`);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port);
    });
  }

  function stop () {
    stopPolling();
    if (rampIntervalId) {
      clearInterval(rampIntervalId);
      rampIntervalId = null;
    }
    rampingState = false;
    return new Promise((resolve) => {
      server.close(() => resolve());
    });
  }

  return { app, server, io, start, stop };
}

module.exports = { createServer };

if (require.main === module) {
  const s = createServer();
  s.start(PORT).then(() => {}).catch((err) => {
    console.error(err);
    process.exit(1);
  });
  process.on('SIGINT', () => {
    s.stop().then(() => process.exit(0));
  });
}
