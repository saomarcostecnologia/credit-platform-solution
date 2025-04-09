import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';

export class DataConsistencyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // Função para detecção de inconsistências
    const inconsistencyDetectorFunction = new lambda.Function(this, 'InconsistencyDetector', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/inconsistency-detector'),
      environment: {
        PRIMARY_TABLE: 'credit-data',
        SECONDARY_TABLE: 'credit-hot-data',
      },
      timeout: cdk.Duration.minutes(10),
      memorySize: 1024,
    });
    
    // Função para reconciliação de dados
    const dataReconciliationFunction = new lambda.Function(this, 'DataReconciliation', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/data-reconciliation'),
      environment: {
        PRIMARY_TABLE: 'credit-data',
        SECONDARY_TABLE: 'credit-hot-data',
      },
      timeout: cdk.Duration.minutes(15),
      memorySize: 2048,
    });
    
    // Step Function para orquestrar processo de reconciliação
    const checkInconsistencies = new tasks.LambdaInvoke(this, 'CheckInconsistencies', {
      lambdaFunction: inconsistencyDetectorFunction,
      outputPath: '$.Payload',
    });
    
    const reconcileData = new tasks.LambdaInvoke(this, 'ReconcileData', {
      lambdaFunction: dataReconciliationFunction,
      outputPath: '$.Payload',
    });
    
    const reconciliationWorkflow = new sfn.StateMachine(this, 'ReconciliationWorkflow', {
      definition: sfn.Chain.start(checkInconsistencies)
        .next(new sfn.Choice(this, 'AreThereInconsistencies')
          .when(sfn.Condition.booleanEquals('$.inconsistenciesFound', true), reconcileData)
          .otherwise(new sfn.Succeed(this, 'NoInconsistenciesFound'))),
      timeout: cdk.Duration.minutes(30),
    });
    
    // Agendar verificação diária
    const reconciliationSchedule = new events.Rule(this, 'DailyReconciliation', {
      schedule: events.Schedule.cron({
        hour: '1',
        minute: '0',
      }),
      description: 'Trigger daily data reconciliation',
    });
    
    reconciliationSchedule.addTarget(new targets.SfnStateMachine(reconciliationWorkflow));
  }
}