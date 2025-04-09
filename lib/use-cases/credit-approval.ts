import { CreditData } from '../entities/credit-data';
import { IDataReader } from '../interfaces/i-data-storage';
import { IMonitoring } from '../interfaces/i-monitoring';

export class CreditApprovalUseCase {
  constructor(
    private readonly dataReader: IDataReader,
    private readonly monitoring: IMonitoring
  ) {}
  
  async approveCreditLimit(customerId: string, requestedLimit: number): Promise<{
    approved: boolean;
    approvedLimit: number;
    reason?: string;
  }> {
    try {
      // Início da métrica de tempo de processamento
      const timer = this.monitoring.startTimer('credit_approval_process');
      
      // Buscar dados do cliente
      const customerData = await this.dataReader.readItem(customerId);
      
      if (!customerData) {
        this.monitoring.incrementCounter('credit_approval_customer_not_found');
        return {
          approved: false,
          approvedLimit: 0,
          reason: 'Cliente não encontrado'
        };
      }
      
      // Criar entidade de domínio
      const creditData = new CreditData(
        customerData.customerId,
        customerData.creditScore,
        customerData.monthlyIncome,
        customerData.existingDebts,
        new Date(customerData.createdAt)
      );
      
      // Lógica de aprovação de crédito
      const isCreditWorthy = creditData.isCreditWorthy(requestedLimit);
      
      // Calcular limite aprovado (lógica simplificada)
      let approvedLimit = 0;
      let reason = undefined;
      
      if (isCreditWorthy) {
        approvedLimit = Math.min(
          requestedLimit,
          creditData.monthlyIncome * 10 // Limite máximo de 10x a renda mensal
        );
        this.monitoring.incrementCounter('credit_approval_approved');
      } else {
        reason = 'Crédito insuficiente ou alta relação dívida/renda';
        this.monitoring.incrementCounter('credit_approval_denied');
      }
      
      // Finalizar métrica de tempo
      timer.end();
      
      return {
        approved: isCreditWorthy,
        approvedLimit,
        reason
      };
    } catch (error) {
      this.monitoring.recordError('credit_approval_error', error);
      throw error;
    }
  }
}