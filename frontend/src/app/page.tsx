'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { homeFor, useAuth } from '@/lib/auth';

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    else router.replace(homeFor(user));
  }, [user, loading, router]);

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'oklch(60% 0.01 150)', font: "500 14px 'Inter', sans-serif" }}>
      Loading…
    </div>
  );
}
