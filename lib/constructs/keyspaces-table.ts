import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as customresources from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';

/**
 * Propriedades para a criação de uma tabela Keyspaces otimizada
 */
export interface KeyspacesTableProps {
  /**
   * Nome do keyspace (banco de dados)
   */
  keyspaceName: string;
  
  /**
   * Nome da tabela
   */
  tableName: string;
  
  /**
   * Schema da tabela em formato CQL (Cassandra Query Language)
   */
  tableSchema: string;
  
  /**
   * Configuração de capacidade provisionada para leitura (unidades)
   * @default 100
   */
  readCapacityUnits?: number;
  
  /**
   * Configuração de capacidade provisionada para escrita (unidades)
   * @default 100
   */
  writeCapacityUnits?: number;
  
  /**
   * Habilitar auto scaling para leitura
   * @default true
   */
  enableReadScaling?: boolean;
  
  /**
   * Habilitar auto scaling para escrita
   * @default true
   */
  enableWriteScaling?: boolean;
  
  /**
   * Configurações de auto scaling para leitura (min, max, targetUtilization)
   * @default { min: 5, max: 1000, targetUtilization: 70 }
   */
  readScalingConfig?: {
    min: number;
    max: number;
    targetUtilization: number;
  };
  
  /**
   * Configurações de auto scaling para escrita (min, max, targetUtilization)
   * @default { min: 5, max: 1000, targetUtilization: 70 }
   */
  writeScalingConfig?: {
    min: number;
    max: number;
    targetUtilization: number;
  };
  
  /**
   * Tempo para elevar o TTL (Time to Live) da tabela em segundos
   * @default undefined (sem TTL)
   */
  ttlSeconds?: number;
}

/**
 * Construct para criar e otimizar uma tabela no Amazon Keyspaces (for Apache Cassandra)
 * com suporte a auto scaling e configurações avançadas
 */
export class KeyspacesTable extends Construct {
  /**
   * Amazon Resource Name (ARN) da tabela criada
   */
  public readonly tableArn: string;
  
  /**
   * Nome completo da tabela no formato keyspace.tableName
   */
  public readonly tableFullName: string;
  
