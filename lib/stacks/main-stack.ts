import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from 'aws-cdk-lib/aws-kms';
import { StorageStack } from './storage-stack';
import { IngestionStack } from './ingestion-stack';
import { SecurityStack } from './security-stack';
import { ObservabilityStack } from './observability-stack';
import { ProcessingStack } from './processing-stack';

export class MainStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
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
    
    // Stack de segurança (deve ser criada primeiro)
    const securityStack = new SecurityStack(this, 'SecurityStack', {
      vpc,
      env: props?.env,
    });
    
    // Stack de armazenamento
    const storageStack = new StorageStack(this, 'StorageStack', {
      vpc,
      dataEncryptionKey: securityStack.dataEncryptionKey,
      env: props?.env,
    });
    
    // Stack de ingestão
    const ingestionStack = new IngestionStack(this, 'IngestionStack', {
      vpc,
      hotDataTable: storageStack.hotDataTable,
      dataEncryptionKey: securityStack.dataEncryptionKey,
      env: props?.env,
    });
    
    // Stack de processamento
    const processingStack = new ProcessingStack(this, 'ProcessingStack', {
      vpc,
      auroraCluster: storageStack.auroraCluster,
      redisCluster: storageStack.redisCluster,
      hotDataTable: storageStack.hotDataTable,
      dataEncryptionKey: securityStack.dataEncryptionKey,
      env: props?.env,
    });
    
    // Stack de observabilidade
    const observabilityStack = new ObservabilityStack(this, 'ObservabilityStack', {
      vpc,
      auroraCluster: storageStack.auroraCluster,
      hotDataTable: storageStack.hotDataTable,
      env: props?.env,
    });
  }
}