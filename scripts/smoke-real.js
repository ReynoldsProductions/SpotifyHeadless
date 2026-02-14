/**
 * Smoke test against a real bridge at http://127.0.0.1:8801.
 * Connects via socket.io, logs state_change, emits state, playToggle, next, volumeDown, pause.
 * Exit 0 if at least one state_change received and no error events; else exit 1.
 */

const { io } = require('socket.io-client');

const URL = 'http://127.0.0.1:8801';
const STEP_MS = 1800;
const TOTAL_MS = STEP_MS * 5 + 1000;

let sawStateChange = false;
let hadError = false;
let exited = false;

function exit (code) {
  if (exited) return;
  exited = true;
  client.close();
  process.exit(code);
}

const client = io(URL, { transports: ['polling', 'websocket'], timeout: 5000 });

client.on('state_change', (payload) => {
  sawStateChange = true;
  const info = payload && payload.playbackInfo ? payload.playbackInfo : {};
  const state = payload && payload.state ? payload.state : {};
  console.log('[state_change]', info.name || '(no track)', state.state, 'vol=' + (state.volume ?? '?'));
});

client.on('connect_error', (err) => {
  hadError = true;
  console.error('connect_error:', err.message);
});

client.on('error', (err) => {
  hadError = true;
  console.error('error:', err);
});

client.on('connect', () => {
  console.log('Connected, emitting state...');
  client.emit('state');

  setTimeout(() => {
    console.log('Emitting playToggle');
    client.emit('playToggle');
  }, STEP_MS);

  setTimeout(() => {
    console.log('Emitting next');
    client.emit('next');
  }, STEP_MS * 2);

  setTimeout(() => {
    console.log('Emitting volumeDown');
    client.emit('volumeDown');
  }, STEP_MS * 3);

  setTimeout(() => {
    console.log('Emitting pause');
    client.emit('pause');
  }, STEP_MS * 4);

  setTimeout(() => {
    const ok = sawStateChange && !hadError;
    console.log(ok ? 'Smoke OK' : 'Smoke FAIL');
    exit(ok ? 0 : 1);
  }, STEP_MS * 5 + 500);
});

setTimeout(() => {
  if (!exited) {
    console.error('Smoke timeout (no connect or incomplete)');
    exit(1);
  }
}, TOTAL_MS + 5000);

client.on('connect_timeout', () => {
  hadError = true;
  console.error('connect_timeout');
});
