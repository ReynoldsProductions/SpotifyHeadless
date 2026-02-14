(function () {
  var socket = io({ transports: ['websocket', 'polling'] });
  var titleEl = document.getElementById('title');
  var artistEl = document.getElementById('artist');
  var albumEl = document.getElementById('album');
  var albumArtEl = document.getElementById('albumArt');
  var progressBarEl = document.getElementById('progressBar');
  var elapsedEl = document.getElementById('elapsed');
  var remainingEl = document.getElementById('remaining');
  var connectionEl = document.getElementById('connection');
  var deviceEl = document.getElementById('device');

  function formatTime(seconds) {
    if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '0:00';
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function setConnectionStatus(connected) {
    connectionEl.textContent = connected ? 'Connected to bridge' : 'Disconnected';
    connectionEl.className = 'connection ' + (connected ? 'connected' : 'disconnected');
  }

  function renderState(payload) {
    if (!payload || !payload.playbackInfo) {
      titleEl.textContent = '—';
      artistEl.textContent = '—';
      albumEl.textContent = '—';
      albumArtEl.src = '';
      albumArtEl.alt = '';
      progressBarEl.style.setProperty('--progress', '0%');
      elapsedEl.textContent = '0:00';
      remainingEl.textContent = '−0:00';
      deviceEl.textContent = '—';
      deviceEl.classList.remove('active');
      return;
    }

    var info = payload.playbackInfo;
    var pos = info.playbackPosition != null ? info.playbackPosition : 0;
    var dur = info.duration != null ? info.duration / 1000 : 0;
    var pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;

    titleEl.textContent = info.name || '—';
    artistEl.textContent = info.artist || '—';
    albumEl.textContent = info.album || '—';

    if (info.albumArtUrl) {
      albumArtEl.src = info.albumArtUrl;
      albumArtEl.alt = (info.album ? info.album + ' – ' : '') + 'Album art';
    } else {
      albumArtEl.src = '';
      albumArtEl.alt = '';
    }

    progressBarEl.style.setProperty('--progress', pct + '%');
    elapsedEl.textContent = formatTime(pos);
    remainingEl.textContent = '−' + formatTime(Math.max(0, dur - pos));

    var deviceParts = [];
    if (info.deviceName) deviceParts.push(info.deviceName);
    if (info.deviceIsActive) deviceParts.push('(active)');
    deviceEl.textContent = deviceParts.length ? deviceParts.join(' ') : '—';
    deviceEl.classList.toggle('active', !!info.deviceIsActive);
  }

  socket.on('connect', function () {
    setConnectionStatus(true);
    socket.emit('state');
  });

  socket.on('disconnect', function () {
    setConnectionStatus(false);
  });

  socket.on('state_change', function (payload) {
    renderState(payload);
  });
})();
