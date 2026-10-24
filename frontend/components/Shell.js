'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useNotifications } from '@/lib/notifications';
import { ROLE_LABEL, timeAgo } from '@/lib/format';
import { isIOS } from '@/lib/push';

const NAV = [
  { href: '/today', label: 'Today', icon: '🏠', roles: ['super_admin', 'dept_head'] },
  { href: '/worklog', label: 'Worklog', icon: '✅', roles: ['super_admin', 'dept_head', 'employee'] },
  { href: '/messages', label: 'Messages', icon: '💬', roles: ['super_admin', 'dept_head', 'employee'] },
  { href: '/analytics', label: 'Control Room', icon: '📊', roles: ['super_admin', 'dept_head'] },
  { href: '/team', label: 'My Team', icon: '👥', roles: ['dept_head'] },
  { href: '/admin', label: 'Admin', icon: '⚙️', roles: ['super_admin'] },
];

// Quick "+ Add" menu: Super Admin adds departments / people, Dept Head adds team members.
function AddMenu() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const options =
    user.role === 'super_admin'
      ? [
          { label: 'Department', path: '/admin', id: 'add-department' },
          { label: 'Person', path: '/admin', id: 'add-user' },
        ]
      : user.role === 'dept_head'
        ? [{ label: 'Team member', path: '/team', id: 'add-member' }]
        : [];
  if (!options.length) return null;

  const go = (o) => {
    setOpen(false);
    if (pathname === o.path) {
      const el = document.getElementById(o.id);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const input = el.querySelector('input');
        if (input) input.focus({ preventScroll: true });
      }
    } else {
      router.push(`${o.path}#${o.id}`);
    }
  };

  if (options.length === 1) {
    return (
      <button className="btn btn-sm btn-primary" onClick={() => go(options[0])}>
        + Add {options[0].label.toLowerCase()}
      </button>
    );
  }
  return (
    <div className="bell" ref={ref}>
      <button className="btn btn-sm btn-primary" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        + Add
      </button>
      {open && (
        <div className="bell-panel" style={{ width: 200 }} role="menu">
          {options.map((o) => (
            <button key={o.id} className="notif" role="menuitem" onClick={() => go(o)}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Phone / desktop alerts (Web Push) for this device.
function DeviceAlerts() {
  const { push, pushBusy, pushMessage, enableAlerts, disableAlerts, testAlert, standalone } = useNotifications();
  const ios = isIOS();

  let body;
  if (!push.supported) {
    body =
      ios && !standalone ? (
        <>
          <strong>Get alerts on your iPhone</strong>
          <div className="small">
            Tap <b>Share</b> → <b>Add to Home Screen</b>, then open OpsHub from your home screen and turn alerts on here.
          </div>
        </>
      ) : (
        <div className="small">This browser does not support push alerts. Try Chrome, Edge, Firefox or Safari.</div>
      );
  } else if (!push.configured) {
    body = <div className="small">Phone alerts are not set up on the server yet. Ask your admin to add the VAPID keys.</div>;
  } else if (push.permission === 'denied') {
    body = (
      <div className="small">
        Alerts are blocked for this site. Allow notifications in your browser or phone settings, then reload.
      </div>
    );
  } else if (push.subscribed && push.permission === 'granted') {
    body = (
      <>
        <strong>✓ Alerts are on for this device</strong>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn btn-sm" onClick={testAlert} disabled={pushBusy}>Send test</button>
          <button className="btn btn-sm" onClick={disableAlerts} disabled={pushBusy}>Turn off</button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <strong>Get alerts on this device</strong>
        <div className="small" style={{ margin: '2px 0 8px' }}>
          Be notified about new messages and tags even when OpsHub is closed.
        </div>
        <button className="btn btn-primary btn-sm" onClick={enableAlerts} disabled={pushBusy}>
          {pushBusy ? 'Turning on…' : 'Turn on alerts'}
        </button>
      </>
    );
  }

  return (
    <div className="device-alerts">
      {body}
      {pushMessage && (
        <div className={`alert ${pushMessage.type === 'ok' ? 'alert-ok' : 'alert-error'} small`} style={{ marginTop: 8 }}>
          {pushMessage.text}
        </div>
      )}
    </div>
  );
}

function Bell() {
  const { items, unread, markRead, markAllRead, connected } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="bell" ref={ref}>
      <button
        className="bell-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        aria-expanded={open}
      >
        🔔
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-panel-head">
            <div className="row" style={{ gap: 8 }}>
              <strong>Notifications</strong>
              <span
                className={`conn-dot ${connected ? 'live' : ''}`}
                title={connected ? 'Live' : 'Reconnecting…'}
              />
            </div>
            <button className="btn btn-sm" onClick={markAllRead} disabled={!unread}>
              Mark all read
            </button>
          </div>
          <DeviceAlerts />
          {items.length === 0 ? (
            <div className="empty">You are all caught up.</div>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                className={`notif ${n.is_read ? '' : 'unread'}`}
                onClick={() => {
                  markRead(n.id);
                  setOpen(false);
                  router.push('/messages');
                }}
              >
                <div className="notif-line">
                  <strong style={{ color: 'inherit' }}>{n.sender_name || 'Someone'}</strong> → {n.target_label} ·{' '}
                  {timeAgo(n.created_at)}
                </div>
                <div className="notif-body">{n.body}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Toasts() {
  const { toasts, dismissToast } = useNotifications();
  const router = useRouter();
  if (!toasts.length) return null;
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast"
          role="status"
          onClick={() => {
            dismissToast(t.id);
            router.push('/messages');
          }}
        >
          <strong>
            {t.sender_name} → {t.target_label}
          </strong>
          <div>{t.body}</div>
        </div>
      ))}
    </div>
  );
}

export default function Shell({ children }) {
  const { user, logout } = useAuth();
  const { canInstall, installApp } = useNotifications();
  const pathname = usePathname();
  const items = NAV.filter((n) => n.roles.includes(user.role));
  const current = items.find((n) => pathname.startsWith(n.href));

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <span className="brand-mark">O</span> OpsHub
        </div>
        <nav className="nav" aria-label="Main">
          {items.map((n) => (
            <Link key={n.href} href={n.href} className={pathname.startsWith(n.href) ? 'active' : ''}>
              <span className="nav-icon">{n.icon}</span>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="side-user">
          <strong>{user.name}</strong>
          <span>
            {ROLE_LABEL[user.role]}
            {user.department_name ? ` · ${user.department_name}` : ''}
          </span>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-title">{current ? current.label : 'OpsHub'}</div>
          <div className="topbar-right">
            <span className="muted small topbar-name">{user.name}</span>
            <AddMenu />
            {canInstall && (
              <button className="btn btn-sm btn-primary" onClick={installApp}>
                Install app
              </button>
            )}
            <Bell />
            <button className="btn btn-sm" onClick={logout}>
              Sign out
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
      <Toasts />
    </div>
  );
}
