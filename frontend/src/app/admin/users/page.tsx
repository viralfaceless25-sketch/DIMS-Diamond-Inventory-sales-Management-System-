'use client';

import { useEffect, useState } from 'react';
import { AdminUser, api, Role } from '@/lib/api';
import { ACCENT } from '@/lib/theme';

const emptyForm = { email: '', password: '', role: 'sales_rep' as Role, repName: '', branch: 'NY' };

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    try { setUsers(await api.adminUsers()); } catch (err) { setError(err instanceof Error ? err.message : 'Could not load users'); }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    setError(''); setMessage(''); setSaving(true);
    try {
      await api.createUser(form);
      setForm(emptyForm);
      setMessage('Account created. The user must change the temporary password at first login.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create user'); }
    finally { setSaving(false); }
  }

  async function toggle(user: AdminUser) {
    setError('');
    try { await api.setUserActive(user.id, !user.isActive); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not update user'); }
  }

  async function reset(user: AdminUser) {
    const password = window.prompt(`Temporary password for ${user.email}`);
    if (!password) return;
    setError('');
    try {
      await api.resetUserPassword(user.id, password);
      setMessage('Password reset. Existing sessions were signed out.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not reset password'); }
  }

  return (
    <main style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', marginBottom: 18 }}>
        <div><h1 style={{ margin: 0, fontSize: 24 }}>User management</h1><div style={{ color: '#64736d', fontSize: 13, marginTop: 5 }}>Create, disable, and reset staff accounts.</div></div>
        <div style={{ fontWeight: 700 }}>{users.filter((u) => u.isActive).length} active</div>
      </div>
      <section style={panel}>
        <h2 style={heading}>Create account</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 2fr) minmax(170px, 1fr) minmax(200px, 2fr)', gap: 12 }}>
          <Field label="Email"><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={input} /></Field>
          <Field label="Role"><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} style={input}><option value="sales_rep">Sales rep</option><option value="inventory">Inventory</option><option value="admin">Admin</option></select></Field>
          <Field label="Temporary password"><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={input} /></Field>
        </div>
        {form.role !== 'admin' && <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginTop: 12 }}>
          <Field label="Staff name"><input value={form.repName} onChange={(e) => setForm({ ...form, repName: e.target.value })} style={input} /></Field>
          <Field label="Branch"><select value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} style={input}><option>NY</option><option>LA</option><option>CH</option></select></Field>
        </div>}
        <div style={{ color: '#64736d', fontSize: 11, marginTop: 10 }}>Password: 12+ characters with uppercase, lowercase, a number, and a symbol.</div>
        <button onClick={create} disabled={saving} style={{ marginTop: 16, background: ACCENT, border: 0, borderRadius: 6, padding: '10px 16px', fontWeight: 800, cursor: 'pointer' }}>{saving ? 'Creating...' : 'Create account'}</button>
      </section>
      {(error || message) && <div style={{ margin: '14px 0', padding: 11, borderRadius: 6, background: error ? '#fef0ed' : '#e9f8ef', color: error ? '#b42318' : '#166534', fontWeight: 600, fontSize: 13 }}>{error || message}</div>}
      <section style={{ ...panel, marginTop: 16, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}><thead><tr>{['Account', 'Role', 'Rep / branch', 'Security', 'Status', 'Actions'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead><tbody>
          {users.map((u) => <tr key={u.id} style={{ borderTop: '1px solid #e2e9e5' }}><td style={td}><strong>{u.email}</strong></td><td style={td}>{u.role.replace('_', ' ')}</td><td style={td}>{u.repName ? `${u.repName} / ${u.branch}` : '-'}</td><td style={td}>{u.mustChangePassword ? 'Password change required' : u.lockedUntil ? 'Temporarily locked' : 'Ready'}</td><td style={td}><span style={{ color: u.isActive ? '#16803b' : '#b42318', fontWeight: 800 }}>{u.isActive ? 'Active' : 'Disabled'}</span></td><td style={td}><button onClick={() => reset(u)} style={smallButton}>Reset password</button><button onClick={() => toggle(u)} style={{ ...smallButton, marginLeft: 7, color: u.isActive ? '#b42318' : '#16803b' }}>{u.isActive ? 'Disable' : 'Activate'}</button></td></tr>)}
        </tbody></table>
      </section>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label style={{ fontSize: 12, fontWeight: 700, color: '#4c5d55' }}>{label}{children}</label>; }
const panel: React.CSSProperties = { background: '#fff', border: '1px solid #dce4e0', borderRadius: 8, padding: 18 };
const heading: React.CSSProperties = { margin: '0 0 14px', fontSize: 16 };
const input: React.CSSProperties = { display: 'block', width: '100%', marginTop: 6, padding: '10px 11px', border: '1px solid #bdc9c3', borderRadius: 6, background: '#fff', color: '#13201b' };
const th: React.CSSProperties = { padding: '12px 14px', textAlign: 'left', color: '#64736d', background: '#f8faf9', fontSize: 11, textTransform: 'uppercase' };
const td: React.CSSProperties = { padding: '13px 14px' };
const smallButton: React.CSSProperties = { border: '1px solid #bdc9c3', borderRadius: 5, background: '#fff', padding: '6px 9px', cursor: 'pointer', fontWeight: 700, fontSize: 11 };
