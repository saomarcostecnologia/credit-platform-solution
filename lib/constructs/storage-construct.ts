import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as kms from 'aws-cdk-lib/aws-kms';
import { DatabaseCluster } from '../constructs/database-cluster';

export interface StorageConstructProps {
  vpc: ec2.IVpc;
  dataEncryptionKey: kms.IKey;
}

export class StorageConstruct extends Construct {
  public readonly auroraCluster: DatabaseCluster;
  public readonly redisCluster: elasticache.CfnReplicationGroup;
  public readonly hotDataTable: dynamodb.Table;
  
  constructor(scope: Construct, id: string, props: StorageConstructProps) {
    super(scope, id);
    
    // Parâmetros otimizados para o Aurora
    const auroraParams = new rds.ParameterGroup(this, 'AuroraParams', {
      engine: rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_3_01_0,
      }),
      parameters: {
        'innodb_buffer_pool_size': '12G',
        'innodb_read_io_threads': '16',
        'innodb_write_io_threads': '16',
        'max_connections': '2000',
        'innodb_flush_log_at_trx_commit': '2', // Melhor performance com durabilidade aceitável
        'innodb_flush_method': 'O_DIRECT',
        'query_cache_type': '0', // Desabilitar cache de queries (obsoleto)
        'query_cache_size': '0',
        'innodb_file_per_table': '1',
        'innodb_io_capacity': '2000',
        'innodb_io_capacity_max': '4000',
        'innodb_log_file_size': '1G',
        'innodb_log_files_in_group': '4',
        'innodb_log_buffer_size': '64M',
        'innodb_buffer_pool_instances': '16',
        'innodb_thread_concurrency': '0', // Deixar o MySQL gerenciar
        'join_buffer_size': '1M',
        'sort_buffer_size': '4M',
        'read_buffer_size': '256K',
        'read_rnd_buffer_size': '512K',
        'max_heap_table_size': '64M',
        'tmp_table_size': '64M',
        'table_open_cache': '4000',
        'table_definition_cache': '2048',
        'binlog_format': 'ROW',
        'binlog_cache_size': '2M',
        'binlog_stmt_cache_size': '1M',
        'binlog_row_image': 'minimal',
        'sync_binlog': '1',
        'log_bin_trust_function_creators': '1',
        'log_output': 'FILE',
        'slow_query_log': '1',
        'long_query_time': '1',
        'log_queries_not_using_indexes': '0',
        'log_throttle_queries_not_using_indexes': '60',
        'min_examined_row_limit': '100',
        'log_slow_admin_statements': '1',
        'performance_schema': '1',
      },
    });
    
    // Cluster Aurora MySQL
    this.auroraCluster = new DatabaseCluster(this, 'AuroraCluster', {
      vpc: props.vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.R5, ec2.InstanceSize.LARGE),
      instances: 3, // 1 escritor, 2 leitores
      backupRetention: cdk.Duration.days(14),
      databaseName: 'creditplatform',
      monitoringInterval: cdk.Duration.seconds(60),
      deletionProtection: true,
      parameterGroup: auroraParams,
    });
    
    // Grupo de sub-redes para o Redis
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for Redis',
      subnetIds: props.vpc.privateSubnets.map(subnet => subnet.subnetId),
    });
    
    // Grupo de segurança para o Redis
    const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for Redis cluster',
      allowAllOutbound: true,
    });
    
    // ElastiCache Redis para cache
    this.redisCluster = new elasticache.CfnReplicationGroup(this, 'RedisCacheCluster', {
      replicationGroupId: 'credit-platform-cache',
      replicationGroupDescription: 'Cache for credit platform',
      cacheNodeType: 'cache.r5.large',
      engine: 'redis',
      numNodeGroups: 2,
      replicasPerNodeGroup: 1,
      automaticFailoverEnabled: true,
      multiAzEnabled: true,
      cacheSubnetGroupName: redisSubnetGroup.ref,
      securityGroupIds: [redisSecurityGroup.securityGroupId],
      transitEncryptionEnabled: true,
      atRestEncryptionEnabled: true,
      
      // Parâmetros otimizados para Redis
      cacheParameterGroupName: new elasticache.CfnParameterGroup(this, 'RedisParams', {
        cacheParameterGroupFamily: 'redis6.x',
        description: 'Optimized parameters for Credit Platform Redis',
        properties: {
          'maxmemory-policy': 'volatile-lru',
          'activedefrag': 'yes',
          'maxmemory-samples': '10',
          'tcp-keepalive': '300',
          'lazyfree-lazy-eviction': 'yes',
          'lazyfree-lazy-expire': 'yes',
          'lazyfree-lazy-server-del': 'yes',
        },
      }).ref,
    });
    
    // DynamoDB para dados quentes - criação básica da tabela
    this.hotDataTable = new dynamodb.Table(this, 'HotDataTable', {
      tableName: 'credit-hot-data',
      partitionKey: { name: 'customerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'dataType', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.dataEncryptionKey,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'expiration',
    });
    
    // Configurar replicação cross-region usando CloudFormation baixo nível
    const cfnTable = this.hotDataTable.node.defaultChild as dynamodb.CfnTable;
    if (cfnTable) { // Verificação de segurança
      // Use a propriedade correta para replicação na versão atual do CDK
      cfnTable.addPropertyOverride('ReplicationSpecification', {
        Region: ['us-west-2']
      });
    }
    
    // Adicionar índices secundários globais após a criação da tabela
    this.hotDataTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'dataType', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'lastUpdated', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    
    this.hotDataTable.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.INCLUDE,
      nonKeyAttributes: ['customerId', 'amount', 'decision'],
    });
    
    // Permitir acesso ao Aurora a partir dos Lambda
    this.auroraCluster.allowAccessFrom(ec2.Peer.ipv4(props.vpc.vpcCidrBlock));
    
    // Permitir acesso ao Redis a partir da VPC
    redisSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(6379),
      'Allow Redis access from within VPC'
    );
  }
}