'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, clearToken } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth';
import { ACCENT } from '@/lib/theme';

export default function ChangePasswordPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
    if (!loading && user && !user.mustChangePassword) router.replace(homeFor(user));
  }, [loading, user, router]);

  async function submit() {
    setError('');
    if (newPassword !== confirm) return setError('New passwords do not match');
    setSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      clearToken();
      logout();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password');
      setSaving(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', background: '#f4f6f5', display: 'grid', placeItems: 'center', padding: 20, color: '#13201b' }}>
      <section style={{ width: '100%', maxWidth: 440, background: '#fff', border: '1px solid #dce4e0', borderRadius: 8, padding: 28 }}>
        <h1 style={{ margin: 0, font: "700 24px 'Inter'" }}>Set a new password</h1>
        <p style={{ color: '#5b6a64', font: "400 15px/1.5 'Inter'", margin: '8px 0 22px' }}>Your temporary password must be replaced before you can use the system.</p>
        <PasswordField label="Temporary password" value={currentPassword} onChange={setCurrentPassword} />
        <PasswordField label="New password" value={newPassword} onChange={setNewPassword} />
        <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} />
        <div style={{ color: '#5b6a64', font: "400 13.5px/1.5 'Inter'", marginTop: 4 }}>Use at least 12 characters with uppercase, lowercase, a number, and a symbol.</div>
        {error && <div style={{ marginTop: 12, color: '#b42318', font: "600 14px 'Inter'" }}>{error}</div>}
        <button onClick={submit} disabled={saving || !currentPassword || !newPassword || !confirm} style={{ width: '100%', marginTop: 20, border: 0, borderRadius: 7, padding: 12, background: ACCENT, color: '#092016', font: "700 15px 'Inter'", cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Updating...' : 'Update password'}</button>
      </section>
    </main>
  );
}

function PasswordField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label style={{ display: 'block', marginBottom: 14, font: "600 14px 'Inter'" }}>{label}<input type="password" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" style={{ display: 'block', width: '100%', marginTop: 7, padding: '11px 12px', border: '1px solid #bdc9c3', borderRadius: 7, font: "400 16px 'Inter'", color: '#13201b', background: '#fff' }} /></label>;
}
