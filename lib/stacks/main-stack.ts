import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

// Importações corrigidas dos constructs
import { SecurityConstruct } from '../../lib/constructs/security-construct';
import { StorageConstruct } from '../../lib/constructs/storage-construct';
import { IngestionConstruct } from '../../lib/constructs/ingestion-construct';
import { ProcessingConstruct } from '../../lib/constructs/processing-construct';
import { ObservabilityConstruct } from '../../lib/constructs/observability-construct';
import { BackupAndDrConstruct } from '../../lib/constructs/backup-and-dr-construct';

export class MainStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // Obter a região atual e a conta da stack
    const currentRegion = cdk.Stack.of(this).region;
    const currentAccount = cdk.Stack.of(this).account;
    
    // VPC compartilhada para todos os recursos
    const vpc = new ec2.Vpc(this, 'CreditPlatformVpc', {
      maxAzs: 3,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });
    
    // 1. Segurança - chaves de criptografia, WAF, etc.
    const securityConstruct = new SecurityConstruct(this, 'Security', {
      vpc,
    });
    
    // 2. Armazenamento - Aurora, Redis, DynamoDB
    const storageConstruct = new StorageConstruct(this, 'Storage', {
      vpc,
      dataEncryptionKey: securityConstruct.dataEncryptionKey,
    });
    
    // 3. Observabilidade - métricas, logs, alertas
    const observabilityConstruct = new ObservabilityConstruct(this, 'Observability', {
      vpc,
      auroraCluster: storageConstruct.auroraCluster,
      hotDataTable: storageConstruct.hotDataTable,
      keyspacesTableName: 'credit-data', // Nome da tabela Keyspaces
      alertEmails: ['alerts@example.com'], // Substituir pelo email real
    });
    
    // 4. Ingestão - pipelines para carregamento de dados
    const ingestionConstruct = new IngestionConstruct(this, 'Ingestion', {
      vpc,
      hotDataTable: storageConstruct.hotDataTable,
      dataEncryptionKey: securityConstruct.dataEncryptionKey,
    });
    
    // 5. Processamento - motor de decisão de crédito
    const processingConstruct = new ProcessingConstruct(this, 'Processing', {
      vpc,
      auroraCluster: storageConstruct.auroraCluster,
      redisCluster: storageConstruct.redisCluster,
      hotDataTable: storageConstruct.hotDataTable,
      dataEncryptionKey: securityConstruct.dataEncryptionKey,
    });
    
    // 6. Backup e Disaster Recovery
    const backupAndDrConstruct = new BackupAndDrConstruct(this, 'BackupAndDR', {
      vpc,
      auroraCluster: storageConstruct.auroraCluster,
      primaryRegion: currentRegion,
      secondaryRegion: currentRegion === 'us-east-1' ? 'us-west-2' : 'us-east-1', // Região secundária diferente da principal
      retentionDays: 30,
      retentionDaysArchive: 365,
      alertTopic: observabilityConstruct.alertTopic,
      domainName: 'creditplatform.example.com', // Substituir pelo domínio real
    });
    
    // Adicionar recursos ao plano de backup
    backupAndDrConstruct.addResourceToBackup(
        storageConstruct.auroraCluster.cluster.clusterArn,
        'RDS_AURORA_CLUSTER'
    );
    
    backupAndDrConstruct.addResourceToBackup(
        storageConstruct.hotDataTable.tableArn,
        'DYNAMODB_TABLE'
    );
    
    // Aplicar tags para identificação de recursos
    cdk.Tags.of(this).add('Project', 'CreditPlatform');
    cdk.Tags.of(this).add('Environment', cdk.Stack.of(this).stackName.includes('prod') ? 'Production' : 'Development');
    cdk.Tags.of(this).add('Owner', 'DataEngineering');
    cdk.Tags.of(this).add('CostCenter', 'Credit-1001');
  }
}