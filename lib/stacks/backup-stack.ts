import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as backup from 'aws-cdk-lib/aws-backup';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';

export class BackupStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // Plano de backup AWS
    const backupPlan = new backup.BackupPlan(this, 'CreditBackupPlan', {
      backupPlanName: 'credit-platform-backup',
    });
    
    // Regra de backup diário com retenção de 30 dias
    backupPlan.addRule(new backup.BackupPlanRule({
      ruleName: 'DailyBackups',
      scheduleExpression: events.Schedule.cron({
        hour: '2',
        minute: '0',
      }),
      startWindow: cdk.Duration.hours(1),
      completionWindow: cdk.Duration.hours(4),
      deleteAfter: cdk.Duration.days(30),
      enableContinuousBackup: true,
    }));
    
    // Regra de backup semanal com retenção de 6 meses
    backupPlan.addRule(new backup.BackupPlanRule({
      ruleName: 'WeeklyBackups',
      scheduleExpression: events.Schedule.cron({
        day: 'SUN',
        hour: '3',
        minute: '0',
      }),
      deleteAfter: cdk.Duration.days(180),
      copyActions: [{
        destinationRegion: 'us-west-2',
        destinationVault: backup.BackupVault.fromBackupVaultName(
          this, 
          'CrossRegionVault', 
          'credit-platform-cross-region'
        ),
      }],
    }));
    
    // Função para validação de backups
    const backupValidationFunction = new lambda.Function(this, 'BackupValidation', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/backup-validation'),
      environment: {
        BACKUP_VAULT: 'credit-platform-backup',
      },
      timeout: cdk.Duration.minutes(15),
    });
    
    // Agendar validação de backups
    const validationRule = new events.Rule(this, 'BackupValidationRule', {
      schedule: events.Schedule.cron({
        day: '*',
        hour: '4',
        minute: '0',
      }),
      description: 'Trigger backup validation',
    });
    
    validationRule.addTarget(new targets.LambdaFunction(backupValidationFunction));
  }
}