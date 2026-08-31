'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../../../../lib/supabase';
import type { Recebimento } from './types';

const initialFormData = {
  descricao: '',
  origem: 'Maquininha (Stone)',
  previsao: '',
  valorBruto: '',
  taxa: '0',
};

export function useRecebimentos() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recebimentos, setRecebimentos] = useState<Recebimento[]>([]);
  const [formData, setFormData] = useState(initialFormData);
  const [marcandoRecebidoId, setMarcandoRecebidoId] = useState<string | null>(null);

  const fetchRecebimentos = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('accounts_receivable')
        .select('*')
        .order('expected_date', { ascending: true });

      if (error) throw error;
      setRecebimentos(data || []);
    } catch (error) {
      console.error('Erro ao buscar contas a receber:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRecebimentos();
  }, []);

  const criarRecebimento = async () => {
    setIsSubmitting(true);

    try {
      // Regra de Negócio: Calcula desconto e líquido antes de salvar
      const bruto = parseFloat(formData.valorBruto);
      const taxaPercentual = parseFloat(formData.taxa);
      const valorDesconto = bruto * (taxaPercentual / 100);
      const liquido = bruto - valorDesconto;

      const { error } = await supabase.from('accounts_receivable').insert([{
        description: formData.descricao,
        origin: formData.origem,
        expected_date: formData.previsao,
        gross_amount: bruto,
        fee_amount: valorDesconto,
        net_amount: liquido,
        status: 'pendente',
      }]);

      if (error) throw error;

      // Recarrega a tabela após salvar
      await fetchRecebimentos();

      setFormData(initialFormData);
      return true;
    } catch (error) {
      console.error('Erro ao salvar recebimento:', error);
      alert('Erro ao salvar no banco. Verifique o console.');
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const marcarComoRecebido = async (id: string) => {
    setMarcandoRecebidoId(id);
    try {
      const { error } = await supabase
        .from('accounts_receivable')
        .update({ status: 'recebido', received_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      await fetchRecebimentos();
    } catch (error) {
      console.error('Erro ao marcar como recebido:', error);
      alert('Erro ao atualizar. Verifique o console.');
    } finally {
      setMarcandoRecebidoId(null);
    }
  };

  return {
    isLoading,
    isSubmitting,
    recebimentos,
    formData,
    setFormData,
    criarRecebimento,
    marcandoRecebidoId,
    marcarComoRecebido,
  };
}
