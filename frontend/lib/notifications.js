'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL, api, getToken } from './api';
import { useAuth } from './auth';
import {
  disablePush,
  enablePush,
  getPushState,
  isStandalone,
  registerServiceWorker,
  sendTestPush,
  syncPush,
} from './push';

const NotificationContext = createContext(null);

const INITIAL_PUSH = { supported: false, configured: false, permission: 'default', subscribed: false };

export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  // Device alerts (Web Push) + PWA install
  const [push, setPush] = useState(INITIAL_PUSH);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState(null); // { type: 'ok' | 'error', text }
  const [installEvent, setInstallEvent] = useState(null);
  const [standalone, setStandalone] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const d = await api('/api/notifications');
      setItems(d.items);
      setUnread(d.unread);
    } catch {
      /* ignore transient errors */
    }
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const refreshPush = useCallback(async () => {
    try {
      setPush(await getPushState());
    } catch {
      /* ignore */
    }
  }, []);

  // PWA install prompt + standalone detection
  useEffect(() => {
    setStandalone(isStandalone());
    const onPrompt = (e) => {
      e.preventDefault();
      setInstallEvent(e);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      setStandalone(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Service worker + device subscription housekeeping
  useEffect(() => {
    if (!user) return;
    (async () => {
      await registerServiceWorker();
      await syncPush();
      await refreshPush();
    })();
  }, [user?.id, refreshPush]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time channel while the app is open
  useEffect(() => {
    if (!user) return undefined;
    refresh();

    const s = io(API_URL, { auth: { token: getToken() }, transports: ['websocket', 'polling'] });
    s.on('connect', () => {
      setConnected(true);
      refresh(); // catch anything missed while offline
    });
    s.on('disconnect', () => setConnected(false));
    s.on('notification', (n) => {
      setItems((prev) => [n, ...prev.filter((p) => p.id !== n.id)].slice(0, 50));
      setUnread((u) => u + 1);
      setToasts((t) => [...t, n].slice(-4));
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== n.id)), 7000);
    });
    setSocket(s);
    return () => {
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [user?.id, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const markRead = useCallback(async (id) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
    try {
      await api(`/api/notifications/${id}/read`, { method: 'POST' });
    } catch {
      /* ignore */
    }
  }, []);

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnread(0);
    try {
      await api('/api/notifications/read-all', { method: 'POST' });
    } catch {
      /* ignore */
    }
  }, []);

  const enableAlerts = useCallback(async () => {
    setPushBusy(true);
    setPushMessage(null);
    try {
      const result = await enablePush();
      if (result === 'granted') setPushMessage({ type: 'ok', text: 'Alerts are on for this device.' });
      else setPushMessage({ type: 'error', text: 'Notifications were not allowed. You can change this in your browser or phone settings.' });
    } catch (err) {
      setPushMessage({ type: 'error', text: err.message || 'Could not turn on alerts.' });
    } finally {
      await refreshPush();
      setPushBusy(false);
    }
  }, [refreshPush]);

  const disableAlerts = useCallback(async () => {
    setPushBusy(true);
    setPushMessage(null);
    try {
      await disablePush();
      setPushMessage({ type: 'ok', text: 'Alerts are off for this device.' });
    } catch (err) {
      setPushMessage({ type: 'error', text: err.message });
    } finally {
      await refreshPush();
      setPushBusy(false);
    }
  }, [refreshPush]);

  const testAlert = useCallback(async () => {
    setPushBusy(true);
    setPushMessage(null);
    try {
      const r = await sendTestPush();
      setPushMessage(
        r.sent > 0
          ? { type: 'ok', text: 'Test sent. Background the app to see it as a system notification.' }
          : { type: 'error', text: 'No device is registered. Turn alerts off and on again.' }
      );
    } catch (err) {
      setPushMessage({ type: 'error', text: err.message });
    } finally {
      setPushBusy(false);
    }
  }, []);

  const installApp = useCallback(async () => {
    if (!installEvent) return;
    installEvent.prompt();
    try {
      await installEvent.userChoice;
    } finally {
      setInstallEvent(null);
    }
  }, [installEvent]);

  const value = useMemo(
    () => ({
      items,
      unread,
      toasts,
      socket,
      connected,
      markRead,
      markAllRead,
      dismissToast,
      refresh,
      push,
      pushBusy,
      pushMessage,
      enableAlerts,
      disableAlerts,
      testAlert,
      canInstall: !!installEvent,
      installApp,
      standalone,
    }),
    [items, unread, toasts, socket, connected, markRead, markAllRead, dismissToast, refresh, push, pushBusy, pushMessage, enableAlerts, disableAlerts, testAlert, installEvent, installApp, standalone]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationProvider');
  return ctx;
}
