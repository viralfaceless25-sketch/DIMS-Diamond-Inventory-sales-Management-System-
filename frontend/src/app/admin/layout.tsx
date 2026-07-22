'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth, useRequireRole } from '@/lib/auth';
import { ACCENT } from '@/lib/theme';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useRequireRole('admin');
  const { logout } = useAuth();
  const pathname = usePathname();
  if (loading || !user) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>Loading...</div>;
  return (
    <div style={{ minHeight: '100vh', background: '#f3f6f4', color: '#13201b', fontFamily: 'Inter, sans-serif' }}>
      <header style={{ height: 64, background: '#fff', borderBottom: '1px solid #dce4e0', display: 'flex', alignItems: 'center', padding: '0 24px', gap: 24 }}>
        <Link href="/admin/users" style={{ color: '#13201b', textDecoration: 'none', fontWeight: 800 }}>Diamond ERP <span style={{ color: ACCENT }}>Admin</span></Link>
        <nav><Link href="/admin/users" style={{ padding: '8px 12px', borderRadius: 6, textDecoration: 'none', color: pathname === '/admin/users' ? '#092016' : '#64736d', background: pathname === '/admin/users' ? 'oklch(75% 0.14 150 / .22)' : 'transparent', fontWeight: 700, fontSize: 13 }}>Users</Link></nav>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64736d' }}>{user.email}</div>
        <button onClick={logout} style={{ border: '1px solid #bdc9c3', background: '#fff', borderRadius: 6, padding: '8px 12px', cursor: 'pointer' }}>Sign out</button>
      </header>
      {children}
    </div>
  );
}