  constructor(scope: Construct, id: string, props: KeyspacesTableProps) {
    super(scope, id);
    
    // Definir valores padrão
    const readCapacityUnits = props.readCapacityUnits || 100;
    const writeCapacityUnits = props.writeCapacityUnits || 100;
    const enableReadScaling = props.enableReadScaling !== undefined ? props.enableReadScaling : true;
    const enableWriteScaling = props.enableWriteScaling !== undefined ? props.enableWriteScaling : true;
    
    const readScalingConfig = props.readScalingConfig || {
      min: 5,
      max: 1000,
      targetUtilization: 70
    };
    
    const writeScalingConfig = props.writeScalingConfig || {
      min: 5,
      max: 1000,
      targetUtilization: 70
    };
    
    // Criar função Lambda para gerenciar a tabela Keyspaces
    const keyspacesManagerFunction = new lambda.Function(this, 'KeyspacesManagerFunction', {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  const keyspaces = new AWS.Cassandra();
  const applicationAutoScaling = new AWS.ApplicationAutoScaling();
  
  const props = event.ResourceProperties;
  const keyspaceName = props.KeyspaceName;
  const tableName = props.TableName;
  const tableSchema = props.TableSchema;
  const readCapacityUnits = parseInt(props.ReadCapacityUnits);
  const writeCapacityUnits = parseInt(props.WriteCapacityUnits);
  const enableReadScaling = props.EnableReadScaling === 'true';
  const enableWriteScaling = props.EnableWriteScaling === 'true';
  const readScalingConfig = JSON.parse(props.ReadScalingConfig);
  const writeScalingConfig = JSON.parse(props.WriteScalingConfig);
  const ttlSeconds = props.TtlSeconds ? parseInt(props.TtlSeconds) : undefined;
  
  const tableFullName = keyspaceName + '.' + tableName;
  const region = process.env.AWS_REGION;
  const accountId = event.ResourceProperties.AccountId;
  const tableArn = \`arn:aws:cassandra:\${region}:\${accountId}:/keyspace/\${keyspaceName}/table/\${tableName}\`;
  
  try {
    if (event.RequestType === 'Create' || event.RequestType === 'Update') {
      // Verificar se o keyspace existe, se não, criar
      try {
        await keyspaces.getKeyspace({ keyspaceName }).promise();
        console.log(\`Keyspace \${keyspaceName} already exists\`);
      } catch (error) {
        if (error.code === 'ResourceNotFoundException') {
          console.log(\`Creating keyspace \${keyspaceName}\`);
          await keyspaces.createKeyspace({
            keyspaceName,
            replicationSpecification: {
              replicationStrategy: 'SingleRegionStrategy',
              replicationFactor: 3
            }
          }).promise();
        } else {
          throw error;
        }
      }
      
      // Criar ou atualizar tabela
      try {
        if (event.RequestType === 'Create') {
          console.log(\`Creating table \${tableFullName}\`);
          await keyspaces.createTable({
            keyspaceName,
            tableName,
            schemaDefinition: {
              allColumns: JSON.parse(tableSchema).columns,
              partitionKeys: JSON.parse(tableSchema).partitionKeys,
              clusteringKeys: JSON.parse(tableSchema).clusteringKeys || []
            },
            capacitySpecification: {
              throughputMode: 'PROVISIONED',
              readCapacityUnits,
              writeCapacityUnits
            }
          }).promise();
        } else {
          // Para atualização, só podemos modificar a capacidade provisionada
          console.log(\`Updating table \${tableFullName} capacity\`);
          await keyspaces.updateTable({
            keyspaceName,
            tableName,
            capacitySpecification: {
              throughputMode: 'PROVISIONED',
              readCapacityUnits,
              writeCapacityUnits
            }
          }).promise();
        }
      } catch (error) {
        console.error('Error creating/updating table:', error);
        throw error;
      }
      
      // Configurar TTL se especificado
      if (ttlSeconds !== undefined) {
        try {
          console.log(\`Configuring TTL for table \${tableFullName}: \${ttlSeconds} seconds\`);
          await keyspaces.updateTable({
            keyspaceName,
            tableName,
            timeToLive: {
              status: 'ENABLED',
              defaultTimeToLive: ttlSeconds
            }
          }).promise();
        } catch (error) {
          console.error('Error configuring TTL:', error);
          // Não falhar por erro no TTL
        }
      }
      
      // Configurar auto scaling para leitura
      if (enableReadScaling) {
        try {
          console.log(\`Configuring read auto scaling for \${tableFullName}\`);
          // Registrar alvo escalável
          await applicationAutoScaling.registerScalableTarget({
            ServiceNamespace: 'cassandra',
            ResourceId: \`keyspace/\${keyspaceName}/table/\${tableName}\`,
            ScalableDimension: 'cassandra:table:ReadCapacityUnits',
            MinCapacity: readScalingConfig.min,
            MaxCapacity: readScalingConfig.max
          }).promise();
          
          // Configurar política de escalabilidade
          await applicationAutoScaling.putScalingPolicy({
            ServiceNamespace: 'cassandra',
            ResourceId: \`keyspace/\${keyspaceName}/table/\${tableName}\`,
            ScalableDimension: 'cassandra:table:ReadCapacityUnits',
            PolicyName: \`${props.tableName}-read-scaling-policy\`,
            PolicyType: 'TargetTrackingScaling',
            TargetTrackingScalingPolicyConfiguration: {
              PredefinedMetricSpecification: {
                PredefinedMetricType: 'CassandraReadCapacityUtilization'
              },
              TargetValue: readScalingConfig.targetUtilization,
              ScaleInCooldown: 60,
              ScaleOutCooldown: 60
            }
          }).promise();
        } catch (error) {
          console.error('Error configuring read auto scaling:', error);
          // Não falhar por erro no auto scaling
        }
      }
      
      // Configurar auto scaling para escrita
      if (enableWriteScaling) {
        try {
          console.log(\`Configuring write auto scaling for \${tableFullName}\`);
          // Registrar alvo escalável
          await applicationAutoScaling.registerScalableTarget({
            ServiceNamespace: 'cassandra',
            ResourceId: \`keyspace/\${keyspaceName}/table/\${tableName}\`,
            ScalableDimension: 'cassandra:table:WriteCapacityUnits',
            MinCapacity: writeScalingConfig.min,
            MaxCapacity: writeScalingConfig.max
          }).promise();
          
          // Configurar política de escalabilidade
          await applicationAutoScaling.putScalingPolicy({
            ServiceNamespace: 'cassandra',
            ResourceId: \`keyspace/\${keyspaceName}/table/\${tableName}\`,
            ScalableDimension: 'cassandra:table:WriteCapacityUnits',
            PolicyName: \`${props.tableName}-write-scaling-policy\`,
            PolicyType: 'TargetTrackingScaling',
            TargetTrackingScalingPolicyConfiguration: {
              PredefinedMetricSpecification: {
                PredefinedMetricType: 'CassandraWriteCapacityUtilization'
              },
              TargetValue: writeScalingConfig.targetUtilization,
              ScaleInCooldown: 60,
              ScaleOutCooldown: 60
            }
          }).promise();
        } catch (error) {
          console.error('Error configuring write auto scaling:', error);
          // Não falhar por erro no auto scaling
        }
      }
    } else if (event.RequestType === 'Delete') {
      // Remover políticas de auto scaling
      try {
        const applicationAutoScaling = new AWS.ApplicationAutoScaling();
        
        if (enableReadScaling) {
          console.log(\`Removing read auto scaling for \${tableFullName}\`);
          await applicationAutoScaling.deleteScalingPolicy({
            ServiceNamespace: 'cassandra',
            ResourceId: \`keyspace/\${keyspaceName}/table/\${tableName}\`,
            ScalableDimension: 'cassandra:table:ReadCapacityUnits',
            PolicyName: \`${props.tableName}-read-scaling-policy\`
          }).promise();
          
          await applicationAutoScaling.deregisterScalableTarget({
            ServiceNamespace: 'cassandra',
            ResourceId: \`keyspace/\${keyspaceName}/table/\${tableName}\`,
            ScalableDimension: 'cassandra:table:ReadCapacityUnits'
          }).promise();
        }
        
        if (enableWriteScaling) {
          console.log(\`Removing write auto scaling for \${tableFullName}\`);
          await applicationAutoScaling.deleteScalingPolicy({
            ServiceNamespace: 'cassandra',
            ResourceId: \`keyspace/\${keyspaceName}/table/\${tableName}\`,
            ScalableDimension: 'cassandra:table:WriteCapacityUnits',
            PolicyName: \`${props.tableName}-write-scaling-policy\`
          }).promise();
          
          await applicationAutoScaling.deregisterScalableTarget({
            ServiceNamespace: 'cassandra',
            ResourceId: \`keyspace/\${keyspaceName}/table/\${tableName}\`,
            ScalableDimension: 'cassandra:table:WriteCapacityUnits'
          }).promise();
        }
      } catch (error) {
        console.error('Error removing auto scaling:', error);
        // Continuar com a exclusão mesmo com erro no auto scaling
      }
      
      // Excluir tabela
      try {
        console.log(\`Deleting table \${tableFullName}\`);
        await keyspaces.deleteTable({
          keyspaceName,
          tableName
        }).promise();
      } catch (error) {
        if (error.code !== 'ResourceNotFoundException') {
          console.error('Error deleting table:', error);
          throw error;
        }
      }
    }
    
    return {
      PhysicalResourceId: tableFullName,
      Data: {
        TableArn: tableArn,
        TableFullName: tableFullName
      }
    };
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
};
      `),
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
    });
    
