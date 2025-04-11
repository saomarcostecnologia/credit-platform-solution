import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cloudwatchactions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { DatabaseCluster } from '../constructs/database-cluster';

export interface ObservabilityConstructProps {
  vpc: ec2.IVpc;
  auroraCluster: DatabaseCluster;
  hotDataTable: dynamodb.Table;
  keyspacesTableName?: string;
  alertEmails?: string[];
}

export class ObservabilityConstruct extends Construct {
  public readonly alertTopic: sns.Topic;
  public readonly dashboards: { [key: string]: cloudwatch.Dashboard } = {};
  
  constructor(scope: Construct, id: string, props: ObservabilityConstructProps) {
    super(scope, id);
    
    // Definir emails para alertas (default se não fornecido)
    const alertEmails = props.alertEmails || ['alerts@example.com'];
    
    // Tópico SNS para alertas
    this.alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: 'credit-platform-alerts',
      displayName: 'Credit Platform Alerts',
    });
    
    // Adicionar assinaturas de email para o tópico de alertas
    alertEmails.forEach((email, index) => {
      this.alertTopic.addSubscription(
        new subscriptions.EmailSubscription(email, {
          filterPolicy: {
            severity: sns.SubscriptionFilter.stringFilter({
              allowlist: ['CRITICAL', 'HIGH']
            })
          }
        })
      );
    });
    
    // Criar dashboards para diferentes componentes
    this.createAuroraDashboard(props.auroraCluster);
    this.createDynamoDBDashboard(props.hotDataTable);
    this.createKeyspacesDashboard(props.keyspacesTableName || 'credit-data');
    this.createIngestionDashboard();
    this.createApplicationDashboard();
    
    // Criar alarmes críticos
    this.createCriticalAlarms(props);
    
    // Configurar Log Groups centralizados com retenção adequada
    this.setupCentralizedLogging();
    
    // Configurar serviços de monitoramento avançado (Prometheus/Grafana)
    this.setupAdvancedMonitoring(props.vpc);
  }
  
  // Dashboard do Aurora MySQL
  private createAuroraDashboard(auroraCluster: DatabaseCluster) {
    const dashboard = new cloudwatch.Dashboard(this, 'AuroraDashboard', {
      dashboardName: 'CreditPlatform-Aurora-Dashboard',
    });
    
    // Widgets de CPU
    const cpuWidget = new cloudwatch.GraphWidget({
      title: 'CPU Utilization',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/RDS',
          metricName: 'CPUUtilization',
          dimensionsMap: {
            DBClusterIdentifier: auroraCluster.cluster.clusterIdentifier,
            Role: 'WRITER'
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
          label: 'Writer Node'
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/RDS',
          metricName: 'CPUUtilization',
          dimensionsMap: {
            DBClusterIdentifier: auroraCluster.cluster.clusterIdentifier,
            Role: 'READER'
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
          label: 'Reader Nodes (Average)'
        })
      ],
      width: 12,
      height: 6,
    });
    
    // Widgets de conexões de banco de dados
    const connectionsWidget = new cloudwatch.GraphWidget({
      title: 'Database Connections',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/RDS',
          metricName: 'DatabaseConnections',
          dimensionsMap: {
            DBClusterIdentifier: auroraCluster.cluster.clusterIdentifier,
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
        }),
      ],
      width: 12,
      height: 6,
    });
    
    // Widgets de latência de consulta
    const queryLatencyWidget = new cloudwatch.GraphWidget({
      title: 'Query Latency',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/RDS',
          metricName: 'SelectLatency',
          dimensionsMap: {
            DBClusterIdentifier: auroraCluster.cluster.clusterIdentifier,
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
          label: 'SELECT'
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/RDS',
          metricName: 'InsertLatency',
          dimensionsMap: {
            DBClusterIdentifier: auroraCluster.cluster.clusterIdentifier,
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
          label: 'INSERT'
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/RDS',
          metricName: 'UpdateLatency',
          dimensionsMap: {
            DBClusterIdentifier: auroraCluster.cluster.clusterIdentifier,
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
          label: 'UPDATE'
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/RDS',
          metricName: 'DeleteLatency',
          dimensionsMap: {
            DBClusterIdentifier: auroraCluster.cluster.clusterIdentifier,
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
          label: 'DELETE'
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/RDS',
          metricName: 'CommitLatency',
          dimensionsMap: {
            DBClusterIdentifier: auroraCluster.cluster.clusterIdentifier,
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
          label: 'COMMIT'
        }),
      ],
      width: 12,
      height: 6,
    });
    
    // Widget para consultas lentas
    const slowQueriesWidget = new cloudwatch.LogQueryWidget({
      title: 'Slow Queries (Last Hour)',
      logGroupNames: [`/aws/rds/cluster/${auroraCluster.cluster.clusterIdentifier}/slowquery`],
      view: cloudwatch.LogQueryVisualizationType.TABLE,
      width: 24,
      height: 6,
      queryString: `
        fields @timestamp, @message
        | filter @message like /Query_time/
        | sort @timestamp desc
        | limit 20
      `,
    });
    
    // Adicionar widgets ao dashboard
    dashboard.addWidgets(
      cpuWidget, connectionsWidget,
      queryLatencyWidget, slowQueriesWidget
    );
    
    this.dashboards['Aurora'] = dashboard;
  }
  
  // Dashboard do DynamoDB
  private createDynamoDBDashboard(table: dynamodb.Table) {
    const dashboard = new cloudwatch.Dashboard(this, 'DynamoDBDashboard', {
      dashboardName: 'CreditPlatform-DynamoDB-Dashboard',
    });
    
    // Widget de consumo de capacidade
    const consumptionWidget = new cloudwatch.GraphWidget({
      title: 'Capacity Consumption',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'ConsumedReadCapacityUnits',
          dimensionsMap: {
            TableName: table.tableName,
          },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'Read Capacity'
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'ConsumedWriteCapacityUnits',
          dimensionsMap: {
            TableName: table.tableName,
          },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'Write Capacity'
        }),
      ],
      width: 12,
      height: 6,
    });
    
    // Adicionar widgets ao dashboard
    dashboard.addWidgets(
      consumptionWidget
    );
    
    this.dashboards['DynamoDB'] = dashboard;
  }
  
  // Método para criar o dashboard do Keyspaces
  private createKeyspacesDashboard(tableName: string) {
    // implementação conforme o código original
    const dashboard = new cloudwatch.Dashboard(this, 'KeyspacesDashboard', {
      dashboardName: 'CreditPlatform-Keyspaces-Dashboard',
    });
    
    // Widget de consumo de capacidade
    const capacityWidget = new cloudwatch.GraphWidget({
      title: 'Keyspaces Capacity',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/Cassandra',
          metricName: 'ProvisionedReadCapacityUnits',
          dimensionsMap: {
            TableName: tableName,
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
          label: 'Provisioned Read'
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/Cassandra',
          metricName: 'ConsumedReadCapacityUnits',
          dimensionsMap: {
            TableName: tableName,
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
          label: 'Consumed Read'
        })
      ],
      width: 12,
      height: 6,
    });
    
    dashboard.addWidgets(capacityWidget);
    this.dashboards['Keyspaces'] = dashboard;
  }
  
  // Método para criar o dashboard de ingestão
  private createIngestionDashboard() {
    const dashboard = new cloudwatch.Dashboard(this, 'IngestionDashboard', {
      dashboardName: 'CreditPlatform-Ingestion-Dashboard',
    });
    
    // Widget de métricas do Kinesis
    const kinesisWidget = new cloudwatch.GraphWidget({
      title: 'Kinesis Data Streams',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/Kinesis',
          metricName: 'IncomingRecords',
          dimensionsMap: {
            StreamName: 'credit-platform-data-stream',
          },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'Incoming Records'
        })
      ],
      width: 12,
      height: 6,
    });
    
    dashboard.addWidgets(kinesisWidget);
    this.dashboards['Ingestion'] = dashboard;
  }
  
  // Método para criar o dashboard da aplicação
  private createApplicationDashboard() {
    const dashboard = new cloudwatch.Dashboard(this, 'ApplicationDashboard', {
      dashboardName: 'CreditPlatform-Application-Dashboard',
    });
    
    // Widget para métricas de negócio
    const businessMetricsWidget = new cloudwatch.GraphWidget({
      title: 'Business Metrics',
      left: [
        new cloudwatch.Metric({
          namespace: 'CreditPlatform/Business',
          metricName: 'CreditDecisions',
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
          label: 'Credit Decisions'
        })
      ],
      width: 12,
      height: 6,
    });
    
    dashboard.addWidgets(businessMetricsWidget);
    this.dashboards['Application'] = dashboard;
  }
  
  // Método para criar alarmes críticos
  private createCriticalAlarms(props: ObservabilityConstructProps) {
    // Alarme para alta utilização de CPU do Aurora (Escritor)
    const auroraCpuAlarm = new cloudwatch.Alarm(this, 'AuroraCPUAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/RDS',
        metricName: 'CPUUtilization',
        dimensionsMap: {
          DBClusterIdentifier: props.auroraCluster.cluster.clusterIdentifier,
          Role: 'WRITER'
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(1),
      }),
      evaluationPeriods: 5,
      threshold: 85,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarme para alta utilização de CPU no nó escritor do Aurora',
      actionsEnabled: true,
    });
    
    // Alarme para throttling no DynamoDB
    const dynamoThrottlingAlarm = new cloudwatch.Alarm(this, 'DynamoThrottlingAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/DynamoDB',
        metricName: 'ReadThrottleEvents',
        dimensionsMap: {
          TableName: props.hotDataTable.tableName,
        },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      evaluationPeriods: 3,
      threshold: 10,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarme para eventos de throttling no DynamoDB',
      actionsEnabled: true,
    });
    
    // Alarme para throttling no Keyspaces
    const keyspacesThrottlingAlarm = new cloudwatch.Alarm(this, 'KeyspacesThrottlingAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Cassandra',
        metricName: 'ThrottledRequests',
        dimensionsMap: {
          TableName: props.keyspacesTableName || 'credit-data',
        },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      evaluationPeriods: 3,
      threshold: 5,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarme para requisições throttled no Keyspaces',
      actionsEnabled: true,
    });
    
    // Adicionar ações para os alarmes
    [
      auroraCpuAlarm,
      dynamoThrottlingAlarm,
      keyspacesThrottlingAlarm
    ].forEach(alarm => {
      alarm.addAlarmAction(new cloudwatchactions.SnsAction(this.alertTopic));
    });
  }
  
  // Configurar log groups centralizados
  private setupCentralizedLogging() {
    // Log group para aplicação
    new logs.LogGroup(this, 'ApplicationLogs', {
      logGroupName: '/credit-platform/application',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    
    // Log group para ingestão
    new logs.LogGroup(this, 'IngestionLogs', {
      logGroupName: '/credit-platform/ingestion',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    
    // Filtro de métricas para erros nos logs de aplicação
    new logs.MetricFilter(this, 'ApplicationErrorMetric', {
      logGroup: logs.LogGroup.fromLogGroupName(this, 'AppLogGroup', '/credit-platform/application'),
      filterPattern: logs.FilterPattern.stringValue('$.level', '=', 'ERROR'),
      metricNamespace: 'CreditPlatform/Logs',
      metricName: 'ApplicationErrors',
      defaultValue: 0,
      metricValue: '1',
    });
  }
  
  // Configurar monitoramento avançado
  private setupAdvancedMonitoring(vpc: ec2.IVpc) {
    // Cluster ECS para ferramentas de monitoramento
    const monitoringCluster = new ecs.Cluster(this, 'MonitoringCluster', {
      vpc,
      containerInsights: true,
      clusterName: 'credit-platform-monitoring',
    });
    
    // Role para o ECS
    const executionRole = new iam.Role(this, 'MonitoringExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });
    
    // Aqui você poderia adicionar mais configurações para Prometheus e Grafana
    // Omitido para simplificar
  }
}