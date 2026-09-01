'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';

interface Produto {
  id: string;
  sku: string;
  nome: string;
  descricao: string | null;
  categoria: string | null;
  preco_custo: number | null;
  preco_venda: number | null;
  estoque_atual: number;
  imagem_url: string | null;
  is_active: boolean;
}

const formatCurrency = (value: number | null) =>
  value === null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const initialFormData = {
  sku: '',
  nome: '',
  descricao: '',
  categoria: '',
  preco_custo: '',
  preco_venda: '',
  estoque_atual: '0',
};

export default function ProdutosPage() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState(initialFormData);
  const [imagemFile, setImagemFile] = useState<File | null>(null);

  const fetchProdutos = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase.from('produtos').select('*').order('nome', { ascending: true });
      if (error) throw error;
      setProdutos(data || []);
    } catch (error) {
      console.error('Erro ao buscar produtos:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProdutos();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      let imagem_url: string | null = null;

      if (imagemFile) {
        const caminho = `${crypto.randomUUID()}-${imagemFile.name}`;
        const { error: uploadError } = await supabase.storage.from('produtos').upload(caminho, imagemFile);
        if (uploadError) throw uploadError;
        const { data: publicUrlData } = supabase.storage.from('produtos').getPublicUrl(caminho);
        imagem_url = publicUrlData.publicUrl;
      }

      const { error } = await supabase.from('produtos').insert([{
        sku: formData.sku,
        nome: formData.nome,
        descricao: formData.descricao || null,
        categoria: formData.categoria || null,
        preco_custo: formData.preco_custo ? parseFloat(formData.preco_custo) : null,
        preco_venda: formData.preco_venda ? parseFloat(formData.preco_venda) : null,
        estoque_atual: parseFloat(formData.estoque_atual) || 0,
        imagem_url,
      }]);

      if (error) throw error;

      await fetchProdutos();
      setIsModalOpen(false);
      setFormData(initialFormData);
      setImagemFile(null);
    } catch (error) {
      console.error('Erro ao salvar produto:', error);
      alert('Erro ao salvar no banco. Verifique o console.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAlternarAtivo = async (id: string, ativoAtual: boolean) => {
    try {
      const { error } = await supabase.from('produtos').update({ is_active: !ativoAtual }).eq('id', id);
      if (error) throw error;
      await fetchProdutos();
    } catch (error) {
      console.error('Erro ao atualizar produto:', error);
      alert('Erro ao atualizar. Verifique o console.');
    }
  };

  return (
    <div className="space-y-6 relative">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Produtos</h1>
          <p className="text-stone-500 text-sm mt-1">Cadastre e gerencie os produtos da sua franquia.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            disabled
            title="Em breve"
            className="bg-stone-100 text-stone-400 px-4 py-2 rounded-lg text-sm font-medium cursor-not-allowed"
          >
            Importar XML
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-stone-900 hover:bg-stone-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <span>+</span> Novo Produto
          </button>
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden min-h-[300px]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-stone-600">
            <thead className="bg-stone-50 border-b border-stone-200 text-stone-500 uppercase text-xs font-medium">
              <tr>
                <th className="px-6 py-4"></th>
                <th className="px-6 py-4">SKU</th>
                <th className="px-6 py-4">Nome</th>
                <th className="px-6 py-4">Custo</th>
                <th className="px-6 py-4">Venda</th>
                <th className="px-6 py-4">Estoque</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {isLoading ? (
                <tr><td colSpan={8} className="px-6 py-8 text-center text-stone-400">Carregando...</td></tr>
              ) : produtos.length === 0 ? (
                <tr><td colSpan={8} className="px-6 py-8 text-center text-stone-400">Nenhum produto cadastrado ainda.</td></tr>
              ) : (
                produtos.map((p) => (
                  <tr key={p.id} className="hover:bg-stone-50/50 transition-colors">
                    <td className="px-6 py-4">
                      {p.imagem_url ? (
                        <img src={p.imagem_url} alt={p.nome} className="w-10 h-10 rounded-lg object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-stone-100 flex items-center justify-center text-stone-300 text-xs">—</div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-stone-500">{p.sku}</td>
                    <td className="px-6 py-4 font-medium text-stone-800">{p.nome}</td>
                    <td className="px-6 py-4">{formatCurrency(p.preco_custo)}</td>
                    <td className="px-6 py-4">{formatCurrency(p.preco_venda)}</td>
                    <td className="px-6 py-4">{p.estoque_atual}</td>
                    <td className="px-6 py-4">
                      {p.is_active ? (
                        <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-md">Ativo</span>
                      ) : (
                        <span className="px-2.5 py-1 bg-stone-100 text-stone-500 text-xs font-medium rounded-md">Inativo</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => handleAlternarAtivo(p.id, p.is_active)}
                        className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                          p.is_active ? 'text-red-600 hover:bg-red-50' : 'text-emerald-600 hover:bg-emerald-50'
                        }`}
                      >
                        {p.is_active ? 'Desativar' : 'Reativar'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b border-stone-100">
              <h2 className="text-lg font-semibold text-stone-800">Novo Produto</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-stone-400 hover:text-stone-600">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">SKU</label>
                  <input
                    type="text" required
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                    value={formData.sku}
                    onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                    placeholder="Ex: PERF-001"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Categoria</label>
                  <input
                    type="text"
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                    value={formData.categoria}
                    onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
                    placeholder="Ex: Perfumaria"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Nome</label>
                <input
                  type="text" required
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                  value={formData.nome}
                  onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                  placeholder="Ex: Perfume Floral 100ml"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Descrição</label>
                <textarea
                  className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                  rows={2}
                  value={formData.descricao}
                  onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Custo (R$)</label>
                  <input
                    type="number" step="0.01"
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                    value={formData.preco_custo}
                    onChange={(e) => setFormData({ ...formData, preco_custo: e.target.value })}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Venda (R$)</label>
                  <input
                    type="number" step="0.01"
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                    value={formData.preco_venda}
                    onChange={(e) => setFormData({ ...formData, preco_venda: e.target.value })}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Estoque</label>
                  <input
                    type="number" step="1"
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                    value={formData.estoque_atual}
                    onChange={(e) => setFormData({ ...formData, estoque_atual: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Foto</label>
                <input
                  type="file"
                  accept="image/*"
                  className="w-full text-sm text-stone-600"
                  onChange={(e) => setImagemFile(e.target.files?.[0] || null)}
                />
              </div>
              <div className="pt-2 flex gap-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg font-medium transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-1 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium transition-colors disabled:opacity-70">
                  {isSubmitting ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
