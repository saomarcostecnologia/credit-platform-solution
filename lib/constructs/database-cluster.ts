import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export interface DatabaseClusterProps {
  vpc: ec2.IVpc;
  instanceType: ec2.InstanceType;
  instances?: number;
  backupRetention?: cdk.Duration;
  databaseName: string;
  monitoringInterval?: cdk.Duration;
  deletionProtection?: boolean;
  parameterGroup?: rds.IParameterGroup;
}

export class DatabaseCluster extends Construct {
  public readonly cluster: rds.DatabaseCluster;
  public readonly secret: secretsmanager.ISecret;
  public readonly securityGroup: ec2.SecurityGroup;
  
  constructor(scope: Construct, id: string, props: DatabaseClusterProps) {
    super(scope, id);
    
    // Parâmetros com valores padrão
    const instances = props.instances || 3;
    const backupRetention = props.backupRetention || cdk.Duration.days(14);
    const monitoringInterval = props.monitoringInterval || cdk.Duration.seconds(60);
    const deletionProtection = props.deletionProtection !== undefined ? props.deletionProtection : true;
    
    // Grupo de segurança para o cluster
    this.securityGroup = new ec2.SecurityGroup(this, 'ClusterSecurityGroup', {
      vpc: props.vpc,
      description: `Security group for ${id} Aurora cluster`,
      allowAllOutbound: true,
    });
    
    // Credenciais de acesso ao banco
    this.secret = new secretsmanager.Secret(this, 'DatabaseCredentials', {
      secretName: `${id}-credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'admin' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        includeSpace: false,
      },
    });
    
    // Cluster Aurora
    this.cluster = new rds.DatabaseCluster(this, 'Database', {
      engine: rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_3_01_0,
      }),
      credentials: rds.Credentials.fromSecret(this.secret),
      instanceProps: {
        instanceType: props.instanceType,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        vpc: props.vpc,
        securityGroups: [this.securityGroup],
        enablePerformanceInsights: true,
        performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
        monitoringInterval,
      },
      instances,
      parameterGroup: props.parameterGroup,
      defaultDatabaseName: props.databaseName,
      backup: {
        retention: backupRetention,
        preferredWindow: '03:00-04:00',
      },
      storageEncrypted: true,
      deletionProtection,
      cloudwatchLogsExports: ['error', 'general', 'slowquery', 'audit'],
      cloudwatchLogsRetention: cdk.aws_logs.RetentionDays.ONE_MONTH,
      monitoringRole: true,
    });
    
    // Tags para identificação de recursos
    cdk.Tags.of(this).add('Component', 'Database');
    cdk.Tags.of(this).add('Environment', 'Production');
  }
  
  // Método para permitir acesso de outros recursos
  public allowAccessFrom(peer: ec2.IPeer, port: ec2.Port = ec2.Port.tcp(3306)): void {
    this.securityGroup.addIngressRule(peer, port, 'Allow database access');
  }
  
  // Método para facilitar a criação de réplicas de leitura em outras regiões
  public addReadReplica(scope: Construct, id: string, region: string): rds.CfnDBInstance {
    const cfnCluster = this.cluster.node.defaultChild as rds.CfnDBCluster;
    
    // Réplica em outra região
    const readReplica = new rds.CfnDBInstance(scope, id, {
      dbInstanceIdentifier: `${this.cluster.clusterIdentifier}-replica-${region}`,
      dbInstanceClass: 'db.r5.large',
      engine: 'aurora-mysql',
      availabilityZone: `${region}a`,
      sourceRegion: cdk.Stack.of(this).region,
      sourceDBInstanceIdentifier: cfnCluster.attrEndpointAddress,
    });
    
    return readReplica;
  }
}