import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as guardduty from 'aws-cdk-lib/aws-guardduty';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

// A interface não deve estender StackProps, já que isso não é mais uma Stack
export interface SecurityConstructProps {
  vpc: ec2.IVpc;
}

// Mudar de Stack para Construct
export class SecurityConstruct extends Construct {
  public readonly dataEncryptionKey: kms.Key;
  
  // Alterar a assinatura do construtor para usar SecurityConstructProps
  constructor(scope: Construct, id: string, props: SecurityConstructProps) {
    // Para um Construct, super só recebe scope e id
    super(scope, id);
    
    // Chave KMS para criptografia de dados
    const dataEncryptionKey = new kms.Key(this, 'DataEncryptionKey', {
      enableKeyRotation: true,
      description: 'Key for encrypting credit platform data',
      alias: 'alias/credit-platform-data',
    });
    
    // Políticas de IAM com acesso mínimo necessário
    const processorRole = new iam.Role(this, 'DataProcessorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for data processing functions',
    });
    
    processorRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:PutItem',
        'dynamodb:GetItem',
        'dynamodb:UpdateItem',
        'dynamodb:Query',
      ],
      resources: ['arn:aws:dynamodb:*:*:table/credit-*'],
      effect: iam.Effect.ALLOW,
    }));
    
    // Configuração do AWS WAF
    const apiWaf = new wafv2.CfnWebACL(this, 'CreditApiWaf', {
      defaultAction: { allow: {} },
      scope: 'REGIONAL',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'CreditApiWaf',
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'AWS-AWSManagedRulesSQLiRuleSet',
          priority: 0,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesSQLiRuleSet',
            },
          },
          overrideAction: { none: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWS-AWSManagedRulesSQLiRuleSet',
          },
        },
        {
          name: 'RateLimit',
          priority: 1,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 1000,
              aggregateKeyType: 'IP',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimit',
          },
        },
      ],
    });
    
    // Habilitar GuardDuty para detecção de ameaças
    const detector = new guardduty.CfnDetector(this, 'GuardDutyDetector', {
      enable: true,
      findingPublishingFrequency: 'FIFTEEN_MINUTES',
    });
    
    // Chave Kms 
    this.dataEncryptionKey = dataEncryptionKey;
  }
}