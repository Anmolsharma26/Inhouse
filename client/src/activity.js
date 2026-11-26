// In-app activity tracker. Every 30 s it reports whether this RadiantMap tab is:
//   active – the user moved the mouse / typed / scrolled in the last IDLE_MS
//   idle   – the tab is in front but there has been no input for IDLE_MS
//   away   – the tab is in the background or minimised (user is in another tab/app)
// It cannot see anything outside this tab, and it never records what is typed.
import api from './api/client';

const HEARTBEAT_MS = 30 * 1000;
const IDLE_MS = 5 * 60 * 1000;
const INPUT_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel'];

let timer = null;
let lastInput = Date.now();
let idle = false;
let currentPath = '/';

const stateNow = () => (document.visibilityState === 'hidden' ? 'away' : Date.now() - lastInput > IDLE_MS ? 'idle' : 'active');
const send = (body) => api.post('/activity/heartbeat', body).catch(() => {}); // tracking must never disturb the user
const event = (type, extra = {}) => api.post('/activity/event', { type, path: currentPath, ...extra }).catch(() => {});

function beat() {
  const state = stateNow();
  if (state === 'idle' && !idle) { idle = true; event('idle_start'); }
  send({ state, path: currentPath });
}

function onInput() {
  lastInput = Date.now();
  if (idle) { idle = false; event('idle_end'); send({ state: 'active', path: currentPath }); }
}

function onVisibility() { if (document.visibilityState === 'visible') lastInput = Date.now(); beat(); }

export function startActivityTracking() {
  if (timer) return;
  lastInput = Date.now(); idle = false;
  INPUT_EVENTS.forEach((e) => window.addEventListener(e, onInput, { passive: true }));
  document.addEventListener('visibilitychange', onVisibility);
  beat();
  timer = setInterval(beat, HEARTBEAT_MS);
}

export function stopActivityTracking() {
  clearInterval(timer); timer = null;
  INPUT_EVENTS.forEach((e) => window.removeEventListener(e, onInput));
  document.removeEventListener('visibilitychange', onVisibility);
}

export function trackPage(path) {
  if (path === currentPath) return;
  currentPath = path;
  if (timer) event('page_view');
}

/** Record the logout before the token is removed. */
export const trackLogout = () => event('logout');
