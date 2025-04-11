import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { KinesisEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';

export interface IngestionConstructProps {
  vpc: ec2.IVpc;
  hotDataTable: dynamodb.Table;
  dataEncryptionKey: kms.IKey;
}

export class IngestionConstruct extends Construct {
  constructor(scope: Construct, id: string, props: IngestionConstructProps) {
    super(scope, id);
    
    // Kinesis stream para ingestão confiável
    const dataStream = new kinesis.Stream(this, 'DataIngestionStream', {
      streamName: 'credit-platform-data-stream',
      shardCount: 10,
      retentionPeriod: cdk.Duration.hours(48),
      encryption: kinesis.StreamEncryption.KMS,
      encryptionKey: props.dataEncryptionKey
    });
    
    // Dead Letter Queue para eventos com falha
    const deadLetterQueue = new sqs.Queue(this, 'IngestionDLQ', {
      retentionPeriod: cdk.Duration.days(14),
      visibilityTimeout: cdk.Duration.minutes(30),
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: props.dataEncryptionKey
    });
    
    // Lambda para processamento dos registros
    const processorFunction = new lambda.Function(this, 'StreamProcessor', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/processor'),
      environment: {
        DESTINATION_TABLE: props.hotDataTable.tableName,
        ENCRYPTION_KEY_ARN: props.dataEncryptionKey.keyArn
      },
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      }
    });
    
    // Conceder permissões para o Lambda acessar a tabela
    props.hotDataTable.grantReadWriteData(processorFunction);
    
    // Conectar Lambda ao Kinesis com configurações aprimoradas
    processorFunction.addEventSource(new KinesisEventSource(dataStream, {
      batchSize: 100,
      startingPosition: lambda.StartingPosition.LATEST,
      retryAttempts: 5,  // Aumentado para melhor resiliência
      bisectBatchOnError: true,  // Divide o lote em caso de falha para processamento mais granular
      onFailure: new SqsDlq(deadLetterQueue),
      parallelizationFactor: 10,  // Processar múltiplos lotes de um shard em paralelo
      maxBatchingWindow: cdk.Duration.seconds(30),  // Aguardar até 30s para acumular registros
    }));
    
    // Métricas personalizadas para ingestão
    new cdk.aws_cloudwatch.Metric({
      namespace: 'CreditPlatform/Ingestion',
      metricName: 'ProcessedRecords',
      dimensionsMap: {
        'Stream': dataStream.streamName,
        'Function': processorFunction.functionName
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(1)
    });
    
    // Alarmes para monitorar a ingestão
    const failedIngestionAlarm = new cdk.aws_cloudwatch.Alarm(this, 'FailedIngestionAlarm', {
      metric: deadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5)
      }),
      threshold: 10,
      evaluationPeriods: 1,
      alarmDescription: 'Muitos registros falhando na ingestão e indo para a DLQ',
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING
    });
  }
}