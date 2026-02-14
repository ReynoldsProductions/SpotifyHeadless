/**
 * Spotify Web API wrapper using Refresh Token.
 * Node 18+ with global fetch. No external HTTP client.
 */

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const SPOTIFY_ACCOUNTS_BASE = 'https://accounts.spotify.com/api/token';

class SpotifyWebAPI {
  constructor (options = {}) {
    this.clientId = options.clientId || process.env.SPOTIFY_CLIENT_ID;
    this.clientSecret = options.clientSecret || process.env.SPOTIFY_CLIENT_SECRET;
    this.refreshToken = options.refreshToken || process.env.SPOTIFY_REFRESH_TOKEN;
    this.deviceId = options.deviceId || process.env.SPOTIFY_DEVICE_ID || null;
    this.deviceName = options.deviceName || process.env.SPOTIFY_DEVICE_NAME || null;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  _basicAuth () {
    const encoded = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    return `Basic ${encoded}`;
  }

  async _ensureToken () {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.accessToken;
    }
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken
    });
    const res = await fetch(SPOTIFY_ACCOUNTS_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: this._basicAuth()
      },
      body: body.toString()
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Spotify token refresh failed: ${res.status} ${text}`);
    }
    const data = await res.json();
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    return this.accessToken;
  }

  async _request (method, path, options = {}, retried = false) {
    const token = await this._ensureToken();
    const url = path.startsWith('http') ? path : `${SPOTIFY_API_BASE}${path}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      ...options.headers
    };
    if (options.body && typeof options.body === 'object' && !(options.body instanceof URLSearchParams) && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, {
      method,
      headers,
      body: options.body
    });
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) {
      let msg = `Spotify API ${res.status}`;
      try {
        const json = JSON.parse(text);
        if (json.error && json.error.message) msg += ': ' + json.error.message;
        else if (text) msg += ' ' + text;
      } catch {
        if (text) msg += ' ' + text;
      }
      if (res.status === 401 && !retried) {
        this.accessToken = null;
        return this._request(method, path, options, true);
      }
      throw new Error(msg);
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Spotify API invalid JSON (${res.status}): ${text.slice(0, 200)}`);
    }
  }

  async getPlaybackState () {
    const data = await this._request('GET', '/me/player');
    return data;
  }

  async getDevices () {
    const data = await this._request('GET', '/me/player/devices');
    return (data && data.devices) ? data.devices : [];
  }

  async transferPlayback (deviceId, play = false) {
    return this._request('PUT', '/me/player', {
      body: JSON.stringify({ device_ids: [deviceId], play })
    });
  }

  async play (options = {}) {
    const body = {};
    if (options.uris && options.uris.length) body.uris = options.uris;
    if (options.context_uri) body.context_uri = options.context_uri;
    if (options.offset) body.offset = options.offset;
    const qs = this.deviceId ? `?device_id=${encodeURIComponent(this.deviceId)}` : '';
    return this._request('PUT', `/me/player/play${qs}`, {
      body: Object.keys(body).length ? JSON.stringify(body) : undefined
    });
  }

  async pause () {
    const qs = this.deviceId ? `?device_id=${encodeURIComponent(this.deviceId)}` : '';
    return this._request('PUT', `/me/player/pause${qs}`);
  }

  async next () {
    const qs = this.deviceId ? `?device_id=${encodeURIComponent(this.deviceId)}` : '';
    return this._request('POST', `/me/player/next${qs}`);
  }

  async previous () {
    const qs = this.deviceId ? `?device_id=${encodeURIComponent(this.deviceId)}` : '';
    return this._request('POST', `/me/player/previous${qs}`);
  }

  async seek (positionMs) {
    const qs = `?position_ms=${Math.max(0, Math.floor(positionMs))}${this.deviceId ? `&device_id=${encodeURIComponent(this.deviceId)}` : ''}`;
    return this._request('PUT', `/me/player/seek${qs}`);
  }

  async setVolume (volumePercent) {
    const v = Math.max(0, Math.min(100, Math.round(volumePercent)));
    const qs = `?volume_percent=${v}${this.deviceId ? `&device_id=${encodeURIComponent(this.deviceId)}` : ''}`;
    return this._request('PUT', `/me/player/volume${qs}`);
  }

  async setRepeat (state) {
    const s = state === true || state === 'track' || state === 'context' ? state : (state === 'off' ? 'off' : 'context');
    const qs = `?state=${s}${this.deviceId ? `&device_id=${encodeURIComponent(this.deviceId)}` : ''}`;
    return this._request('PUT', `/me/player/repeat${qs}`);
  }

  async setShuffle (state) {
    const s = state === true || state === 'true' || state === 1;
    const qs = `?state=${s}${this.deviceId ? `&device_id=${encodeURIComponent(this.deviceId)}` : ''}`;
    return this._request('PUT', `/me/player/shuffle${qs}`);
  }

  /** Resolve track/context to URI (id or spotify:track:id). */
  _toUri (idOrUri) {
    if (!idOrUri) return null;
    const s = String(idOrUri).trim();
    if (s.startsWith('spotify:')) return s;
    if (s.includes(':')) return s;
    return `spotify:track:${s}`;
  }

  /** Play a single track by URI or ID. */
  async playTrack (trackUriOrId) {
    const uri = this._toUri(trackUriOrId);
    if (!uri) return;
    return this.play({ uris: [uri] });
  }

  /** Play a track in context (e.g. album/playlist). */
  async playTrackInContext (trackUriOrId, contextUriOrId) {
    const trackUri = this._toUri(trackUriOrId);
    let contextUri = contextUriOrId;
    if (contextUri && !String(contextUri).startsWith('spotify:')) {
      const kind = contextUriOrId.length === 22 ? 'album' : 'playlist';
      contextUri = `spotify:${kind}:${contextUri}`;
    }
    return this.play({
      context_uri: contextUri || undefined,
      offset: trackUri ? { uri: trackUri } : undefined
    });
  }
}

module.exports = { SpotifyWebAPI };
