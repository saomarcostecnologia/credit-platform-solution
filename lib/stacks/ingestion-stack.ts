import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as lambda from 'aws-cdk-lib/aws-lambda';

export class IngestionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // Kinesis stream para ingestão confiável
    const dataStream = new kinesis.Stream(this, 'DataIngestionStream', {
      streamName: 'credit-platform-data-stream',
      shardCount: 10,
      retentionPeriod: cdk.Duration.hours(48),
    });
    
    // Lambda para processamento dos registros
    const processorFunction = new lambda.Function(this, 'StreamProcessor', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/processor'),
      environment: {
        DESTINATION_TABLE: 'credit-data',
      },
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
    });
    
    // Conectar Lambda ao Kinesis
    processorFunction.addEventSource(new KinesisEventSource(dataStream, {
      batchSize: 100,
      startingPosition: lambda.StartingPosition.LATEST,
      retryAttempts: 3,
    }));
  }
}