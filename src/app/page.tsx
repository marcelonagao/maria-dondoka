import { redirect } from 'next/navigation';

export default function Home() {
  // Redireciona automaticamente a raiz do site para a tela de login
  redirect('/login');
}