import { api } from './api';

export const isBrowser = () => typeof window !== 'undefined';

export function pushSupported() {
  return isBrowser() && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function isStandalone() {
  if (!isBrowser()) return false;
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function isIOS() {
  if (!isBrowser()) return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
}

function base64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function registerServiceWorker() {
  if (!isBrowser() || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return { reg, sub: await reg.pushManager.getSubscription() };
}

/** Where this device stands: { supported, configured, permission, subscribed } */
export async function getPushState() {
  if (!pushSupported()) return { supported: false, configured: false, permission: 'unsupported', subscribed: false };
  let configured = false;
  try {
    const d = await api('/api/push/public-key');
    configured = !!d.public_key;
  } catch {
    /* offline or logged out */
  }
  const { sub } = await currentSubscription();
  return { supported: true, configured, permission: Notification.permission, subscribed: !!sub };
}

/** Ask permission, subscribe this device and register it with the server. */
export async function enablePush() {
  if (!pushSupported()) throw new Error('This browser does not support push notifications.');
  const { public_key: publicKey } = await api('/api/push/public-key');
  if (!publicKey) throw new Error('Push notifications are not set up on the server yet.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission;

  const { reg, sub: existing } = await currentSubscription();
  let sub = existing;
  const options = { userVisibleOnly: true, applicationServerKey: base64ToUint8Array(publicKey) };
  try {
    if (!sub) sub = await reg.pushManager.subscribe(options);
  } catch (err) {
    if (err && err.name === 'InvalidStateError' && existing) {
      await existing.unsubscribe(); // server key changed: start over
      sub = await reg.pushManager.subscribe(options);
    } else {
      throw err;
    }
  }
  await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
  return 'granted';
}

/** Turn alerts off for this device completely. */
export async function disablePush() {
  if (!pushSupported()) return;
  const { sub } = await currentSubscription();
  if (!sub) return;
  try {
    await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
  } catch {
    /* still unsubscribe locally */
  }
  await sub.unsubscribe();
}

/**
 * Re-attach an existing device subscription to the signed-in user (covers browser key rotation and
 * a phone that was used by someone else). Silent: never prompts.
 */
export async function syncPush() {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  try {
    const { sub } = await currentSubscription();
    if (sub) await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
  } catch {
    /* push not configured or offline */
  }
}

/** Called on logout: stop this user's alerts on this device but keep the browser permission. */
export async function detachPush() {
  if (!pushSupported()) return;
  try {
    const { sub } = await currentSubscription();
    if (sub) await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint }, auth: true });
  } catch {
    /* ignore */
  }
}

export async function sendTestPush() {
  return api('/api/push/test', { method: 'POST' });
}
