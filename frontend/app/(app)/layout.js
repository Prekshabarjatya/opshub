'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { NotificationProvider } from '@/lib/notifications';
import Shell from '@/components/Shell';

export default function AppLayout({ children }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  if (loading || !user) return <div className="auth-wrap muted">Loading…</div>;

  return (
    <NotificationProvider>
      <Shell>{children}</Shell>
    </NotificationProvider>
  );
}
