import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53patterns from 'aws-cdk-lib/aws-route53-patterns';
import * as s3 from 'aws-cdk-lib/aws-s3';

export class DisasterRecoveryStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // Bucket para backups cross-region
    const backupBucket = new s3.Bucket(this, 'DR-BackupBucket', {
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
          expiration: cdk.Duration.days(365),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    
    // Configuração de DNS para failover
    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: 'creditplatform.example.com',
    });
    
    const failover = new route53patterns.HttpsRedirect(this, 'Failover', {
      recordNames: ['api.creditplatform.example.com'],
      targetDomain: 'api-dr.creditplatform.example.com',
      zone: hostedZone,
    });
  }
}