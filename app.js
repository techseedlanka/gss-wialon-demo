/**
 * app.js — Wialon GPS & Attendance Demo Dashboard
 * Gajashakthi Client Demo · Built for Vercel hosting
 *
 * Architecture:
 *  ActivityLogger  — real-time API log panel
 *  WialonAPI       — REST client with session management & auto-retry
 *  MapController   — Leaflet map, markers, polylines, geofences
 *  AttendanceModule — Clock-In logic, localStorage persistence
 *  TravelModule    — Daily/history distance, Haversine, mock fallback
 *  LocationMasterModule — Map-click picker, geofence CRUD, localStorage
 *  App             — Orchestrator, tab switching, theme toggle
 */

'use strict';

// ════════════════════════════════════════════════════════════
//  CONFIGURATION
// ════════════════════════════════════════════════════════════
const CONFIG = {
  TOKEN: 'ed34d48a22c6a33560f031f6765a128bFA927B87C97308BA15E7AA6FF88879BA1BC91008',

  /**
   * When served via HTTP (Vercel, vercel dev, Live Server), use the
   * serverless proxy at /api/wialon to avoid CORS issues.
   * When opened directly as file://, call Wialon's API directly.
   */
  get API_URL() {
    return window.location.protocol === 'file:'
      ? 'https://hst-api.wialon.com/wialon/ajax.html'
      : '/api/wialon';
  },

  NOMINATIM: 'https://nominatim.openstreetmap.org/reverse',

  TILES: {
    dark: {
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attr: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OSM</a> © <a href="https://carto.com/attributions" target="_blank">CARTO</a>',
    },
    light: {
      url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      attr: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OSM</a> © <a href="https://carto.com/attributions" target="_blank">CARTO</a>',
    },
  },

  DEFAULT_CENTER: [6.9271, 79.8612], // Colombo, Sri Lanka
  DEFAULT_ZOOM:   12,
};

// ════════════════════════════════════════════════════════════
//  ACTIVITY LOGGER
// ════════════════════════════════════════════════════════════
class ActivityLogger {
  constructor() {
    this.el = document.getElementById('activity-log');
  }

  _append(type, message) {
    const item = document.createElement('div');
    item.className = `api-log-item ${type}`;
    const t = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    item.innerHTML = `<span class="log-time">${t}</span><span class="log-msg">${message}</span>`;
    this.el.prepend(item);
    while (this.el.children.length > 60) this.el.removeChild(this.el.lastChild);
  }

  info(msg)    { this._append('info',    msg); }
  success(msg) { this._append('success', msg); }
  warn(msg)    { this._append('warn',    msg); }
  error(msg)   { this._append('error',   msg); }
  clear()      { this.el.innerHTML = ''; }
}

// ════════════════════════════════════════════════════════════
//  WIALON API CLIENT
// ════════════════════════════════════════════════════════════
class WialonAPI {
  constructor(logger) {
    this.logger = logger;
    this.sid    = null;
  }

  // ── Internal fetch wrapper ────────────────────────────────
  // Strategy: Try the Vercel proxy (/api/wialon) first.
  // If the proxy is not available (e.g., npx serve locally), the server
  // returns HTML instead of JSON. We detect this and fall back to the
  // direct Wialon API URL. This means the app works with any static server.
  async _fetch(svc, params, sid = null) {
    this.logger.info(`→ ${svc}`);

    const buildUrl = (base) => {
      const url = new URL(base, window.location.href);
      url.searchParams.set('svc',    svc);
      url.searchParams.set('params', JSON.stringify(params));
      if (sid) url.searchParams.set('sid', sid);
      return url.toString();
    };

    const DIRECT = 'https://hst-api.wialon.com/wialon/ajax.html';

    // When opened as file://, go direct immediately
    if (window.location.protocol === 'file:') {
      return this._doFetch(buildUrl(DIRECT));
    }

    // Otherwise, try the proxy first
    try {
      const result = await this._doFetch(buildUrl('/api/wialon'));
      return result;
    } catch (proxyErr) {
      // Proxy not available (e.g. plain static server) — fall back to direct
      this.logger.warn(`Proxy unavailable (${proxyErr.message}) — using direct API.`);
      return this._doFetch(buildUrl(DIRECT));
    }
  }