    // Conceder permissões necessárias para a função Lambda
    keyspacesManagerFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cassandra:Create*',
        'cassandra:Get*',
        'cassandra:Update*',
        'cassandra:Delete*',
        'cassandra:TagResource',
        'cassandra:UntagResource',
      ],
      resources: ['*'],
    }));
    
    keyspacesManagerFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'application-autoscaling:RegisterScalableTarget',
        'application-autoscaling:DeregisterScalableTarget',
        'application-autoscaling:PutScalingPolicy',
        'application-autoscaling:DeleteScalingPolicy',
      ],
      resources: ['*'],
    }));
    
    // Criar recurso personalizado para gerenciar a tabela Keyspaces
    const keyspacesTableResource = new customresources.AwsCustomResource(this, 'KeyspacesTableResource', {
      onCreate: {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
          FunctionName: keyspacesManagerFunction.functionName,
          Payload: JSON.stringify({
            RequestType: 'Create',
            ResourceProperties: {
              KeyspaceName: props.keyspaceName,
              TableName: props.tableName,
              TableSchema: props.tableSchema,
              ReadCapacityUnits: readCapacityUnits.toString(),
              WriteCapacityUnits: writeCapacityUnits.toString(),
              EnableReadScaling: enableReadScaling.toString(),
              EnableWriteScaling: enableWriteScaling.toString(),
              ReadScalingConfig: JSON.stringify(readScalingConfig),
              WriteScalingConfig: JSON.stringify(writeScalingConfig),
              TtlSeconds: props.ttlSeconds?.toString(),
              AccountId: cdk.Stack.of(this).account,
            }
          }),
        },
        physicalResourceId: customresources.PhysicalResourceId.fromResponse('Payload.PhysicalResourceId'),
        outputPath: 'Payload',
      },
      onUpdate: {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
          FunctionName: keyspacesManagerFunction.functionName,
          Payload: JSON.stringify({
            RequestType: 'Update',
            ResourceProperties: {
              KeyspaceName: props.keyspaceName,
              TableName: props.tableName,
              TableSchema: props.tableSchema,
              ReadCapacityUnits: readCapacityUnits.toString(),
              WriteCapacityUnits: writeCapacityUnits.toString(),
              EnableReadScaling: enableReadScaling.toString(),
              EnableWriteScaling: enableWriteScaling.toString(),
              ReadScalingConfig: JSON.stringify(readScalingConfig),
              WriteScalingConfig: JSON.stringify(writeScalingConfig),
              TtlSeconds: props.ttlSeconds?.toString(),
              AccountId: cdk.Stack.of(this).account,
            }
          }),
        },
        physicalResourceId: customresources.PhysicalResourceId.fromResponse('Payload.PhysicalResourceId'),
        outputPath: 'Payload',
      },
      onDelete: {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
          FunctionName: keyspacesManagerFunction.functionName,
          Payload: JSON.stringify({
            RequestType: 'Delete',
            ResourceProperties: {
              KeyspaceName: props.keyspaceName,
              TableName: props.tableName,
              TableSchema: props.tableSchema,
              ReadCapacityUnits: readCapacityUnits.toString(),
              WriteCapacityUnits: writeCapacityUnits.toString(),
              EnableReadScaling: enableReadScaling.toString(),
              EnableWriteScaling: enableWriteScaling.toString(),
              ReadScalingConfig: JSON.stringify(readScalingConfig),
              WriteScalingConfig: JSON.stringify(writeScalingConfig),
              AccountId: cdk.Stack.of(this).account,
            }
          }),
        },
      },
      policy: customresources.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['lambda:InvokeFunction'],
          resources: [keyspacesManagerFunction.functionArn],
        }),
      ]),
    });
    
    // Definir propriedades de saída
    this.tableArn = keyspacesTableResource.getResponseField('Data.TableArn');
    this.tableFullName = keyspacesTableResource.getResponseField('Data.TableFullName');
  }
}

