/**
 * One-time loopback server to obtain a Spotify Refresh Token (Authorization Code Flow).
 * Run: node auth-helper.js
 * Requires SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in env (or .env).
 * Prints the auth URL; open it in a browser. Callback must use http://127.0.0.1:8888/callback.
 */

require('dotenv').config();
const http = require('http');

const REDIRECT_URI = 'http://127.0.0.1:8888/callback';
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing'
].join(' ');

function getAuthUrl () {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) {
    console.error('Error: SPOTIFY_CLIENT_ID is not set.');
    console.error('Set it in .env or export SPOTIFY_CLIENT_ID=your_client_id');
    process.exit(1);
  }
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    show_dialog: 'true'
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

function checkEnv () {
  const missing = [];
  if (!process.env.SPOTIFY_CLIENT_ID) missing.push('SPOTIFY_CLIENT_ID');
  if (!process.env.SPOTIFY_CLIENT_SECRET) missing.push('SPOTIFY_CLIENT_SECRET');
  if (missing.length) {
    console.error('Error: Missing required environment variable(s):');
    missing.forEach((v) => console.error('  - ' + v));
    console.error('Set them in .env or export before running. Redirect URI must be: ' + REDIRECT_URI);
    process.exit(1);
  }
}

async function exchangeCodeForTokens (code) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET required');
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI
  });
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${auth}`
    },
    body: body.toString()
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }
  return res.json();
}

function runLoopback () {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      if (url.pathname !== '/callback') {
        res.writeHead(302, { Location: getAuthUrl() });
        res.end();
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      const html = (body) => `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Spotify Auth</title></head>
<body style="font-family:sans-serif;max-width:560px;margin:2em auto;padding:1em;">
${body}
</body></html>`;
      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html(`<p style="color:red;">Authorization failed: ${error}</p><p>You can close this tab.</p>`));
        server.close();
        resolve(null);
        return;
      }
      if (!code) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html('<p>No code received. Try again.</p>'));
        server.close();
        resolve(null);
        return;
      }
      try {
        const tokens = await exchangeCodeForTokens(code);
        const refreshToken = tokens.refresh_token;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html(`
<h2>Success</h2>
<p>Your refresh token is printed in the terminal. Add <code>SPOTIFY_REFRESH_TOKEN=...</code> to your <code>.env</code>. You can close this tab.</p>
        `));
        server.close();
        resolve(refreshToken);
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html(`<p style="color:red;">Error: ${err.message}</p><p>You can close this tab.</p>`));
        server.close();
        resolve(null);
      }
    });
    server.listen(8888, '127.0.0.1', () => {
      console.log('Open this URL in your browser (redirect URI must be http://127.0.0.1:8888/callback):\n');
      console.log(getAuthUrl());
      console.log('\nWaiting for callback at ' + REDIRECT_URI + ' ...');
    });
  });
}

if (require.main === module) {
  checkEnv();
  runLoopback().then((refreshToken) => {
    if (refreshToken) {
      console.log('\n--- Refresh token (add to .env as SPOTIFY_REFRESH_TOKEN) ---');
      console.log(refreshToken);
      console.log('---');
    } else {
      console.error('\nNo refresh token received.');
      process.exit(1);
    }
    process.exit(0);
  });
}

module.exports = { getAuthUrl, exchangeCodeForTokens, runLoopback, checkEnv };