  async _doFetch(url) {
    const res  = await fetch(url);
    const text = await res.text();
    // Detect HTML fallback from a static server (proxy not found)
    if (text.trimStart().startsWith('<')) {
      throw new Error('proxy_returned_html');
    }
    return JSON.parse(text);
  }

  // ── Authenticate ──────────────────────────────────────────
  async login() {
    this.logger.info('Authenticating with token…');
    const data = await this._fetch('token/login', { token: CONFIG.TOKEN });

    if (data?.eid) {
      this.sid = data.eid;
      this.logger.success(`Session OK — eid: ${this.sid.slice(0, 8)}…`);
      return data;
    }

    const errMsg = `Auth failed (error ${data?.error ?? 'unknown'})`;
    this.logger.error(errMsg);
    throw new Error(errMsg);
  }

  // ── Generic request with auto-retry on session expiry ─────
  async request(svc, params, _retry = true) {
    if (!this.sid) await this.login();

    const data = await this._fetch(svc, params, this.sid);

    // error:1 = invalid session — re-auth and retry once
    if (data?.error === 1 && _retry) {
      this.logger.warn('Session expired — re-authenticating…');
      this.sid = null;
      await this.login();
      return this.request(svc, params, false);
    }

    if (data?.error && data.error !== 0) {
      this.logger.warn(`Wialon error ${data.error} on ${svc}`);
    }

    return data;
  }

  // ── Search all avl_unit items ─────────────────────────────
  async searchItems() {
    return this.request('core/search_items', {
      spec: {
        itemsType:     'avl_unit',
        propName:      'sys_name',
        propValueMask: '*',
        sortType:      'sys_name',
      },
      force: 1,
      flags: 1025,   // base data + last position
      from:  0,
      to:    0,
    });
  }

  // ── Get a single item with real-time position ─────────────
  async searchItem(id, flags = 4194304) {
    return this.request('core/search_item', { id, flags });
  }

  // ── Load messages for a time interval ────────────────────
  async loadMessages(itemId, timeFrom, timeTo) {
    this.logger.info(`Loading GPS messages (${new Date(timeFrom * 1000).toLocaleDateString()} – ${new Date(timeTo * 1000).toLocaleDateString()})…`);

    const result = await this.request('messages/load_interval', {
      itemId,
      timeFrom,
      timeTo,
      flags:     0x0000,
      flagsMask: 0xFF00,
      loadCount: 65535,
    });

    if (!result) return [];

    // Some API versions return messages directly
    if (Array.isArray(result.messages)) {
      this.logger.info(`Received ${result.messages.length} messages.`);
      return result.messages;
    }

    // Older API: count is returned; fetch messages separately
    const count = result.count ?? 0;
    if (count > 0) {
      const msgs = await this.request('messages/get_messages', {
        indexFrom: 0,
        indexTo:   Math.min(count - 1, 65534),
      });
      const list = msgs?.messages ?? [];
      this.logger.info(`Received ${list.length} messages.`);
      return list;
    }

    this.logger.warn('No messages found for selected range.');
    return [];
  }

  // ── Nominatim reverse geocoding ───────────────────────────
  async reverseGeocode(lat, lng) {
    try {
      const url = `${CONFIG.NOMINATIM}?lat=${lat}&lon=${lng}&format=json&accept-language=en`;
      const res  = await fetch(url);
      const data = await res.json();
      return data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    } catch {
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  }
}

// ════════════════════════════════════════════════════════════
//  MAP CONTROLLER
// ════════════════════════════════════════════════════════════
class MapController {
  constructor() {
    this.map              = null;
    this.tileLayer        = null;
    this.unitMarker       = null;
    this.routeLayer       = null;
    this.routeDecorations = []; // start/end markers
    this.clockinMarkers   = [];
    this.geofenceLayers   = []; // { circle, pin }
    this.pickerMarker     = null;
    this.pickerCallback   = null;
    this.currentTheme     = document.documentElement.dataset.theme || 'dark';
  }

