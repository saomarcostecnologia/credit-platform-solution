import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';

export interface TransactionConstructProps {
  transactionName: string;
}

export class DistributedTransactionConstruct extends Construct {
  public readonly stateMachine: sfn.StateMachine;
  
  constructor(scope: Construct, id: string, props: TransactionConstructProps) {
    super(scope, id);
    
    // Lambda para operações do MySQL
    const mysqlOperation = new lambda.Function(this, 'MySQLOperation', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/mysql-operation'),
      timeout: cdk.Duration.minutes(5),
    });
    
    // Lambda para operações do Keyspaces
    const keyspacesOperation = new lambda.Function(this, 'KeyspacesOperation', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/keyspaces-operation'),
      timeout: cdk.Duration.minutes(5),
    });
    
    // Lambda para compensação do MySQL
    const mysqlCompensation = new lambda.Function(this, 'MySQLCompensation', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/mysql-compensation'),
      timeout: cdk.Duration.minutes(5),
    });
    
    // Lambda para compensação do Keyspaces
    const keyspacesCompensation = new lambda.Function(this, 'KeyspacesCompensation', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/keyspaces-compensation'),
      timeout: cdk.Duration.minutes(5),
    });
    
    // Definição do fluxo de Step Functions para o padrão Saga
    const mysqlTask = new tasks.LambdaInvoke(this, 'UpdateMySQL', {
      lambdaFunction: mysqlOperation,
      outputPath: '$.Payload',
    });
    
    const keyspacesTask = new tasks.LambdaInvoke(this, 'UpdateKeyspaces', {
      lambdaFunction: keyspacesOperation,
      outputPath: '$.Payload',
    });
    
    const mysqlCompensationTask = new tasks.LambdaInvoke(this, 'CompensateMySQL', {
      lambdaFunction: mysqlCompensation,
      outputPath: '$.Payload',
    });
    
    const keyspacesCompensationTask = new tasks.LambdaInvoke(this, 'CompensateKeyspaces', {
      lambdaFunction: keyspacesCompensation,
      outputPath: '$.Payload',
    });
    
    // Definir fluxo principal e de compensação (Saga Pattern)
    const definition = mysqlTask
      .next(new sfn.Choice(this, 'MySQLSuccessful?')
        .when(sfn.Condition.booleanEquals('$.success', true), keyspacesTask
          .next(new sfn.Choice(this, 'KeyspacesSuccessful?')
            .when(sfn.Condition.booleanEquals('$.success', true), new sfn.Succeed(this, 'TransactionSucceeded'))
            .otherwise(mysqlCompensationTask.next(new sfn.Fail(this, 'TransactionFailed')))))
        .otherwise(new sfn.Fail(this, 'MySQLFailed')));
    
    // Criar a Step Function
    this.stateMachine = new sfn.StateMachine(this, 'TransactionStateMachine', {
      stateMachineName: `${props.transactionName}-saga`,
      definition,
      timeout: cdk.Duration.minutes(30),
    });
  }
}