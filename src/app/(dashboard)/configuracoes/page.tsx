'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';

interface Dispositivo {
  id: string;
  device_label: string;
  is_active: boolean;
  last_sync_at: string | null;
  created_at: string;
}

interface Funcionario {
  id: string;
  nome: string;
  ativo: boolean;
}

interface CategoriaContas {
  id: string;
  franchise_id: string | null;
  nome: string;
  tipo: 'receita' | 'custo' | 'despesa';
  categoria_pai_id: string | null;
  is_active: boolean;
}

interface CredenciaisReveladas {
  token: string;
  secret: string;
}

export default function ConfiguracoesPage() {
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [naoAutorizado, setNaoAutorizado] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [novoLabel, setNovoLabel] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [credenciais, setCredenciais] = useState<CredenciaisReveladas | null>(null);
  const [confirmouCopia, setConfirmouCopia] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [syncUrl, setSyncUrl] = useState('');
  const [isSavingSyncUrl, setIsSavingSyncUrl] = useState(false);
  const [syncUrlSalva, setSyncUrlSalva] = useState(false);

  // Não dá pra confiar em .maybeSingle() sem filtro aqui: quem é sócio enxerga
  // TODAS as franquias (política aditiva de sócio), não só a própria — por isso
  // buscamos o franchise_id em profiles antes de tocar em franchises.
  const obterProprioFranchiseId = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase.from('profiles').select('franchise_id').eq('id', user.id).maybeSingle();
    return data?.franchise_id || null;
  };

  const carregarSyncUrl = async () => {
    const franchiseId = await obterProprioFranchiseId();
    if (!franchiseId) return;
    const { data, error } = await supabase.from('franchises').select('sync_url').eq('id', franchiseId).maybeSingle();
    if (error) { console.error('Erro ao carregar URL de sincronização:', error); return; }
    setSyncUrl(data?.sync_url || '');
  };

  const handleSalvarSyncUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSyncUrl(true);
    setSyncUrlSalva(false);
    try {
      const franchiseId = await obterProprioFranchiseId();
      if (!franchiseId) throw new Error('Franquia não encontrada');
      const { error } = await supabase.from('franchises').update({ sync_url: syncUrl || null }).eq('id', franchiseId);
      if (error) throw error;
      setSyncUrlSalva(true);
    } catch (err) {
      console.error('Erro ao salvar URL de sincronização:', err);
      alert('Erro ao salvar no banco. Verifique o console.');
    } finally {
      setIsSavingSyncUrl(false);
    }
  };

