import { IDataStorage } from '../interfaces/i-data-storage';
import * as AWS from 'aws-sdk';
import { IMonitoring } from '../interfaces/i-monitoring';

export class AuroraAdapter implements IDataStorage {
  private readonly client: AWS.RDSDataService;
  
  constructor(
    private readonly clusterArn: string,
    private readonly secretArn: string,
    private readonly database: string,
    private readonly monitoring: IMonitoring
  ) {
    this.client = new AWS.RDSDataService();
  }
  
  async readItem(id: string): Promise<any> {
    const timer = this.monitoring.startTimer('aurora_read_item');
    
    try {
      const result = await this.client.executeStatement({
        resourceArn: this.clusterArn,
        secretArn: this.secretArn,
        database: this.database,
        sql: 'SELECT * FROM customers WHERE customer_id = :id',
        parameters: [{ name: 'id', value: { stringValue: id } }]
      }).promise();
      
      timer.end();
      
      if (result.records && result.records.length > 0) {
        // Converter de formato de array para objeto
        return this.recordToObject(result.records[0]);
      }
      
      return null;
    } catch (error) {
        // Verificar se é um Error antes de passar
        if (error instanceof Error) {
          this.monitoring.recordError('aurora_read_error', error);
        } else {
          // Caso não seja um Error, crie um novo objeto Error
          this.monitoring.recordError('aurora_read_error', new Error(String(error)));
        }
        timer.end();
        throw error;
        }
    }
  
  async query(params: any): Promise<any[]> {
    const timer = this.monitoring.startTimer('aurora_query');
    
    try {
      const { sql, parameters } = this.buildQueryFromParams(params);
      
      const result = await this.client.executeStatement({
        resourceArn: this.clusterArn,
        secretArn: this.secretArn,
        database: this.database,
        sql,
        parameters
      }).promise();
      
      timer.end();
      
      if (result.records) {
        return result.records.map((record: any) => this.recordToObject(record));
      }
      
      return [];
    } catch (error) {
        // Verificar se é um Error antes de passar
        if (error instanceof Error) {
          this.monitoring.recordError('aurora_read_error', error);
        } else {
          // Caso não seja um Error, crie um novo objeto Error
          this.monitoring.recordError('aurora_read_error', new Error(String(error)));
        }
        timer.end();
        throw error;
      }
    }
  
  async writeItem(item: any): Promise<void> {
    const timer = this.monitoring.startTimer('aurora_write_item');
    
    try {
      const { columns, placeholders, values } = this.prepareInsertData(item);
      
      await this.client.executeStatement({
        resourceArn: this.clusterArn,
        secretArn: this.secretArn,
        database: this.database,
        sql: `INSERT INTO customers (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
        parameters: values
      }).promise();
      
      timer.end();
    } catch (error) {
        // Verificar se é um Error antes de passar
        if (error instanceof Error) {
          this.monitoring.recordError('aurora_read_error', error);
        } else {
          // Caso não seja um Error, crie um novo objeto Error
          this.monitoring.recordError('aurora_read_error', new Error(String(error)));
        }
        timer.end();
        throw error;
      }
    }
  
  async updateItem(id: string, item: any): Promise<void> {
    const timer = this.monitoring.startTimer('aurora_update_item');
    
    try {
      const { setClause, values } = this.prepareUpdateData(item);
      
      values.push({ name: 'id', value: { stringValue: id } });
      
      await this.client.executeStatement({
        resourceArn: this.clusterArn,
        secretArn: this.secretArn,
        database: this.database,
        sql: `UPDATE customers SET ${setClause} WHERE customer_id = :id`,
        parameters: values
      }).promise();
      
      timer.end();
    } catch (error) {
        // Verificar se é um Error antes de passar
        if (error instanceof Error) {
          this.monitoring.recordError('aurora_read_error', error);
        } else {
          // Caso não seja um Error, crie um novo objeto Error
          this.monitoring.recordError('aurora_read_error', new Error(String(error)));
        }
        timer.end();
        throw error;
      }
    }
  
  async deleteItem(id: string): Promise<void> {
    const timer = this.monitoring.startTimer('aurora_delete_item');
    
    try {
      await this.client.executeStatement({
        resourceArn: this.clusterArn,
        secretArn: this.secretArn,
        database: this.database,
        sql: 'DELETE FROM customers WHERE customer_id = :id',
        parameters: [{ name: 'id', value: { stringValue: id } }]
      }).promise();
      
      timer.end();
    } catch (error) {
        // Verificar se é um Error antes de passar
        if (error instanceof Error) {
          this.monitoring.recordError('aurora_read_error', error);
        } else {
          // Caso não seja um Error, crie um novo objeto Error
          this.monitoring.recordError('aurora_read_error', new Error(String(error)));
        }
        timer.end();
        throw error;
      }
    }
  
  async getMetrics(): Promise<any> {
    try {
      const result = await this.client.executeStatement({
        resourceArn: this.clusterArn,
        secretArn: this.secretArn,
        database: this.database,
        sql: `
          SELECT 
            (SELECT COUNT(*) FROM customers) as customer_count,
            (SELECT AVG(credit_score) FROM customers) as avg_credit_score,
            (SELECT COUNT(*) FROM transactions WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)) as daily_transactions
        `
      }).promise();
      
      if (result.records && result.records.length > 0) {
        return this.recordToObject(result.records[0]);
      }
      
      return {
        customer_count: 0,
        avg_credit_score: 0,
        daily_transactions: 0
      };
    } catch (error) {
      this.monitoring.recordError('aurora_metrics_error', error);
      throw error;
    }
  }
  
  // Métodos auxiliares privados
  private recordToObject(record: any): any {
    // Implementar a conversão adequada
    const result: any = {};
    
    // Se você tiver campos específicos para extrair
    if (record && Array.isArray(record)) {
      // Supondo que o record é um array de valores de campo
      record.forEach((field, index) => {
        // Aqui você extrai os valores baseado na estrutura do record
        const fieldValue = field.stringValue || field.longValue || field.doubleValue || field.booleanValue || null;
        const fieldName = `field_${index}`; // Idealmente, você teria os nomes reais dos campos
        result[fieldName] = fieldValue;
      });
    }
    
    return result;
  }
  
  private buildQueryFromParams(params: any): { sql: string; parameters: AWS.RDSDataService.SqlParameter[] } {
    // Implementação para construir consulta a partir de parâmetros
    // Omitido para brevidade
    return { sql: '', parameters: [] };
  }
  
  private prepareInsertData(item: any): { columns: string[]; placeholders: string[]; values: AWS.RDSDataService.SqlParameter[] } {
    // Implementação para preparar dados de inserção
    // Omitido para brevidade
    return { columns: [], placeholders: [], values: [] };
  }
  
  private prepareUpdateData(item: any): { setClause: string; values: AWS.RDSDataService.SqlParameter[] } {
    // Implementação para preparar dados de atualização
    // Omitido para brevidade
    return { setClause: '', values: [] };
  }
}