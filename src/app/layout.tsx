import 'globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Maria Dondoka - Sistema de Gestão',
  description: 'Gestão inteligente e multi-franquias',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}