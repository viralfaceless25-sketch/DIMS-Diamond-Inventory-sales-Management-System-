import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { ApiReadinessGate } from '@/components/ApiReadinessGate';
import { api } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Diamond ERP',
  description: 'Inventory & request management for Maitri Diamonds',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ApiReadinessGate apiUrl={api.apiUrl}>
          <AuthProvider>{children}</AuthProvider>
        </ApiReadinessGate>
      </body>
    </html>
  );
}
