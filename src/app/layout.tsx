import './globals.css';
import type { Metadata } from 'next';
import RegistrarServiceWorker from '../components/RegistrarServiceWorker';

export const metadata: Metadata = {
  title: 'Maria Dondoka - Sistema de Gestão',
  description: 'Gestão inteligente e multi-franquias',
  // iPhone não lê o manifest: estas metas fazem o atalho abrir em tela cheia.
  appleWebApp: { capable: true, title: 'Maria Dondoka', statusBarStyle: 'black-translucent' },
  // Next 13.5: themeColor ainda vai em metadata (o export `viewport` só existe a partir do 14).
  themeColor: '#000000',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>
        <RegistrarServiceWorker />
        {children}
      </body>
    </html>
  );
}