// Exemplo de utilização na stack de storage
// lib/stacks/storage-stack.ts (trecho para Keyspaces otimizado)

import { KeyspacesTable } from '../constructs/keyspaces-table';

// Dentro da classe StorageStack...

// Criar keyspace otimizado para a plataforma de crédito
const creditDataTable = new KeyspacesTable(this, 'CreditDataTable', {
  keyspaceName: 'creditplatform',
  tableName: 'creditdata',
  tableSchema: JSON.stringify({
    columns: [
      { name: 'customer_id', type: 'text' },
      { name: 'data_type', type: 'text' },
      { name: 'transaction_id', type: 'text' },
      { name: 'amount', type: 'decimal' },
      { name: 'status', type: 'text' },
      { name: 'credit_score', type: 'int' },
      { name: 'monthly_income', type: 'decimal' },
      { name: 'existing_debts', type: 'decimal' },
      { name: 'created_at', type: 'timestamp' },
      { name: 'updated_at', type: 'timestamp' },
      { name: 'ttl', type: 'timestamp' }
    ],
    partitionKeys: [
      { name: 'customer_id' }
    ],
    clusteringKeys: [
      { name: 'data_type', orderBy: 'ASC' }
    ]
  }),
  // Configuração inicial mais alta para lidar com picos e evitar throttling
  readCapacityUnits: 500,
  writeCapacityUnits: 500,
  // Auto scaling agressivo para lidar com picos de demanda
  enableReadScaling: true,
  enableWriteScaling: true,
  readScalingConfig: {
    min: 100,
    max: 10000,
    targetUtilization: 50  // Valor menor para escalar mais proativamente
  },
  writeScalingConfig: {
    min: 100,
    max: 10000,
    targetUtilization: 50  // Valor menor para escalar mais proativamente
  },
  // TTL para dados transacionais (30 dias)
  ttlSeconds: 2592000
});