  init() {
    this.map = L.map('map', {
      center:      CONFIG.DEFAULT_CENTER,
      zoom:        CONFIG.DEFAULT_ZOOM,
      zoomControl: false,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    this._applyTiles();

    // Location picker on map click
    this.map.on('click', (e) => {
      if (this.pickerCallback) this._handlePickerClick(e.latlng);
    });
  }

  // ── Tile management ───────────────────────────────────────
  _applyTiles() {
    const t = CONFIG.TILES[this.currentTheme];
    if (this.tileLayer) this.map.removeLayer(this.tileLayer);
    this.tileLayer = L.tileLayer(t.url, {
      attribution: t.attr,
      maxZoom:     19,
      subdomains:  'abcd',
    }).addTo(this.map);
  }

  setTheme(theme) {
    this.currentTheme = theme;
    this._applyTiles();
  }

  // ── Marker factories ──────────────────────────────────────
  _pulsingIcon(color = '#00d4ff', size = 22) {
    return L.divIcon({
      className: '',
      html: `<div class="map-marker-unit" style="--mc:${color};width:${size}px;height:${size}px"></div>`,
      iconSize:   [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor:[0, -(size + 4)],
    });
  }

  _pinIcon(color = '#10b981', label = 'S') {
    return L.divIcon({
      className: '',
      html: `
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
          <ellipse cx="14" cy="34" rx="6" ry="2" fill="rgba(0,0,0,0.25)"/>
          <path d="M14 1C7.9 1 3 5.9 3 12c0 8.5 11 23 11 23S25 20.5 25 12C25 5.9 20.1 1 14 1z" fill="${color}" stroke="white" stroke-width="1.5"/>
          <text x="14" y="15" font-family="Inter,sans-serif" font-size="9" font-weight="700" fill="white" text-anchor="middle" dominant-baseline="middle">${label}</text>
        </svg>`,
      iconSize:    [28, 36],
      iconAnchor:  [14, 36],
      popupAnchor: [0, -36],
    });
  }

  // ── Unit live marker ──────────────────────────────────────
  setUnitMarker(lat, lng, name) {
    if (this.unitMarker) this.map.removeLayer(this.unitMarker);
    this.unitMarker = L.marker([lat, lng], {
      icon:           this._pulsingIcon('#00d4ff', 22),
      zIndexOffset:   1000,
    })
      .bindPopup(`<b>${name}</b><p>Lat: ${lat.toFixed(5)}</p><p>Lng: ${lng.toFixed(5)}</p>`)
      .addTo(this.map);
    this.map.flyTo([lat, lng], 14, { duration: 1.5 });
  }

  // ── Route polyline ────────────────────────────────────────
  drawRoute(latlngs, color = '#00d4ff', fitBounds = true) {
    this.clearRoute();
    if (latlngs.length < 2) return;

    this.routeLayer = L.polyline(latlngs, {
      color,
      weight:       3.5,
      opacity:      0.88,
      smoothFactor: 1,
      lineJoin:     'round',
    }).addTo(this.map);

    // Start / End pins
    const startPin = L.marker(latlngs[0], {
      icon: this._pinIcon('#10b981', 'S'),
    }).bindPopup('<b>Start Point</b>').addTo(this.map);

    const endPin = L.marker(latlngs[latlngs.length - 1], {
      icon: this._pinIcon('#ef4444', 'E'),
    }).bindPopup('<b>End Point</b>').addTo(this.map);

    this.routeDecorations = [startPin, endPin];

    if (fitBounds) {
      this.map.fitBounds(this.routeLayer.getBounds(), { padding: [40, 40], maxZoom: 16 });
    }
  }

  clearRoute() {
    if (this.routeLayer) { this.map.removeLayer(this.routeLayer); this.routeLayer = null; }
    this.routeDecorations.forEach(m => this.map.removeLayer(m));
    this.routeDecorations = [];
  }

  // ── Clock-In marker ───────────────────────────────────────
  addClockInMarker(lat, lng, address) {
    const m = L.marker([lat, lng], {
      icon: this._pulsingIcon('#f59e0b', 16),
    }).bindPopup(`<b>Clock-In</b><p>${address.slice(0, 80)}…</p>`).addTo(this.map);
    this.clockinMarkers.push(m);
    return m;
  }

  // ── Geofence circle + pin ─────────────────────────────────
  addGeofence(lat, lng, radius, name) {
    const circle = L.circle([lat, lng], {
      radius,
      color:       '#7c3aed',
      fillColor:   '#7c3aed',
      fillOpacity: 0.08,
      weight:      2,
      dashArray:   '5 4',
    }).bindPopup(`<b>${name}</b><p>Radius: ${radius}m</p>`).addTo(this.map);

    const pin = L.marker([lat, lng], {
      icon: this._pinIcon('#7c3aed', '📍'),
    }).bindPopup(`<b>${name}</b><p>${radius}m geofence</p>`).addTo(this.map);

    this.geofenceLayers.push({ circle, pin });
  }

  clearGeofences() {
    this.geofenceLayers.forEach(({ circle, pin }) => {
      this.map.removeLayer(circle);
      this.map.removeLayer(pin);
    });
    this.geofenceLayers = [];
  }

  // ── Location Picker ───────────────────────────────────────
  enablePicker(cb) {
    this.pickerCallback = cb;
    this.map.getContainer().style.cursor = 'crosshair';
  }

  disablePicker() {
    this.pickerCallback = null;
    this.map.getContainer().style.cursor = '';
    if (this.pickerMarker) {
      this.map.removeLayer(this.pickerMarker);
      this.pickerMarker = null;
    }
  }

  _handlePickerClick(latlng) {
    if (this.pickerMarker) this.map.removeLayer(this.pickerMarker);
    this.pickerMarker = L.marker(latlng, {
      draggable: true,
      icon:      this._pinIcon('#7c3aed', '+'),
    }).addTo(this.map);

    this.pickerMarker.on('drag', (e) => {
      if (this.pickerCallback) this.pickerCallback(e.target.getLatLng());
    });

    this.pickerCallback(latlng);
  }

  // ── Pan / fly ─────────────────────────────────────────────
  panTo(lat, lng, zoom = 16) {
    this.map.flyTo([lat, lng], zoom, { duration: 1 });
  }
}

// ════════════════════════════════════════════════════════════
//  ATTENDANCE MODULE
// ════════════════════════════════════════════════════════════
class AttendanceModule {
  constructor(api, mapCtrl, logger) {
    this.api    = api;
    this.map    = mapCtrl;
    this.logger = logger;
    this.log    = JSON.parse(localStorage.getItem('gps_attendance_log') || '[]');
    this._render();
  }

  async clockIn(unitId) {
    const btn = document.getElementById('btn-clockin');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-sm"></span> Fetching Position…';

    try {
      this.logger.info(`Fetching real-time position for unit ${unitId}…`);
      const result = await this.api.searchItem(unitId, 4194304);

      const item = result?.item;
      if (!item) throw new Error('Unit not found in response.');

      // Position can appear in different fields depending on API version / flags
      const pos = item.pos || item.lmsg?.pos;
      if (!pos) throw new Error('No GPS position data returned. Is the device online?');

      const lat   = pos.y;
      const lng   = pos.x;
      const speed = pos.s ?? 0;
      const ts    = item.lmsg?.t ?? pos.t ?? Math.floor(Date.now() / 1000);
      const utc   = new Date(ts * 1000).toUTCString();

      // Update live card
      document.getElementById('val-lat').textContent   = lat.toFixed(6);
      document.getElementById('val-lng').textContent   = lng.toFixed(6);
      document.getElementById('val-speed').textContent = `${speed} km/h`;
      document.getElementById('val-time').textContent  = utc;

      // Reverse geocode address
      this.logger.info('Resolving address…');
      const address = await this.api.reverseGeocode(lat, lng);
      document.getElementById('val-address').textContent = address;
      this.logger.success('Address resolved.');

      // Stationary check
      const badge = document.getElementById('stationary-badge');
      badge.classList.toggle('show', speed === 0);

      // Map
      this.map.addClockInMarker(lat, lng, address);
      this.map.panTo(lat, lng, 16);

      // Persist log entry
      const entry = {
        id: Date.now(), timestamp: new Date().toISOString(),
        lat, lng, speed, address, stationary: speed === 0,
      };
      this.log.unshift(entry);
      this._saveLog();
      this._render();

      this.logger.success(`Clock-In recorded — ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    } catch (err) {
      this.logger.error(`Clock-In failed: ${err.message}`);
      // Show a non-blocking toast style message
      this._showError(err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="user-check"></i> Simulate Employee Clock-In';
      lucide.createIcons({ attrs: { 'stroke-width': 2 } });
    }
  }

  _saveLog() {
    localStorage.setItem('gps_attendance_log', JSON.stringify(this.log.slice(0, 100)));
  }

  _render() {
    const container = document.getElementById('attendance-log');
    if (!this.log.length) {
      container.innerHTML = '<div class="empty-state">No entries yet — click Clock-In to begin.</div>';
      return;
    }

    container.innerHTML = this.log.slice(0, 30).map(e => {
      const dt   = new Date(e.timestamp);
      const time = dt.toLocaleString();
      const addrShort = e.address.length > 90 ? e.address.slice(0, 88) + '…' : e.address;
      return `
        <div class="log-entry">
          <div class="log-entry-header">
            <span class="log-entry-time">${time}</span>
            <span class="badge ${e.stationary ? 'badge--green' : 'badge--amber'}">
              ${e.stationary ? '✓ Stationary' : '⚡ Moving'}
            </span>
          </div>
          <div class="log-entry-addr">${addrShort}</div>
          <div class="log-entry-coords">${e.lat.toFixed(5)}, ${e.lng.toFixed(5)} · ${e.speed} km/h</div>
        </div>`;
    }).join('');
  }

  _showError(msg) {
    const container = document.getElementById('attendance-log');
    const errEl = document.createElement('div');
    errEl.className = 'log-entry';
    errEl.style.borderColor = 'var(--red)';
    errEl.innerHTML = `<div class="log-entry-header"><span class="badge badge--red">⚠ Error</span></div>
      <div class="log-entry-addr" style="color:var(--red)">${msg}</div>`;
    container.prepend(errEl);
    setTimeout(() => errEl.remove(), 8000);
  }
}

// ════════════════════════════════════════════════════════════
//  TRAVEL MODULE
// ════════════════════════════════════════════════════════════
class TravelModule {
  constructor(api, mapCtrl, logger) {
    this.api    = api;
    this.map    = mapCtrl;
    this.logger = logger;
  }

  // ── Haversine great-circle distance (km) ──────────────────
  haversine(lat1, lon1, lat2, lon2) {
    const R    = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a    = Math.sin(dLat / 2) ** 2
               + Math.cos(lat1 * Math.PI / 180)
               * Math.cos(lat2 * Math.PI / 180)
               * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ── Extract GPS points and compute distance ───────────────
  processMessages(messages) {
    const pts = messages
      .filter(m => m.pos?.y && m.pos?.x)
      .map(m => ({ lat: m.pos.y, lng: m.pos.x, t: m.t ?? 0, s: m.pos.s ?? 0 }))
      .sort((a, b) => a.t - b.t);

    let dist = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = this.haversine(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
      // Sanity-check: ignore jumps > 2 km between consecutive points (GPS noise)
      if (d < 2) dist += d;
    }
    return { pts, dist };
  }


  // ── Helpers ───────────────────────────────────────────────
  _fmtTime(unix) { return unix ? new Date(unix * 1000).toLocaleTimeString() : '—'; }

  _duration(start, end) {
    if (!start || !end) return '—';
    const diff = end - start;
    const h    = Math.floor(diff / 3600);
    const m    = Math.floor((diff % 3600) / 60);
    return h ? `${h}h ${m}m` : `${m}m`;
  }

  _setBtn(id, loading) {
    const btn    = document.getElementById(id);
    const icons  = { 'btn-daily-travel': 'route', 'btn-history': 'calendar-range' };
    btn.disabled = loading;
    btn.innerHTML = loading
      ? '<span class="spinner-sm"></span> Loading…'
      : `<i data-lucide="${icons[id]}"></i> ${btn.id === 'btn-daily-travel' ? 'View Daily Travel' : 'Load Route History'}`;
    if (!loading) lucide.createIcons({ attrs: { 'stroke-width': 2 } });
  }


  // ── Feature 2: Daily Travel ───────────────────────────────
  async loadDailyTravel(unitId, dateStr) {
    this._setBtn('btn-daily-travel', true);
    this.map.clearRoute();
    document.getElementById('mock-banner').classList.remove('show');

    try {
      const day   = new Date(dateStr);
      const start = new Date(day); start.setHours(0, 0, 0, 0);
      const end   = new Date(day); end.setHours(23, 59, 59, 999);
      const tf    = Math.floor(start.getTime() / 1000);
      const tt    = Math.floor(end.getTime()   / 1000);

      const messages = await this.api.loadMessages(unitId, tf, tt);
      const { pts, dist } = this.processMessages(messages);

      if (pts.length < 2) {
        throw new Error('No travel data available for this unit on the selected date.');
      }

      this.map.drawRoute(pts.map(p => [p.lat, p.lng]), '#00d4ff');

      // Update UI
      document.getElementById('daily-stats').style.display = 'grid';
      document.getElementById('daily-km').textContent  = dist.toFixed(2);
      document.getElementById('daily-pts').textContent = pts.length;
      document.getElementById('daily-route-info').style.display = 'block';
      document.getElementById('daily-start').textContent = this._fmtTime(pts[0]?.t);
      document.getElementById('daily-end').textContent   = this._fmtTime(pts[pts.length - 1]?.t);
      document.getElementById('daily-dur').textContent   = this._duration(pts[0]?.t, pts[pts.length - 1]?.t);
      this.logger.success(`Daily travel: ${dist.toFixed(2)} km over ${pts.length} points.`);
    } catch (err) {
      this.logger.error(`Daily travel error: ${err.message}`);
    } finally {
      this._setBtn('btn-daily-travel', false);
    }
  }

  // ── Feature 3: Travel History ─────────────────────────────
  async loadTravelHistory(unitId, startDt, endDt) {
    this._setBtn('btn-history', true);
    this.map.clearRoute();
    document.getElementById('mock-banner').classList.remove('show');

    try {
      const tf = Math.floor(new Date(startDt).getTime() / 1000);
      const tt = Math.floor(new Date(endDt).getTime()   / 1000);

      if (tf >= tt) throw new Error('Start date/time must be before end date/time.');

      const messages = await this.api.loadMessages(unitId, tf, tt);
      const { pts, dist } = this.processMessages(messages);

      if (pts.length < 2) {
        throw new Error('No travel data available for this unit in the selected timeframe.');
      }

      this.map.drawRoute(pts.map(p => [p.lat, p.lng]), '#f59e0b');

      document.getElementById('hist-stats').style.display = 'grid';
      document.getElementById('hist-km').textContent  = dist.toFixed(2);
      document.getElementById('hist-pts').textContent = pts.length;

      document.getElementById('hist-route-info').style.display   = 'block';
      document.getElementById('hist-start-lbl').textContent = new Date(tf * 1000).toLocaleString();
      document.getElementById('hist-end-lbl').textContent   = new Date(tt * 1000).toLocaleString();
      document.getElementById('hist-dur').textContent       = this._duration(tf, tt);
      this.logger.success(`History: ${dist.toFixed(2)} km over ${pts.length} points.`);
    } catch (err) {
      this.logger.error(`History error: ${err.message}`);
    } finally {
      this._setBtn('btn-history', false);
    }
  }
}

// ════════════════════════════════════════════════════════════
//  LOCATION MASTER MODULE
// ════════════════════════════════════════════════════════════
class LocationMasterModule {
  constructor(mapCtrl, logger) {
    this.map       = mapCtrl;
    this.logger    = logger;
    this.locations = JSON.parse(localStorage.getItem('gps_locations') || '[]');
    this.active    = false; // picker active?

    // Render existing locations on startup
    this._renderGeofences();
    this._renderList();
  }

  enablePicker() {
    if (this.active) return;
    this.active = true;
    this.map.enablePicker((latlng) => {
      document.getElementById('loc-lat').value = latlng.lat.toFixed(6);
      document.getElementById('loc-lng').value = latlng.lng.toFixed(6);
    });
    this.logger.info('Location picker active — click map to place pin.');
  }

  disablePicker() {
    this.active = false;
    this.map.disablePicker();
  }

  save() {
    const name   = document.getElementById('loc-name').value.trim();
    const radius = parseInt(document.getElementById('loc-radius').value, 10) || 100;
    const lat    = parseFloat(document.getElementById('loc-lat').value);
    const lng    = parseFloat(document.getElementById('loc-lng').value);

    if (!name)            { alert('Please enter a location name.'); return; }
    if (isNaN(lat) || isNaN(lng)) { alert('Please click on the map to set coordinates.'); return; }

    const loc = { id: Date.now(), name, radius, lat, lng };
    this.locations.push(loc);
    localStorage.setItem('gps_locations', JSON.stringify(this.locations));

    this.map.addGeofence(lat, lng, radius, name);
    this._renderList();

    // Reset form (keep picker active for next entry)
    document.getElementById('loc-name').value = '';
    document.getElementById('loc-lat').value  = '';
    document.getElementById('loc-lng').value  = '';
    if (this.map.pickerMarker) {
      this.map.map.removeLayer(this.map.pickerMarker);
      this.map.pickerMarker = null;
    }

    this.logger.success(`Location "${name}" saved (${radius}m geofence).`);
    this.map.panTo(lat, lng, 15);
  }

  delete(id) {
    this.locations = this.locations.filter(l => l.id !== id);
    localStorage.setItem('gps_locations', JSON.stringify(this.locations));
    this._renderGeofences();
    this._renderList();
    this.logger.info('Location deleted.');
  }

  panTo(lat, lng) {
    this.map.panTo(lat, lng, 16);
  }

  _renderGeofences() {
    this.map.clearGeofences();
    this.locations.forEach(l => this.map.addGeofence(l.lat, l.lng, l.radius, l.name));
  }

  _renderList() {
    const container = document.getElementById('location-list');
    if (!this.locations.length) {
      container.innerHTML = '<div class="empty-state">No locations saved yet.</div>';
      return;
    }
    container.innerHTML = this.locations.map(l => `
      <div class="location-item" onclick="window._app.locMod.panTo(${l.lat},${l.lng})">
        <span class="location-item-emoji">📍</span>
        <div class="location-item-info">
          <div class="location-item-name">${l.name}</div>
          <div class="location-item-meta">${l.radius}m · ${l.lat.toFixed(4)}, ${l.lng.toFixed(4)}</div>
        </div>
        <button class="location-item-del" title="Delete"
          onclick="event.stopPropagation();window._app.locMod.delete(${l.id})">×</button>
      </div>`).join('');
  }
}

// ════════════════════════════════════════════════════════════
//  APP — MAIN ORCHESTRATOR
// ════════════════════════════════════════════════════════════
class App {
  constructor() {
    this.logger   = new ActivityLogger();
    this.api      = new WialonAPI(this.logger);
    this.mapCtrl  = new MapController();
    this.attend   = null;
    this.travel   = null;
    this.locMod   = null;
    this.units    = [];

    // Expose globally for inline event handlers
    window._app = this;
  }

  async init() {
    // Init map
    this.mapCtrl.init();

    // Initialise sub-modules (they use localStorage, so can run immediately)
    this.attend = new AttendanceModule(this.api, this.mapCtrl, this.logger);
    this.travel = new TravelModule(this.api, this.mapCtrl, this.logger);
    this.locMod = new LocationMasterModule(this.mapCtrl, this.logger);

    // Default dates
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('daily-date').value = today;

    const now     = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    document.getElementById('hist-start').value = weekAgo.toISOString().slice(0, 16);
    document.getElementById('hist-end').value   = now.toISOString().slice(0, 16);

    // Wire up UI
    this._setupTabs();
    this._setupTheme();
    this._setupClockIn();
    this._setupDailyTravel();
    this._setupHistory();
    this._setupLocationMaster();
    document.getElementById('btn-clear-log').addEventListener('click', () => this.logger.clear());

    // Connect to Wialon
    await this._connect();

    // Hide loading overlay
    const overlay = document.getElementById('map-loading');
    overlay.classList.add('hidden');
    setTimeout(() => overlay.remove(), 500);

    // Init Lucide icons
    lucide.createIcons({ attrs: { 'stroke-width': 2 } });
  }

  // ── Wialon connection ─────────────────────────────────────
  async _connect() {
    this._status('connecting', 'Connecting to Wialon…');
    try {
      await this.api.login();
      const result = await this.api.searchItems();

      if (result?.items?.length) {
        this.units = result.items;
        this._populateUnits(result.items);
        this._status('connected', `Connected · ${result.items.length} unit(s) found`);

        // Try to center map on first unit's known position
        const first = result.items[0];
        const pos   = first?.pos || first?.lmsg?.pos;
        if (pos?.y && pos?.x) {
          this.mapCtrl.setUnitMarker(pos.y, pos.x, first.nm);
        }
      } else {
        this._status('connected', 'Connected · No units available');
        this.logger.warn('No AVL units found in this account.');
      }
    } catch (err) {
      this._status('error', 'Connection failed');
      this.logger.error(`Connection error: ${err.message}`);
    }
  }

  _status(state, text) {
    document.getElementById('status-dot').className = `status-dot status-dot--${state}`;
    document.getElementById('status-text').textContent = text;
  }

  _populateUnits(units) {
    const sel = document.getElementById('unit-select');
    sel.innerHTML = units.map(u => `<option value="${u.id}">${u.nm}</option>`).join('');
    sel.addEventListener('change', () => {
      const unit = units.find(u => u.id === parseInt(sel.value, 10));
      this.logger.info(`Unit selected: ${unit?.nm ?? 'Unknown'}`);
      const pos = unit?.pos || unit?.lmsg?.pos;
      if (pos?.y && pos?.x) this.mapCtrl.setUnitMarker(pos.y, pos.x, unit.nm);
    });
  }

  _getUnitId() {
    return parseInt(document.getElementById('unit-select').value, 10);
  }

  // ── Tab switching ─────────────────────────────────────────
  _setupTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        document.querySelectorAll('.tab').forEach(t => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        document.getElementById(`panel-${target}`).classList.add('active');

        // Enable location picker when on Locations tab
        if (target === 'locations') {
          this.locMod.enablePicker();
        } else {
          this.locMod.disablePicker();
        }
      });
    });
  }

  // ── Theme toggle ──────────────────────────────────────────
  _setupTheme() {
    const btn      = document.getElementById('btn-theme');
    const iconSun  = document.getElementById('icon-sun');
    const iconMoon = document.getElementById('icon-moon');

    btn.addEventListener('click', () => {
      const curr = document.documentElement.dataset.theme;
      const next = curr === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      this.mapCtrl.setTheme(next);

      iconSun.style.display  = next === 'dark'  ? 'none' : 'block';
      iconMoon.style.display = next === 'light' ? 'none' : 'block';
    });
  }

  // ── Feature buttons ───────────────────────────────────────
  _setupClockIn() {
    document.getElementById('btn-clockin').addEventListener('click', () => {
      const id = this._getUnitId();
      if (!id || isNaN(id)) { alert('Please select a vehicle first.'); return; }
      this.attend.clockIn(id);
    });
  }

  _setupDailyTravel() {
    document.getElementById('btn-daily-travel').addEventListener('click', () => {
      const id   = this._getUnitId();
      const date = document.getElementById('daily-date').value;
      if (!id || isNaN(id)) { alert('Please select a vehicle.'); return; }
      if (!date)            { alert('Please select a date.'); return; }
      this.travel.loadDailyTravel(id, date);
    });
  }

  _setupHistory() {
    document.getElementById('btn-history').addEventListener('click', () => {
      const id    = this._getUnitId();
      const start = document.getElementById('hist-start').value;
      const end   = document.getElementById('hist-end').value;
      if (!id || isNaN(id))   { alert('Please select a vehicle.'); return; }
      if (!start || !end)     { alert('Please set start and end date/time.'); return; }
      this.travel.loadTravelHistory(id, start, end);
    });
  }

  _setupLocationMaster() {
    document.getElementById('btn-save-loc').addEventListener('click', () => {
      this.locMod.save();
    });
  }
}

// ════════════════════════════════════════════════════════════
//  BOOT
// ════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
  const app = new App();
  await app.init();
});