const carregarDispositivos = async () => {
  try {
    setIsLoading(true);
    setErro(null);
    const res = await fetch('/api/admin/pdv-devices');
    if (res.status === 401) {
      setNaoAutorizado(true);
      return;
    }
    if (!res.ok) {
      throw new Error(`Resposta inesperada do servidor (status ${res.status})`);
    }
    const data = await res.json();
    setDispositivos(data.devices || []);
  } catch (err) {
    console.error('Erro ao carregar dispositivos:', err);
    setErro('Não foi possível carregar os dispositivos. Tente novamente em instantes.');
  } finally {
    setIsLoading(false);
  }
};

  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [isLoadingFuncionarios, setIsLoadingFuncionarios] = useState(true);
  const [isModalFuncionarioOpen, setIsModalFuncionarioOpen] = useState(false);
  const [novoNomeFuncionario, setNovoNomeFuncionario] = useState('');
  const [isSubmittingFuncionario, setIsSubmittingFuncionario] = useState(false);

  const carregarFuncionarios = async () => {
    try {
      setIsLoadingFuncionarios(true);
      const { data, error } = await supabase.from('funcionarios').select('id, nome, ativo').order('nome', { ascending: true });
      if (error) throw error;
      setFuncionarios(data || []);
    } catch (err) {
      console.error('Erro ao carregar funcionários:', err);
    } finally {
      setIsLoadingFuncionarios(false);
    }
  };

  const [planoContas, setPlanoContas] = useState<CategoriaContas[]>([]);
  const [isLoadingPlanoContas, setIsLoadingPlanoContas] = useState(true);
  const [isModalCategoriaOpen, setIsModalCategoriaOpen] = useState(false);
  const [novaCategoria, setNovaCategoria] = useState({ nome: '', tipo: 'despesa' as CategoriaContas['tipo'], categoria_pai_id: '' });
  const [isSubmittingCategoria, setIsSubmittingCategoria] = useState(false);

  const carregarPlanoContas = async () => {
    try {
      setIsLoadingPlanoContas(true);
      const { data, error } = await supabase
        .from('plano_contas')
        .select('id, franchise_id, nome, tipo, categoria_pai_id, is_active')
        .order('ordem', { ascending: true });
      if (error) throw error;
      setPlanoContas(data || []);
    } catch (err) {
      console.error('Erro ao carregar plano de contas:', err);
    } finally {
      setIsLoadingPlanoContas(false);
    }
  };

  useEffect(() => {
    carregarDispositivos();
    carregarFuncionarios();
    carregarSyncUrl();
    carregarPlanoContas();
  }, []);

  const handleCriarFuncionario = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingFuncionario(true);
    try {
      const { error } = await supabase.from('funcionarios').insert([{ nome: novoNomeFuncionario }]);
      if (error) throw error;
      setNovoNomeFuncionario('');
      setIsModalFuncionarioOpen(false);
      await carregarFuncionarios();
    } catch (err) {
      console.error('Erro ao cadastrar funcionário:', err);
      alert('Erro ao salvar no banco. Verifique o console.');
    } finally {
      setIsSubmittingFuncionario(false);
    }
  };

  const handleAlternarAtivoFuncionario = async (id: string, ativoAtual: boolean) => {
    try {
      const { error } = await supabase.from('funcionarios').update({ ativo: !ativoAtual }).eq('id', id);
      if (error) throw error;
      await carregarFuncionarios();
    } catch (err) {
      console.error('Erro ao atualizar funcionário:', err);
      alert('Erro ao atualizar. Verifique o console.');
    }
  };

  const handleCriarCategoria = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingCategoria(true);
    try {
      const { error } = await supabase.from('plano_contas').insert([{
        nome: novaCategoria.nome,
        tipo: novaCategoria.tipo,
        categoria_pai_id: novaCategoria.categoria_pai_id || null,
      }]);
      if (error) throw error;
      setNovaCategoria({ nome: '', tipo: 'despesa', categoria_pai_id: '' });
      setIsModalCategoriaOpen(false);
      await carregarPlanoContas();
    } catch (err) {
      console.error('Erro ao cadastrar categoria:', err);
      alert('Erro ao salvar no banco. Verifique o console.');
    } finally {
      setIsSubmittingCategoria(false);
    }
  };

  const handleAlternarAtivoCategoria = async (id: string, ativoAtual: boolean) => {
    try {
      const { error } = await supabase.from('plano_contas').update({ is_active: !ativoAtual }).eq('id', id);
      if (error) throw error;
      await carregarPlanoContas();
    } catch (err) {
      console.error('Erro ao atualizar categoria:', err);
      alert('Erro ao atualizar. Verifique o console — categorias globais não podem ser editadas.');
    }
  };

  const handleCriar = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/admin/pdv-devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_label: novoLabel }),
      });
      if (!res.ok) throw new Error('Falha ao criar dispositivo');
      const data = await res.json();
      setCredenciais({ token: data.token, secret: data.secret });
      setNovoLabel('');
      setConfirmouCopia(false);
      await carregarDispositivos();
    } catch (err) {
      console.error(err);
      alert('Erro ao criar dispositivo. Verifique o console.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAlternarAtivo = async (id: string, ativoAtual: boolean) => {
    const acao = ativoAtual ? 'revogar' : 'reativar';
    if (!confirm(`Tem certeza que deseja ${acao} este dispositivo?`)) return;

    try {
      const res = await fetch('/api/admin/pdv-devices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active: !ativoAtual }),
      });
      if (!res.ok) throw new Error('Falha ao atualizar dispositivo');
      await carregarDispositivos();
    } catch (err) {
      console.error(err);
      alert('Erro ao atualizar. Verifique o console.');
    }
  };

  const fecharModal = () => {
    setIsModalOpen(false);
    setCredenciais(null);
  };

  if (naoAutorizado) {
    return (
      <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-8 text-center">
        <p className="text-stone-500">Esta área é restrita a administradores da franquia.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-stone-800">Configurações</h1>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-stone-800">Dispositivos PDV</h2>
          <p className="text-stone-500 text-sm mt-1">Gerencie os pontos de venda autorizados a sincronizar dados da sua franquia.</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-stone-900 hover:bg-stone-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <span>+</span> Novo Dispositivo
        </button>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden min-h-[200px]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-stone-600">
            <thead className="bg-stone-50 border-b border-stone-200 text-stone-500 uppercase text-xs font-medium">
              <tr>
                <th className="px-6 py-4">Dispositivo</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Última sincronização</th>
                <th className="px-6 py-4">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
            {erro ? (
              <tr><td colSpan={4} className="px-6 py-8 text-center text-red-500">{erro}</td></tr>
            ) : isLoading ? (
              <tr><td colSpan={4} className="px-6 py-8 text-center text-stone-400">Carregando...</td></tr>
            ) : dispositivos.length === 0 ? (
              <tr><td colSpan={4} className="px-6 py-8 text-center text-stone-400">Nenhum dispositivo cadastrado ainda.</td></tr>
            ) : (
              dispositivos.map((d) => (
                  <tr key={d.id} className="hover:bg-stone-50/50 transition-colors">
                    <td className="px-6 py-4 font-medium text-stone-800">{d.device_label}</td>
                    <td className="px-6 py-4">
                      {d.is_active ? (
                        <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-md">Ativo</span>
                      ) : (
                        <span className="px-2.5 py-1 bg-stone-100 text-stone-500 text-xs font-medium rounded-md">Revogado</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {d.last_sync_at ? new Date(d.last_sync_at).toLocaleString('pt-BR') : 'Nunca sincronizou'}
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => handleAlternarAtivo(d.id, d.is_active)}
                        className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                          d.is_active
                            ? 'text-red-600 hover:bg-red-50'
                            : 'text-emerald-600 hover:bg-emerald-50'
                        }`}
                      >
                        {d.is_active ? 'Revogar' : 'Reativar'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4">
        <div>
          <h2 className="text-xl font-semibold text-stone-800">Funcionários</h2>
          <p className="text-stone-500 text-sm mt-1">Cadastre quem trabalha na loja para rastrear quem fecha o caixa.</p>
        </div>
        <button
          onClick={() => setIsModalFuncionarioOpen(true)}
          className="bg-stone-900 hover:bg-stone-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <span>+</span> Novo Funcionário
        </button>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden min-h-[150px]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-stone-600">
            <thead className="bg-stone-50 border-b border-stone-200 text-stone-500 uppercase text-xs font-medium">
              <tr>
                <th className="px-6 py-4">Nome</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {isLoadingFuncionarios ? (
                <tr><td colSpan={3} className="px-6 py-8 text-center text-stone-400">Carregando...</td></tr>
              ) : funcionarios.length === 0 ? (
                <tr><td colSpan={3} className="px-6 py-8 text-center text-stone-400">Nenhum funcionário cadastrado ainda.</td></tr>
              ) : (
                funcionarios.map((f) => (
                  <tr key={f.id} className="hover:bg-stone-50/50 transition-colors">
                    <td className="px-6 py-4 font-medium text-stone-800">{f.nome}</td>
                    <td className="px-6 py-4">
                      {f.ativo ? (
                        <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-md">Ativo</span>
                      ) : (
                        <span className="px-2.5 py-1 bg-stone-100 text-stone-500 text-xs font-medium rounded-md">Inativo</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => handleAlternarAtivoFuncionario(f.id, f.ativo)}
                        className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                          f.ativo ? 'text-red-600 hover:bg-red-50' : 'text-emerald-600 hover:bg-emerald-50'
                        }`}
                      >
                        {f.ativo ? 'Desativar' : 'Reativar'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalFuncionarioOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b border-stone-100">
              <h2 className="text-lg font-semibold text-stone-800">Novo Funcionário</h2>
              <button onClick={() => setIsModalFuncionarioOpen(false)} className="text-stone-400 hover:text-stone-600">✕</button>
            </div>
            <form onSubmit={handleCriarFuncionario} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Nome</label>
                <input
                  type="text"
                  required
                  minLength={2}
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                  placeholder="Ex: Maria da Silva"
                  value={novoNomeFuncionario}
                  onChange={(e) => setNovoNomeFuncionario(e.target.value)}
                />
              </div>
              <div className="pt-2 flex gap-3">
                <button type="button" onClick={() => setIsModalFuncionarioOpen(false)} className="flex-1 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg font-medium transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={isSubmittingFuncionario} className="flex-1 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium transition-colors disabled:opacity-70">
                  {isSubmittingFuncionario ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4">
        <div>
          <h2 className="text-xl font-semibold text-stone-800">Plano de Contas</h2>
          <p className="text-stone-500 text-sm mt-1">Categorias usadas em Contas a Pagar. As globais valem para todas as franquias; adicione as suas próprias abaixo.</p>
        </div>
        <button
          onClick={() => setIsModalCategoriaOpen(true)}
          className="bg-stone-900 hover:bg-stone-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <span>+</span> Nova Categoria
        </button>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden min-h-[150px]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-stone-600">
            <thead className="bg-stone-50 border-b border-stone-200 text-stone-500 uppercase text-xs font-medium">
              <tr>
                <th className="px-6 py-4">Categoria</th>
                <th className="px-6 py-4">Tipo</th>
                <th className="px-6 py-4">Origem</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {isLoadingPlanoContas ? (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-stone-400">Carregando...</td></tr>
              ) : planoContas.filter((c) => !c.categoria_pai_id).length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-stone-400">Nenhuma categoria cadastrada ainda.</td></tr>
              ) : (
                planoContas.filter((c) => !c.categoria_pai_id).flatMap((pai) => {
                  const filhos = planoContas.filter((c) => c.categoria_pai_id === pai.id);
                  const linhaPai = (
                    <tr key={pai.id} className="hover:bg-stone-50/50 transition-colors bg-stone-50/30">
                      <td className="px-6 py-4 font-semibold text-stone-800">{pai.nome}</td>
                      <td className="px-6 py-4 capitalize">{pai.tipo}</td>
                      <td className="px-6 py-4">
                        {pai.franchise_id === null ? (
                          <span className="px-2.5 py-1 bg-stone-100 text-stone-500 text-xs font-medium rounded-md">Global</span>
                        ) : (
                          <span className="px-2.5 py-1 bg-amber-50 text-amber-700 text-xs font-medium rounded-md">Própria</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {pai.is_active ? (
                          <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-md">Ativa</span>
                        ) : (
                          <span className="px-2.5 py-1 bg-stone-100 text-stone-500 text-xs font-medium rounded-md">Inativa</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {pai.franchise_id !== null && (
                          <button
                            onClick={() => handleAlternarAtivoCategoria(pai.id, pai.is_active)}
                            className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                              pai.is_active ? 'text-red-600 hover:bg-red-50' : 'text-emerald-600 hover:bg-emerald-50'
                            }`}
                          >
                            {pai.is_active ? 'Desativar' : 'Reativar'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                  const linhasFilhos = filhos.map((f) => (
                    <tr key={f.id} className="hover:bg-stone-50/50 transition-colors">
                      <td className="px-6 py-4 pl-10 text-stone-600">{f.nome}</td>
                      <td className="px-6 py-4 capitalize text-stone-400">{f.tipo}</td>
                      <td className="px-6 py-4">
                        {f.franchise_id === null ? (
                          <span className="px-2.5 py-1 bg-stone-100 text-stone-500 text-xs font-medium rounded-md">Global</span>
                        ) : (
                          <span className="px-2.5 py-1 bg-amber-50 text-amber-700 text-xs font-medium rounded-md">Própria</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {f.is_active ? (
                          <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-md">Ativa</span>
                        ) : (
                          <span className="px-2.5 py-1 bg-stone-100 text-stone-500 text-xs font-medium rounded-md">Inativa</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {f.franchise_id !== null && (
                          <button
                            onClick={() => handleAlternarAtivoCategoria(f.id, f.is_active)}
                            className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                              f.is_active ? 'text-red-600 hover:bg-red-50' : 'text-emerald-600 hover:bg-emerald-50'
                            }`}
                          >
                            {f.is_active ? 'Desativar' : 'Reativar'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ));
                  return [linhaPai, ...linhasFilhos];
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalCategoriaOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b border-stone-100">
              <h2 className="text-lg font-semibold text-stone-800">Nova Categoria</h2>
              <button onClick={() => setIsModalCategoriaOpen(false)} className="text-stone-400 hover:text-stone-600">✕</button>
            </div>
            <form onSubmit={handleCriarCategoria} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Nome</label>
                <input
                  type="text"
                  required
                  minLength={2}
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                  placeholder="Ex: Frete"
                  value={novaCategoria.nome}
                  onChange={(e) => setNovaCategoria({ ...novaCategoria, nome: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Tipo</label>
                <select
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none bg-white text-stone-700"
                  value={novaCategoria.tipo}
                  onChange={(e) => setNovaCategoria({ ...novaCategoria, tipo: e.target.value as CategoriaContas['tipo'] })}
                >
                  <option value="receita">Receita</option>
                  <option value="custo">Custo</option>
                  <option value="despesa">Despesa</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Categoria-pai</label>
                <select
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none bg-white text-stone-700"
                  value={novaCategoria.categoria_pai_id}
                  onChange={(e) => setNovaCategoria({ ...novaCategoria, categoria_pai_id: e.target.value })}
                >
                  <option value="">Nenhuma (é uma categoria-pai)</option>
                  {planoContas.filter((c) => !c.categoria_pai_id && c.is_active).map((pai) => (
                    <option key={pai.id} value={pai.id}>{pai.nome}</option>
                  ))}
                </select>
              </div>
              <div className="pt-2 flex gap-3">
                <button type="button" onClick={() => setIsModalCategoriaOpen(false)} className="flex-1 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg font-medium transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={isSubmittingCategoria} className="flex-1 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium transition-colors disabled:opacity-70">
                  {isSubmittingCategoria ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="pt-4">
        <h2 className="text-xl font-semibold text-stone-800">Sincronização Automática</h2>
        <p className="text-stone-500 text-sm mt-1">
          URL pública onde o script de sincronização do PDV fica hospedado (ex: na Locaweb). Usada pelo botão &quot;Sincronizar agora&quot; em Vendas.
        </p>
      </div>
      <form onSubmit={handleSalvarSyncUrl} className="bg-white border border-stone-200 rounded-xl shadow-sm p-6 flex flex-col sm:flex-row gap-3">
        <input
          type="url"
          placeholder="https://sualoja.com.br/sync-pdv.php"
          value={syncUrl}
          onChange={(e) => { setSyncUrl(e.target.value); setSyncUrlSalva(false); }}
          className="flex-1 px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
        />
        <button
          type="submit"
          disabled={isSavingSyncUrl}
          className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium transition-colors disabled:opacity-70 whitespace-nowrap"
        >
          {isSavingSyncUrl ? 'Salvando...' : syncUrlSalva ? 'Salvo ✓' : 'Salvar'}
        </button>
      </form>

      {/* Modal de criação / revelação de credenciais */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            {!credenciais ? (
              <>
                <div className="flex justify-between items-center p-6 border-b border-stone-100">
                  <h2 className="text-lg font-semibold text-stone-800">Novo Dispositivo PDV</h2>
                  <button onClick={fecharModal} className="text-stone-400 hover:text-stone-600">✕</button>
                </div>
                <form onSubmit={handleCriar} className="p-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">Nome do dispositivo</label>
                    <input
                      type="text"
                      required
                      minLength={2}
                      className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                      placeholder="Ex: Caixa 1 - Matriz"
                      value={novoLabel}
                      onChange={(e) => setNovoLabel(e.target.value)}
                    />
                  </div>
                  <div className="pt-2 flex gap-3">
                    <button type="button" onClick={fecharModal} className="flex-1 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg font-medium transition-colors">
                      Cancelar
                    </button>
                    <button type="submit" disabled={isSubmitting} className="flex-1 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium transition-colors disabled:opacity-70">
                      {isSubmitting ? 'Gerando...' : 'Gerar Credenciais'}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <div className="p-6 border-b border-stone-100">
                  <h2 className="text-lg font-semibold text-stone-800">Credenciais geradas</h2>
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-3">
                    Copie e guarde estes valores agora. Por segurança, eles não serão exibidos novamente nesta tela.
                  </p>
                </div>
                <div className="p-6 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-stone-500 uppercase tracking-wider mb-1">Token</label>
                    <code className="block w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-xs break-all text-stone-800">
                      {credenciais.token}
                    </code>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-500 uppercase tracking-wider mb-1">Secret</label>
                    <code className="block w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-xs break-all text-stone-800">
                      {credenciais.secret}
                    </code>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-stone-600 pt-2">
                    <input
                      type="checkbox"
                      checked={confirmouCopia}
                      onChange={(e) => setConfirmouCopia(e.target.checked)}
                      className="rounded border-stone-300"
                    />
                    Já copiei o token e o secret para um local seguro
                  </label>
                </div>
                <div className="p-6 pt-0">
                  <button
                    onClick={fecharModal}
                    disabled={!confirmouCopia}
                    className="w-full px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Concluir
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}