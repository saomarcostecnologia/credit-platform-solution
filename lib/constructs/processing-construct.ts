import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { DatabaseCluster } from './database-cluster';

export interface ProcessingConstructProps {
  vpc: ec2.IVpc;
  auroraCluster: DatabaseCluster;
  redisCluster: elasticache.CfnReplicationGroup;
  hotDataTable: dynamodb.Table;
  dataEncryptionKey: kms.IKey;
}

export class ProcessingConstruct extends Construct {
  public readonly creditDecisionStateMachine: sfn.StateMachine;
  
  constructor(scope: Construct, id: string, props: ProcessingConstructProps) {
    super(scope, id);

    // Grupo de Logs para o motor de decisão de crédito
    const decisionEngineLogGroup = new logs.LogGroup(this, 'DecisionEngineLogGroup', {
      logGroupName: '/credit-platform/decision-engine',
      retention: logs.RetentionDays.TWO_WEEKS
    });
    
    // Função Lambda para consulta de informações de crédito
    const creditInfoFunction = new lambda.Function(this, 'CreditInfoFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/credit-info'),
      environment: {
        AURORA_CLUSTER_ARN: props.auroraCluster.cluster.clusterArn,
        AURORA_SECRET_ARN: props.auroraCluster.secret.secretArn,
        AURORA_DATABASE: 'creditplatform',
        DYNAMODB_TABLE: props.hotDataTable.tableName,
        REDIS_ENDPOINT: `${props.redisCluster.attrPrimaryEndPointAddress}:${props.redisCluster.attrPrimaryEndPointPort}`
      },
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      logGroup: decisionEngineLogGroup
    });
    
    // Função Lambda para cálculo de score de crédito
    const creditScoringFunction = new lambda.Function(this, 'CreditScoringFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/credit-scoring'),
      environment: {
        ENCRYPTION_KEY_ARN: props.dataEncryptionKey.keyArn
      },
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      },
      timeout: cdk.Duration.seconds(60),
      memorySize: 1024,
      logGroup: decisionEngineLogGroup
    });
    
    // Função Lambda para aplicação de políticas e tomada de decisão
    const creditDecisionFunction = new lambda.Function(this, 'CreditDecisionFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/credit-decision'),
      environment: {
        HOT_DATA_TABLE: props.hotDataTable.tableName
      },
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      logGroup: decisionEngineLogGroup
    });
    
    // Função Lambda para notificar o resultado da decisão
    const notificationFunction = new lambda.Function(this, 'NotificationFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/notification'),
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      },
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      logGroup: decisionEngineLogGroup
    });
    
    // Conceder permissões necessárias
    props.hotDataTable.grantReadWriteData(creditInfoFunction);
    props.hotDataTable.grantReadWriteData(creditDecisionFunction);
    props.dataEncryptionKey.grantEncryptDecrypt(creditScoringFunction);
    
    // Tasks da Step Function
    const getCreditInfo = new tasks.LambdaInvoke(this, 'GetCreditInfo', {
      lambdaFunction: creditInfoFunction,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
      timeout: cdk.Duration.seconds(60)
    });
    
    const calculateScore = new tasks.LambdaInvoke(this, 'CalculateScore', {
      lambdaFunction: creditScoringFunction,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
      timeout: cdk.Duration.seconds(60)
    });
    
    const makeDecision = new tasks.LambdaInvoke(this, 'MakeDecision', {
      lambdaFunction: creditDecisionFunction,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
      timeout: cdk.Duration.seconds(60)
    });
    
    const sendNotification = new tasks.LambdaInvoke(this, 'SendNotification', {
      lambdaFunction: notificationFunction,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
      timeout: cdk.Duration.seconds(60)
    });
    
    // Fluxo da Step Function para processar uma solicitação de crédito
    const definition = getCreditInfo
      .next(calculateScore)
      .next(makeDecision)
      .next(new sfn.Choice(this, 'IsApproved')
        .when(sfn.Condition.booleanEquals('$.approved', true), 
          sendNotification.next(new sfn.Succeed(this, 'CreditApproved')))
        .otherwise(
          sendNotification.next(new sfn.Succeed(this, 'CreditDenied')))
      );
    
    // Criar a Step Function para o fluxo de decisão de crédito
    this.creditDecisionStateMachine = new sfn.StateMachine(this, 'CreditDecisionProcess', {
      definition,
      timeout: cdk.Duration.minutes(5),
      tracingEnabled: true,
      logs: {
        destination: decisionEngineLogGroup,
        level: sfn.LogLevel.ALL,
        includeExecutionData: true
      }
    });
    
    // Fila SQS para solicitações de decisão de crédito
    const creditRequestQueue = new sqs.Queue(this, 'CreditRequestQueue', {
      visibilityTimeout: cdk.Duration.minutes(6), // Maior que o timeout da Step Function
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: props.dataEncryptionKey,
      deadLetterQueue: {
        queue: new sqs.Queue(this, 'CreditRequestDLQ', {
          retentionPeriod: cdk.Duration.days(14)
        }),
        maxReceiveCount: 3
      }
    });
    
    // Lambda para processar solicitações da fila e iniciar a Step Function
    const processorFunction = new lambda.Function(this, 'QueueProcessorFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/queue-processor'),
      environment: {
        STATE_MACHINE_ARN: this.creditDecisionStateMachine.stateMachineArn
      },
      timeout: cdk.Duration.minutes(1),
      memorySize: 256
    });
    
    // Permitir que a função Lambda inicie a Step Function
    this.creditDecisionStateMachine.grantStartExecution(processorFunction);
    
    // Adicionar evento SQS para a função Lambda
    processorFunction.addEventSource(new cdk.aws_lambda_event_sources.SqsEventSource(creditRequestQueue, {
      batchSize: 10,
      maxBatchingWindow: cdk.Duration.seconds(30)
    }));
    
    // Métricas personalizadas para o motor de decisão
    new cdk.aws_cloudwatch.Metric({
      namespace: 'CreditPlatform/DecisionEngine',
      metricName: 'ProcessingTime',
      statistic: 'Average',
      period: cdk.Duration.minutes(1)
    });
  }
}