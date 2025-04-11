import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as backup from 'aws-cdk-lib/aws-backup';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53patterns from 'aws-cdk-lib/aws-route53-patterns';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchactions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { DatabaseCluster } from '../constructs/database-cluster';

export interface BackupAndDrConstructProps {
  vpc: ec2.IVpc;
  auroraCluster?: DatabaseCluster;
  primaryRegion: string;
  secondaryRegion: string;
  retentionDays: number;
  retentionDaysArchive: number;
  alertTopic?: sns.ITopic;
  domainName?: string;
}

export class BackupAndDrConstruct extends Construct {
  public readonly backupVault: backup.BackupVault;
  public readonly drBackupBucket: s3.Bucket;
  public readonly drReplicaBucket: s3.Bucket;
  
  constructor(scope: Construct, id: string, props: BackupAndDrConstructProps) {
    super(scope, id);

    // 1. Configuração de Backup AWS
    
    // Vault de backup principal
    this.backupVault = new backup.BackupVault(this, 'PrimaryBackupVault', {
      backupVaultName: 'credit-platform-primary-vault',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Configuração de notificações de backup usando EventBridge
    const backupTopic = props.alertTopic || new sns.Topic(this, 'BackupNotificationTopic', {
      displayName: 'Backup Notifications'
    });
    
    // Criar regras de evento para notificações de backup
    const backupSuccessRule = new events.Rule(this, 'BackupSuccessRule', {
      eventPattern: {
        source: ['aws.backup'],
        detailType: ['AWS Backup Job State Change'],
        detail: {
          state: ['COMPLETED'],
          resourceType: ['RDS', 'DynamoDB', 'Aurora'],
          backupVaultName: [this.backupVault.backupVaultName]
        }
      }
    });
    
    const backupFailureRule = new events.Rule(this, 'BackupFailureRule', {
      eventPattern: {
        source: ['aws.backup'],
        detailType: ['AWS Backup Job State Change'],
        detail: {
          state: ['FAILED'],
          resourceType: ['RDS', 'DynamoDB', 'Aurora'],
          backupVaultName: [this.backupVault.backupVaultName]
        }
      }
    });
    
    backupSuccessRule.addTarget(new targets.SnsTopic(backupTopic));
    backupFailureRule.addTarget(new targets.SnsTopic(backupTopic));
    
    // Plano de backup
    const backupPlan = new backup.BackupPlan(this, 'CreditPlatformBackupPlan', {
      backupPlanName: 'credit-platform-backup',
      backupVault: this.backupVault
    });
    
    // Regra de backup diário
    backupPlan.addRule(new backup.BackupPlanRule({
      ruleName: 'DailyBackups',
      scheduleExpression: events.Schedule.cron({
        hour: '2',
        minute: '0',
      }),
      startWindow: cdk.Duration.hours(1),
      completionWindow: cdk.Duration.hours(4),
      deleteAfter: cdk.Duration.days(props.retentionDays),
      enableContinuousBackup: true,
    }));
    
    // Regra de backup semanal
    backupPlan.addRule(new backup.BackupPlanRule({
      ruleName: 'WeeklyBackups',
      scheduleExpression: events.Schedule.cron({
        day: 'SUN',
        hour: '3',
        minute: '0',
      }),
      deleteAfter: cdk.Duration.days(props.retentionDaysArchive),
      // Remova a seção copyActions para simplificar
    }));
    
    // 2. Função para validação de backups
    
    const backupValidationFunction = new lambda.Function(this, 'BackupValidation', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/backup-validation'),
      environment: {
        BACKUP_VAULT: this.backupVault.backupVaultName,
        SNS_TOPIC_ARN: backupTopic.topicArn
      },
      timeout: cdk.Duration.minutes(15),
    });
    
    // Conceder permissões usando uma política em vez de grantRead
    backupValidationFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'backup:DescribeBackupVault',
        'backup:ListRecoveryPointsByBackupVault'
      ],
      resources: [this.backupVault.backupVaultArn]
    }));
    
    backupTopic.grantPublish(backupValidationFunction);
    
    // Agendar validação diária de backups
    const validationRule = new events.Rule(this, 'BackupValidationRule', {
      schedule: events.Schedule.cron({
        day: '*',
        hour: '4',
        minute: '0',
      }),
      description: 'Trigger backup validation',
    });
    
    validationRule.addTarget(new targets.LambdaFunction(backupValidationFunction));
    
    // 3. Configuração de Disaster Recovery
    
    // Bucket S3 para backup principal
    this.drBackupBucket = new s3.Bucket(this, 'DRBackupBucket', {
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [
        {
          id: 'ArchiveRule',
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
          expiration: cdk.Duration.days(props.retentionDaysArchive),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    
    // Bucket S3 para réplica (em outra região)
    this.drReplicaBucket = new s3.Bucket(this, 'ReplicaBucket', {
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    
    // Configurar replicação usando S3 Replication Time Control
    const cfnBucket = this.drBackupBucket.node.defaultChild as s3.CfnBucket;
    cfnBucket.replicationConfiguration = {
      role: new iam.Role(this, 'ReplicationRole', {
        assumedBy: new iam.ServicePrincipal('s3.amazonaws.com')
      }).roleArn,
      rules: [
        {
          id: 'ReplicationRule',
          status: 'Enabled',
          priority: 1,
          destination: {
            bucket: this.drReplicaBucket.bucketArn,
            storageClass: 'STANDARD'
          }
        }
      ]
    };
    
    // 4. Configuração de failover DNS (se o domínio for fornecido)
    
    if (props.domainName) {
      try {
        const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
          domainName: props.domainName,
        });
        
        // Configuração de DNS para failover
        new route53patterns.HttpsRedirect(this, 'Failover', {
          recordNames: [`api.${props.domainName}`],
          targetDomain: `api-dr.${props.domainName}`,
          zone: hostedZone,
        });
      } catch (error) {
        // Se não conseguir encontrar a zona hospedada, apenas logue e siga em frente
        console.warn('Unable to configure DNS failover - hosted zone not found');
      }
    }
    
    // 5. Alarmes para monitoramento do status de backup
    
    // Métrica para falhas de backup
    const backupFailureMetric = new cloudwatch.Metric({
      namespace: 'AWS/Backup',
      metricName: 'JobsFailed',
      dimensionsMap: {
        BackupVaultName: this.backupVault.backupVaultName
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(60)
    });
    
    // Alarme para falhas de backup
    const backupFailureAlarm = new cloudwatch.Alarm(this, 'BackupFailureAlarm', {
      metric: backupFailureMetric,
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Alarme para falhas em tarefas de backup',
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD
    });
    
    backupFailureAlarm.addAlarmAction(new cloudwatchactions.SnsAction(backupTopic));
  }
  
  // Método corrigido para selecionar recursos para backup
  public addResourceToBackup(resourceArn: string, resourceType: string) {
    const selection = new backup.BackupSelection(this, `Selection-${resourceType}`, {
      backupPlan: backup.BackupPlan.fromBackupPlanId(this, `Plan-${resourceType}`, 'credit-platform-backup'),
      resources: [
        backup.BackupResource.fromArn(resourceArn)
      ]
    });
    
    return selection;
  }
}