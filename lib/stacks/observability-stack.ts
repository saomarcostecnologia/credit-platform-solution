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
import { DatabaseCluster } from '../constructs/database-cluster';

export interface ObservabilityStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  auroraCluster: DatabaseCluster;
  hotDataTable: dynamodb.Table;
  keyspacesTableName?: string;
  alertEmails?: string[];
}

export class ObservabilityStack extends cdk.Stack {
  public readonly alertTopic: sns.Topic;
  public readonly dashboards: { [key: string]: cloudwatch.Dashboard } = {};
  
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);
    
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
    
    // Widgets de throughput de consulta
    const queryThroughputWidget = new cloudwatch.GraphWidget({
      title: 'Query Throughput',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/RDS',
          metricName: 'Queries',
          dimensionsMap: {
            DBClusterIdentifier: auroraCluster.cluster.clusterIdentifier,
          },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
        }),
      ],
      width: 12,
      height: 6,
    });
    
    // Widgets de capacidade de armazenamento
    const storageWidget = new cloudwatch.GraphWidget({
      title: 'Storage',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/RDS',
          metricName: 'FreeableMemory',
          dimensionsMap: {
            DBClusterIdentifier: auroraCluster.cluster.clusterIdentifier,
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(5),
          label: 'Freeable Memory'
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/RDS',
          metricName: 'FreeLocalStorage',
          dimensionsMap: {
            DBClusterIdentifier: auroraCluster.cluster.clusterIdentifier,
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(5),
          label: 'Free Local Storage'
        })
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
      query: `
        fields @timestamp, @message
        | filter @message like /Query_time/
        | sort @timestamp desc
        | limit 20
      `,
    });
    
    // Adicionar widgets ao dashboard
    dashboard.addWidgets(
      cpuWidget, connectionsWidget,
      queryLatencyWidget, queryThroughputWidget,
      storageWidget, slowQueriesWidget
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
    
    // Widget de latência
    const latencyWidget = new cloudwatch.GraphWidget({
      title: 'DynamoDB Latency',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'SuccessfulRequestLatency',
          dimensionsMap: {
            TableName: table.tableName,
            Operation: 'GetItem'
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
          label: 'GetItem'
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'SuccessfulRequestLatency',
          dimensionsMap: {
            TableName: table.tableName,
            Operation: 'Query'
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
          label: 'Query'
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'SuccessfulRequestLatency',
          dimensionsMap: {
            TableName: table.tableName,
            Operation: 'PutItem'
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
          label: 'PutItem'
        }),
      ],
      width: 12,
      height: 6,
    });
    
    // Widget de operações
    const operationsWidget = new cloudwatch.GraphWidget({
      title: 'DynamoDB Operations',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'ReturnedItemCount',
          dimensionsMap: {
            TableName: table.tableName,
            Operation: 'Scan'
          },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'Scan Items'
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'ReturnedItemCount',
          dimensionsMap: {
            TableName: table.tableName,
            Operation: 'Query'
          },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'Query Items'
        }),
      ],
      width: 12,
      height: 6,
    });
    
    // Widget de throttling
    const throttlingWidget = new cloudwatch.GraphWidget({
      title: 'DynamoDB Throttling',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'ReadThrottleEvents',
          dimensionsMap: {
            TableName: table.tableName,
          },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'Read Throttle'
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'WriteThrottleEvents',
          dimensionsMap: {
            TableName: table.tableName,
          },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'Write Throttle'
        }),
      ],
      width: 12,
      height: 6,
    });
    
    // Adicionar widgets ao dashboard
    dashboard.addWidgets(
      consumptionWidget, latencyWidget,
      operationsWidget, throttlingWidget
    );
    
    this.dashboards['DynamoDB'] = dashboard;
  }
  
  // Dashboard do Keyspaces
  private createKeyspacesDashboard(tableName: string) {
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
          metricName: 'ProvisionedWriteCapacityUnits',
          dimensionsMap: {
            TableName: tableName,
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
          label: 'Provisioned Write'
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
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/Cassandra',
          metricName: 'ConsumedWriteCapacityUnits',
          dimensionsMap: {
            TableName: tableName,
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
          label: 'Consumed Write'
        }),
      ],
      width: 12,
      height: 6,
    });
    
    // Widget de throttling
    const throttlingWidget = new cloudwatch.GraphWidget({
      title: 'Keyspaces Throttling',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/Cassandra',
          metricName: 'ThrottledRequests',
          dimensionsMap: {
            TableName: tableName,
          },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'Throttled Requests'
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/Cassandra',
          metricName: 'ReadThrottleEvents',
          dimensionsMap: {
            TableName: tableName,
          },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'Read Throttling'
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/Cassandra',
          metricName: 'WriteThrottleEvents',
          dimensionsMap: {
            TableName: tableName,
          },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'Write Throttling'
        }),
      ],
      width: 12,
      height: 6,
    });
    
    // Widget de latência
    const latencyWidget = new cloudwatch.GraphWidget({
      title: 'Keyspaces Latency',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/Cassandra',
          metricName: 'SuccessfulRequestLatency',
          dimensionsMap: {
            TableName: tableName,
            Operation: 'GetItem'
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
          label: 'Get Latency'
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/Cassandra',
          metricName: 'SuccessfulRequestLatency',
          dimensionsMap: {
            TableName: tableName,
            Operation: 'PutItem'
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
          label: 'Put Latency'
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/Cassandra',
          metricName: 'SuccessfulRequestLatency',
          dimensionsMap: {
            TableName: tableName,
            Operation: 'Query'
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
          label: 'Query Latency'
        }),
      ],
      width: 12,
      height: 6,
    });
    
    // Widget de erros
    const errorsWidget = new cloudwatch.GraphWidget({
      title: 'Keyspaces Errors',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/Cassandra',
          metricName: 'SystemErrors',
          dimensionsMap: {
            TableName: tableName,
          },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'System Errors'
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/Cassandra',
          metricName: 'UserErrors',
          dimensionsMap: {
            TableName: tableName,
          },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'User Errors'
        }),
      ],
      width: 12,
      height: 6,
    });
    
    // Adicionar widgets ao dashboard
    dashboard.addWidgets(
      capacityWidget, throttlingWidget,
      latencyWidget, errorsWidget
    );
    
    this.dashboards['Keyspaces'] = dashboard;
  }
  
  // Dashboard do sistema de ingestão
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
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/Kinesis',
          metricName: 'GetRecords.IteratorAgeMilliseconds',
          dimensionsMap: {
            StreamName: 'credit-platform-data-stream',
          },
          statistic: 'Maximum',
          period: cdk.Duration.minutes(1),
          label: 'Iterator Age'
        }),
      ],
      width: 12,
      height: 6,
    });
    
    // Widget de processamento de Lambda
    const lambdaWidget = new cloudwatch.GraphWidget({
      title: 'Lambda Processors',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Invocations',
          dimensionsMap: {
            FunctionName: 'DataProcessorFunction',
          },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'Invocations'
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Errors',
          dimensionsMap: {
            FunctionName: 'DataProcessorFunction',
          },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
          label: 'Errors'
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Duration',
          dimensionsMap: {
            FunctionName: 'DataProcessorFunction',
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
          label: 'Duration (avg)'
        }),
      ],
      width: 12,
      height: 6,
    });
    
    // Widget para métricas personalizadas de ingestão
    const ingestSuccessWidget = new cloudwatch.GraphWidget({
      title: 'Ingestion Success Rate',
      left: [
        new cloudwatch.Metric({
          namespace: 'CreditPlatform/DataProcessor',
          metricName: 'RecordsProcessed',
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
          label: 'Records Processed'
        }),
        new cloudwatch.Metric({
          namespace: 'CreditPlatform/DataProcessor',
          metricName: 'RecordsWithErrors',
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
          label: 'Records With Errors'
        }),
      ],
      width: 12,
      height: 6,
    });
    
    // Widget para tempo de processamento
    const processingTimeWidget = new cloudwatch.GraphWidget({
      title: 'Data Processing Time',
      left: [
        new cloudwatch.Metric({
          namespace: 'CreditPlatform/DataProcessor',
          metricName: 'ProcessingTime',
          statistic: 'Average',
          period: cdk.Duration.minutes(5),
          label: 'Avg Processing Time (ms)'
        }),
        new cloudwatch.Metric({
          namespace: 'CreditPlatform/DataProcessor',
          metricName: 'ProcessingTime',
          statistic: 'p90',
          period: cdk.Duration.minutes(5),
          label: 'p90 Processing Time (ms)'
        }),
      ],
      width: 12,
      height: 6,
    });
    
    // Adicionar widgets ao dashboard
    dashboard.addWidgets(
      kinesisWidget, lambdaWidget,
      ingestSuccessWidget, processingTimeWidget
    );
    
    this.dashboards['Ingestion'] = dashboard;
  }
  
  // Dashboard da aplicação
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
        }),
        new cloudwatch.Metric({
          namespace: 'CreditPlatform/Business',
          metricName: 'ApprovedCredit',
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
          label: 'Approved Credit'
        }),
        new cloudwatch.Metric({
          namespace: 'CreditPlatform/Business',
          metricName: 'RejectedCredit',
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
          label: 'Rejected Credit'
        }),
      ],
      width: 12,
      height: 6,
    });
    
    // Widget para SLAs
    const slaWidget = new cloudwatch.GraphWidget({
      title: 'Service Level Indicators',
      left: [
        new cloudwatch.Metric({
          namespace: 'CreditPlatform/SLI',
          metricName: 'APILatency',
          statistic: 'p99',
          period: cdk.Duration.minutes(5),
          label: 'API Latency p99'
        }),
        new cloudwatch.Metric({
          namespace: 'CreditPlatform/SLI',
          metricName: 'DecisionTime',
          statistic: 'p99',
          period: cdk.Duration.minutes(5),
          label: 'Decision Time p99'
        }),
      ],
      width: 12,
      height: 6,
    });
    
    // Widget para erros de aplicação
    const applicationErrorsWidget = new cloudwatch.GraphWidget({
      title: 'Application Errors',
      left: [
        new cloudwatch.Metric({
          namespace: 'CreditPlatform/Errors',
          metricName: 'APIErrors',
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
          label: 'API Errors'
        }),
        new cloudwatch.Metric({
          namespace: 'CreditPlatform/Errors',
          metricName: 'DecisionEngineErrors',
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
          label: 'Decision Engine Errors'
        }),
        new cloudwatch.Metric({
          namespace: 'CreditPlatform/Errors',
          metricName: 'DataConsistencyErrors',
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
          label: 'Data Consistency Errors'
        }),
      ],
      width: 12,
      height: 6,
    });
    
    // Widget para integridade geral do sistema
    const systemHealthWidget = new cloudwatch.GraphWidget({
      title: 'System Health',
      left: [
        new cloudwatch.Metric({
          namespace: 'CreditPlatform/Health',
          metricName: 'HealthCheckSuccess',
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
          label: 'Health Check Success Rate'
        }),
        new cloudwatch.Metric({
          namespace: 'CreditPlatform/Health',
          metricName: 'ComponentAvailability',
          dimensionsMap: {
            Component: 'Database'
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
          label: 'Database Availability'
        }),
        new cloudwatch.Metric({
          namespace: 'CreditPlatform/Health',
          metricName: 'ComponentAvailability',
          dimensionsMap: {
            Component: 'API'
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
          label: 'API Availability'
        }),
      ],
      width: 12,
      height: 6,
    });
    
    // Adicionar widgets ao dashboard
    dashboard.addWidgets(
      businessMetricsWidget, slaWidget,
      applicationErrorsWidget, systemHealthWidget
    );
    
    this.dashboards['Application'] = dashboard;
  }
  
  // Criar alarmes críticos
  private createCriticalAlarms(props: ObservabilityStackProps) {
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
    
    // Alarme para falhas de ingestão
    const ingestErrorAlarm = new cloudwatch.Alarm(this, 'IngestErrorAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'CreditPlatform/DataProcessor',
        metricName: 'RecordsWithErrors',
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      evaluationPeriods: 3,
      threshold: 10,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarme para erros de ingestão de dados',
      actionsEnabled: true,
    });
    
    // Alarme para idade do iterador do Kinesis (atraso no processamento)
    const kinesisLagAlarm = new cloudwatch.Alarm(this, 'KinesisLagAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Kinesis',
        metricName: 'GetRecords.IteratorAgeMilliseconds',
        dimensionsMap: {
          StreamName: 'credit-platform-data-stream',
        },
        statistic: 'Maximum',
        period: cdk.Duration.minutes(5),
      }),
      evaluationPeriods: 3,
      threshold: 30000, // 30 segundos
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarme para atraso no processamento do Kinesis',
      actionsEnabled: true,
    });
    
    // Adicionar ações para os alarmes
    [
      auroraCpuAlarm,
      dynamoThrottlingAlarm,
      keyspacesThrottlingAlarm,
      ingestErrorAlarm,
      kinesisLagAlarm
    ].forEach(alarm => {
      alarm.addAlarmAction(new cloudwatch.SnsAction(this.alertTopic));
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
    
    // Log group para motor de decisão
    new logs.LogGroup(this, 'DecisionEngineLogs', {
      logGroupName: '/credit-platform/decision-engine',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    
    // Log group para auditoria
    new logs.LogGroup(this, 'AuditLogs', {
      logGroupName: '/credit-platform/audit',
      retention: logs.RetentionDays.SIX_MONTHS,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
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
  
  // Configurar monitoramento avançado com Prometheus/Grafana
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
    
    // Task Definition para Prometheus
    const prometheusTaskDef = new ecs.FargateTaskDefinition(this, 'PrometheusTaskDefinition', {
      memoryLimitMiB: 2048,
      cpu: 1024,
      executionRole,
    });
    
    // Adicionar container do Prometheus
    prometheusTaskDef.addContainer('PrometheusContainer', {
      image: ecs.ContainerImage.fromRegistry('prom/prometheus:v2.37.0'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'prometheus',
        logGroup: new logs.LogGroup(this, 'PrometheusLogs', {
          logGroupName: '/credit-platform/monitoring/prometheus',
          retention: logs.RetentionDays.ONE_MONTH,
        }),
      }),
      portMappings: [
        {
          containerPort: 9090,
          hostPort: 9090,
        },
      ],
      healthCheck: {
        command: ['CMD-SHELL', 'wget -qO- http://localhost:9090/-/healthy || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
      },
    });
    
    // Task Definition para Grafana
    const grafanaTaskDef = new ecs.FargateTaskDefinition(this, 'GrafanaTaskDefinition', {
      memoryLimitMiB: 2048,
      cpu: 1024,
      executionRole,
    });
    
    // Adicionar container do Grafana
    grafanaTaskDef.addContainer('GrafanaContainer', {
      image: ecs.ContainerImage.fromRegistry('grafana/grafana:9.0.0'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'grafana',
        logGroup: new logs.LogGroup(this, 'GrafanaLogs', {
          logGroupName: '/credit-platform/monitoring/grafana',
          retention: logs.RetentionDays.ONE_MONTH,
        }),
      }),
      portMappings: [
        {
          containerPort: 3000,
          hostPort: 3000,
        },
      ],
      healthCheck: {
        command: ['CMD-SHELL', 'wget -qO- http://localhost:3000/api/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
      },
    });
    
    // Serviços ECS para Prometheus e Grafana seriam criados aqui
    // Omitido por brevidade, é necessario avaliar junto a area de negocio a necessidade da aplicação.
  }
}