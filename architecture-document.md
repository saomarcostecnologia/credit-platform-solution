# Documento de Arquitetura Técnica
## Plataforma de Crédito PF - Solução para Desafios de Banco de Dados

**Versão:** 1.0  
**Data:** 08/04/2025  
**Autor:** Gabriel Luiz São Marcos

## Sumário

1. [Introdução](#1-introdução)
2. [Visão Geral da Arquitetura](#2-visão-geral-da-arquitetura)
3. [Componentes da Solução](#3-componentes-da-solução)
4. [Design de Dados](#4-design-de-dados)
5. [Estratégias de Segurança](#5-estratégias-de-segurança)
6. [Mecanismos de Resiliência](#6-mecanismos-de-resiliência)
7. [Observabilidade](#7-observabilidade)
8. [Fluxos de Dados](#8-fluxos-de-dados)
9. [Detalhes de Implementação](#9-detalhes-de-implementação)
10. [Manutenção e Operação](#10-manutenção-e-operação)
11. [Roadmap de Evolução](#11-roadmap-de-evolução)
12. [Glossário](#12-glossário)
13. [Apêndices](#13-apêndices)

## 1. Introdução

### 1.1 Propósito

Este documento descreve a arquitetura técnica da solução implementada para resolver os desafios críticos de banco de dados enfrentados pela plataforma de crédito PF. A solução foi projetada para abordar problemas de desempenho, escalabilidade, segurança, consistência de dados, recuperação de desastres e observabilidade.

### 1.2 Escopo

Este documento abrange todos os componentes da solução, suas interações, estratégias implementadas e decisões de design. É destinado a arquitetos, desenvolvedores, operadores de sistema e stakeholders técnicos.

### 1.3 Contexto do Problema

A plataforma de crédito está enfrentando vários desafios críticos devido ao crescimento rápido e aumento exponencial do volume de transações:

- Desempenho degradado com tempo de resposta elevado
- Problemas de escalabilidade com a infraestrutura atual
- Vulnerabilidades de segurança e tentativas de acesso não autorizado
- Inconsistências de dados devido a falhas em processos de atualização
- Plano inadequado de recuperação de desastres
- Falta de observabilidade para identificação e resolução de problemas

### 1.4 Restrições e Requisitos

- **Prazo de Implementação:** 3 dias
- **Custo:** Otimizado para baixo custo operacional
- **Escalabilidade:** Deve suportar crescimento contínuo
- **Segurança:** Proteção robusta para dados sensíveis de clientes
- **Resiliência:** Alto SLA com recuperação rápida de falhas
- **Tecnologias:** Baseadas em serviços AWS gerenciados

## 2. Visão Geral da Arquitetura

### 2.1 Diagrama de Arquitetura

A solução implementa uma arquitetura em camadas seguindo princípios de Clean Architecture, com componentes organizados nas seguintes camadas:

- **Camada de Ingestão:** Responsável pela captura e processamento inicial dos dados
- **Camada de Armazenamento:** Gerencia os diferentes repositórios de dados
- **Camada de Aplicação:** Contém a lógica de negócio e o motor de decisão
- **Camada de Segurança:** Implementa os controles de proteção dos dados
- **Camada de Observabilidade:** Fornece visibilidade sobre todo o sistema

O diagrama detalhado está disponível no [Apêndice A](#apêndice-a-diagrama-de-arquitetura-detalhado) deste documento.

### 2.2 Princípios de Design

A arquitetura foi projetada seguindo os seguintes princípios:

- **Separação de Responsabilidades:** Cada componente tem responsabilidades bem definidas
- **Acoplamento Fraco:** Componentes são independentes e se comunicam através de interfaces bem definidas
- **Alta Coesão:** Funcionalidades relacionadas são agrupadas
- **Design para Falha:** Todos os componentes são projetados para lidar com falhas graciosamente
- **Segurança por Design:** Segurança integrada em todos os níveis
- **Observabilidade Intrínseca:** Métricas, logs e rastreamentos em todos os componentes

### 2.3 Tecnologias Principais

- **Armazenamento de Dados:** Aurora MySQL, Amazon Keyspaces, DynamoDB, ElastiCache Redis
- **Processamento de Dados:** AWS Lambda, Kinesis Data Streams, Step Functions
- **Computação:** ECS/Fargate
- **Segurança:** KMS, IAM, VPC, WAF, GuardDuty
- **Observabilidade:** CloudWatch, X-Ray, Prometheus, Grafana
- **IaC:** AWS CDK (TypeScript)

## 3. Componentes da Solução

### 3.1 Camada de Ingestão

#### 3.1.1 Kinesis Data Stream

- **Propósito:** Captura em tempo real de todos os eventos e dados transacionais
- **Configuração:** 10 shards para alta throughput, retenção de 48 horas
- **Capacidade:** Processamento de até 10MB/s de ingestão
- **Resiliência:** Persistência de dados mesmo em caso de falha nos processadores

#### 3.1.2 Lambda Processors

- **Propósito:** Processamento dos registros do Kinesis e distribuição para storages
- **Configuração:** Auto-scaling, timeout de 5 minutos, 1GB de memória
- **Otimizações:** Processamento em batch, retry com backoff exponencial
- **Métricas Chave:** Taxa de processamento, erros, latência

### 3.2 Camada de Armazenamento

#### 3.2.1 Aurora MySQL Cluster

- **Propósito:** Armazenamento relacional primário para dados transacionais
- **Configuração:** 1 instância writer + 2 instâncias reader (r5.large), Multi-AZ
- **Otimizações:** Parâmetros de performance otimizados, índices adequados
- **Capacidade:** Suporta até 2000 conexões simultâneas

#### 3.2.2 Amazon Keyspaces

- **Propósito:** Armazenamento de alta velocidade para dados críticos
- **Configuração:** Auto-scaling de 100-10000 unidades, targetUtilization 50%
- **Otimizações:** Schema otimizado para consultas, particionamento eficiente
- **Mecanismos de Acesso:** Caching, batching, write-through

#### 3.2.3 DynamoDB

- **Propósito:** Cache persistente para dados quentes e lookup rápido
- **Configuração:** On-demand com replicação global para DR
- **Índices:** GSIs para padrões de acesso específicos
- **TTL:** Configurado para expiração automática de dados temporários

#### 3.2.4 ElastiCache Redis

- **Propósito:** Caching de consultas frequentes e dados temporários
- **Configuração:** Multi-AZ com replicação, 2 nós cache.r5.large
- **Estratégias:** Invalidação seletiva, TTL variável por tipo de dados
- **Políticas:** Volatile-LRU para gerenciamento de memória

### 3.3 Camada de Aplicação

#### 3.3.1 Motor de Decisão

- **Propósito:** Executa políticas de crédito e determina aprovações
- **Implementação:** Containers em Fargate para isolamento e escalabilidade
- **Escalabilidade:** Auto-scaling baseado em número de requisições
- **Otimizações:** Conexão eficiente com bancos de dados através de connection pooling

#### 3.3.2 API Gateway

- **Propósito:** Exposição de endpoints REST para aplicações clientes
- **Segurança:** Autenticação, autorização, throttling
- **Monitoramento:** Métricas detalhadas por endpoint
- **Caching:** Configurado para respostas frequentes

### 3.4 Camada de Segurança

#### 3.4.1 Criptografia

- **Em Repouso:** Todos os dados criptografados usando AWS KMS
- **Em Trânsito:** TLS para todas as comunicações
- **Chaves:** Rotação automática, acesso controlado

#### 3.4.2 Controle de Acesso

- **IAM:** Políticas baseadas em privilégio mínimo
- **Network:** VPC privada com acessos restritos
- **Aplicação:** Autenticação e autorização em nível de API

#### 3.4.3 Proteção de Perímetro

- **WAF:** Proteção contra ataques web comuns (SQL Injection, XSS)
- **Shield:** Proteção básica contra DDoS
- **Rate Limiting:** Controle de abuso de API

### 3.5 Camada de Observabilidade

#### 3.5.1 Métricas

- **CloudWatch:** Métricas padrão e customizadas para todos os serviços
- **Prometheus:** Métricas detalhadas para componentes de aplicação
- **Dashboards:** Visualizações específicas por componente e visão consolidada

#### 3.5.2 Logs

- **Armazenamento:** Centralizado no CloudWatch Logs
- **Retenção:** Configurável por tipo de log (1-6 meses)
- **Filtros:** Alertas baseados em padrões específicos nos logs

#### 3.5.3 Alarmes

- **Thresholds:** Baseados em análise histórica e SLOs
- **Ações:** Notificações via SNS, acionamento de remediation
- **Agregação:** Correlação de eventos para reduzir ruído

## 4. Design de Dados

### 4.1 Modelo de Dados

#### 4.1.1 Aurora MySQL

**Principais Tabelas:**
- `customers`: Dados dos clientes e histórico
- `transactions`: Transações de crédito
- `credit_policies`: Regras para aprovação de crédito
- `credit_decisions`: Resultados das decisões de crédito

**Índices Chave:**
- `idx_customer_cpf`: Otimiza busca por CPF
- `idx_transaction_date`: Otimiza consultas por período
- `idx_combined_customer_status`: Otimiza filtragem por status

#### 4.1.2 Keyspaces

**Tabela Principal:** `creditplatform.creditdata`

**Estrutura:**
```cql
CREATE TABLE creditplatform.creditdata (
  customer_id text,
  data_type text,
  transaction_id text,
  amount decimal,
  status text,
  credit_score int,
  monthly_income decimal,
  existing_debts decimal,
  created_at timestamp,
  updated_at timestamp,
  ttl timestamp,
  PRIMARY KEY (customer_id, data_type)
);
```

**Padrões de Acesso:**
- Busca por cliente: `customer_id = ? AND data_type = 'CUSTOMER_PROFILE'`
- Busca de transações: `customer_id = ? AND data_type LIKE 'TRANSACTION#%'`

#### 4.1.3 DynamoDB

**Tabela:** `credit-hot-data`

**Chaves:**
- Partition Key: `customerId`
- Sort Key: `dataType`

**GSIs:**
- GSI1: `dataType` (PK), `lastUpdated` (SK)
- GSI2: `status` (PK), `createdAt` (SK)

**Usos Principais:**
- Lookup rápido de dados de cliente
- Consultas para dashboard (transações recentes, status)
- Cache para políticas de crédito ativas

### 4.2 Estratégias de Cache

#### 4.2.1 Políticas de Cache

- **Time-to-Live (TTL):** 5 minutos para dados frequentemente acessados
- **Invalidação Explícita:** Após atualizações críticas
- **Write-Through:** Para dados de alta consistência
- **Lazy Loading:** Para dados acessados esporadicamente

#### 4.2.2 Dados Cacheados

- Perfis de clientes ativos
- Resultado de políticas de crédito
- Consultas frequentes de relatórios
- Referências de sistemas externos

### 4.3 Estratégias de Consistência

#### 4.3.1 Padrão Saga

Implementado para transações distribuídas que afetam múltiplos storages, com etapas de compensação para rollback em caso de falha.

#### 4.3.2 Verificação de Consistência

Processo automatizado que verifica periodicamente a consistência dos dados entre Aurora e DynamoDB/Keyspaces, com reconciliação automática.

## 5. Estratégias de Segurança

### 5.1 Modelo de Ameaças

A solução foi projetada considerando as seguintes ameaças principais:
- Acesso não autorizado aos dados de clientes
- Injeção SQL e outros ataques de aplicação
- Interceptação de dados em trânsito
- Elevação de privilégios internos
- Vazamento de dados sensíveis

### 5.2 Controles Implementados

#### 5.2.1 Defesa em Profundidade

Múltiplas camadas de proteção incluindo:
- Segurança de perímetro (WAF, Security Groups)
- Autenticação e autorização granular
- Criptografia fim-a-fim
- Logging e monitoramento contínuo

#### 5.2.2 Segurança de Dados

- **Classificação:** Dados categorizados por sensibilidade
- **Tratamento:** Controles específicos baseados na classificação
- **Mascaramento:** Ofuscação de dados sensíveis em logs e outputs não essenciais

#### 5.2.3 Auditoria

- Logging abrangente de todas as operações
- Rastreamento de acesso a dados sensíveis
- Registros imutáveis para investigação de incidentes

## 6. Mecanismos de Resiliência

### 6.1 Estratégia Multi-AZ

Todos os componentes críticos são distribuídos em múltiplas Zonas de Disponibilidade:
- Aurora MySQL: Configuração Multi-AZ nativa
- ElastiCache: Replicação cross-AZ
- Aplicação: Distribuição de containers entre AZs
- Balanceamento: Distribuição inteligente de carga

### 6.2 Estratégia Multi-Região

#### 6.2.1 Active-Passive

- Região primária: us-east-1
- Região secundária: us-west-2
- Mecanismo de failover: AWS Route 53 health checks

#### 6.2.2 Replicação de Dados

- DynamoDB: Global Tables para replicação automática
- Aurora: Backups cross-region com restauração automática
- S3: Replicação cross-region para artefatos críticos

### 6.3 Padrões de Resiliência

#### 6.3.1 Circuit Breaker

Implementado para prevenir cascatas de falhas em integrações com serviços externos.

#### 6.3.2 Bulkhead

Isolamento de recursos para prevenir que falhas em um componente afetem outros.

#### 6.3.3 Retry com Backoff Exponencial

Implementado em todas as operações de rede para lidar com falhas transitórias.

## 7. Observabilidade

### 7.1 Métricas SRE

#### 7.1.1 SLIs (Service Level Indicators)

- **Disponibilidade:** Percentual de tempo que o serviço está operacional
- **Latência:** Tempo de resposta para operações críticas
- **Taxa de Erro:** Percentual de requisições com erro
- **Saturação:** Utilização de recursos críticos
- **Throughput:** Volume de transações processadas

#### 7.1.2 SLOs (Service Level Objectives)

- Disponibilidade: 99.95% em janela rolante de 30 dias
- Latência p95: < 200ms para decisões de crédito
- Taxa de Erro: < 0.1% para transações financeiras
- Índice de Consistência de Dados: > 99.99%

### 7.2 Dashboards

#### 7.2.1 Visões Especializadas

- **Dashboard Executivo:** KPIs de alto nível, SLOs vs. realidade
- **Dashboard Operacional:** Métricas técnicas, status dos componentes
- **Dashboard de Desenvolvimento:** Detalhes de performance, logs, erros
- **Dashboard de Segurança:** Tentativas de acesso, vulnerabilidades, auditorias

#### 7.2.2 Estrutura dos Dashboards

Cada dashboard segue uma estrutura consistente:
- Visão geral do status (semáforo)
- Métricas chave e tendências
- Alertas ativos
- Detalhes por componente
- Links para recursos relacionados

### 7.3 Sistema de Alertas

#### 7.3.1 Filosofia de Alertas

- Alertas acionáveis (requerem intervenção humana)
- Baixo ruído (evitar fadiga de alertas)
- Priorização clara (severidade bem definida)
- Contexto suficiente para troubleshooting

#### 7.3.2 Níveis de Severidade

- **P1 (Crítico):** Impacto ao usuário, requer ação imediata
- **P2 (Alto):** Degradação potencial, requer ação em 30min
- **P3 (Médio):** Problema não-crítico, requer ação em 24h
- **P4 (Baixo):** Informativo, não requer ação imediata

## 8. Fluxos de Dados

### 8.1 Fluxo de Ingestão

1. Dados de diferentes fontes são capturados pelo Kinesis Data Stream
2. Processadores Lambda consomem os dados em near real-time
3. Os dados são validados, transformados e enriquecidos
4. Resultados são gravados nos storages apropriados (Aurora, Keyspaces, DynamoDB)
5. Metadados de processamento são registrados para observabilidade

### 8.2 Fluxo de Decisão de Crédito

1. Solicitação de crédito recebida via API Gateway
2. Motor de decisão busca dados do cliente (Redis → DynamoDB → Aurora/Keyspaces)
3. Políticas de crédito são aplicadas aos dados
4. Decisão é registrada nos bancos de dados
5. Resposta é retornada ao solicitante
6. Métricas de negócio e técnicas são atualizadas

### 8.3 Fluxo de Verificação de Consistência

1. Função Lambda periódica seleciona amostra de registros
2. Dados são verificados entre Aurora e NoSQL datastores
3. Inconsistências são registradas e categorizadas
4. Processo de reconciliação corrige inconsistências automaticamente
5. Alertas são gerados para padrões anômalos de inconsistência

## 9. Detalhes de Implementação

### 9.1 Implementação com Clean Architecture

A solução implementa os princípios de Clean Architecture com clara separação entre:

#### 9.1.1 Camadas da Arquitetura

- **Entities:** Modelos de domínio como `CreditData` e `Transaction`
- **Use Cases:** Lógica de negócio como `CreditApprovalUseCase`
- **Adapters:** Interfaces para serviços externos como `AuroraAdapter`
- **Frameworks:** Bibliotecas e serviços externos como AWS CDK, Kinesis

#### 9.1.2 Inversão de Dependência

As classes de domínio dependem apenas de abstrações (interfaces), não de implementações concretas.

Exemplo:
```typescript
// Use case depende apenas da interface, não da implementação
export class CreditApprovalUseCase {
  constructor(
    private readonly dataReader: IDataReader,
    private readonly monitoring: IMonitoring
  ) {}
  
  // Lógica de negócio...
}
```

### 9.2 Implementação SOLID

#### 9.2.1 Princípios Aplicados

- **S:** Cada classe tem uma única responsabilidade
- **O:** Classes extensíveis sem modificação
- **L:** Implementações de interfaces são substituíveis
- **I:** Interfaces específicas ao invés de genéricas
- **D:** Dependência de abstrações, não de implementações

#### 9.2.2 Exemplos de Implementação

```typescript
// Interface segregation (I) - Interfaces específicas
export interface IDataReader {
  readItem(id: string): Promise<any>;
  query(params: any): Promise<any[]>;
}

export interface IDataWriter {
  writeItem(item: any): Promise<void>;
  updateItem(id: string, item: any): Promise<void>;
  deleteItem(id: string): Promise<void>;
}

// Storage interface combina ambas (para implementadores que precisam de ambas)
export interface IDataStorage extends IDataReader, IDataWriter {
  getMetrics(): Promise<any>;
}
```

### 9.3 Infraestrutura como Código (IaC)

#### 9.3.1 AWS CDK

Toda a infraestrutura é definida como código usando AWS CDK em TypeScript.

Exemplo de implementação (simplificado):
```typescript
export class StorageStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);
    
    // Cluster Aurora MySQL otimizado
    this.auroraCluster = new DatabaseCluster(this, 'AuroraCluster', {
      vpc: props.vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.R5, ec2.InstanceSize.LARGE),
      instances: 3, // 1 escritor, 2 leitores
      // outras configurações...
    });
    
    // ElastiCache Redis para cache
    this.redisCluster = new elasticache.CfnReplicationGroup(this, 'RedisCacheCluster', {
      // configurações...
    });
    
    // Implementação de outros recursos...
  }
}
```

## 10. Manutenção e Operação

### 10.1 Procedimentos Operacionais

#### 10.1.1 Monitoramento Diário

- Verificação dos dashboards principais (9:00 e 16:00)
- Revisão de alertas gerados nas últimas 24h
- Análise de tendências de métricas chave
- Verificação de jobs de consistência e backups

#### 10.1.2 Manutenção Semanal

- Verificação de atualizações de segurança
- Revisão de performance de consultas
- Teste de procedimentos de DR (simulação)
- Análise de capacidade e planejamento

#### 10.1.3 Manutenção Mensal

- Revisão completa de segurança
- Análise de custos e otimização
- Teste de recuperação de backups
- Atualização de documentação operacional

### 10.2 Runbooks

#### 10.2.1 Incidentes de Performance

Passos para diagnóstico e mitigação de problemas de performance:
1. Identificar componente afetado através dos dashboards
2. Verificar métricas de recursos (CPU, memória, IO)
3. Analisar padrões de tráfego e consultas
4. Aplicar mitigações específicas ao componente
5. Monitorar recuperação e impacto

#### 10.2.2 Recuperação de Falhas

Procedimentos para diferentes cenários:
- Falha de instância Aurora
- Problema em zona de disponibilidade
- Falha de região
- Corrupção de dados
- Violação de segurança

#### 10.2.3 Scaling Procedures

Passos para escalar componentes:
- Aurora: Upgrade de instância ou aumento de réplicas
- DynamoDB/Keyspaces: Ajuste de capacidade provisionada
- ElastiCache: Aumento de nós ou upgrade de tipo
- Aplicação: Aumento de tarefas Fargate

## 11. Roadmap de Evolução

### 11.1 Melhorias de Curto Prazo (1-3 meses)

- Implementação de caching distribuído com DAX para DynamoDB
- Otimização avançada de consultas Keyspaces
- Implementação de streaming change data capture (CDC)
- Expansão de dashboards de observabilidade

### 11.2 Melhorias de Médio Prazo (3-6 meses)

- Migração para Aurora Serverless v2 para otimização de custos
- Implementação de machine learning para detecção de anomalias
- Expansão da arquitetura multi-região para active-active
- Implementação de data lake para analytics avançados

### 11.3 Visão de Longo Prazo (6-12 meses)

- Evolução para arquitetura de microserviços completa
- Implementação de edge computing para decisões localizadas
- Expansão internacional com replicação global
- Implementação de GraphQL para flexibilidade de API

## 12. Glossário

| Termo | Definição |
|-------|-----------|
| **AZ** | Availability Zone - Datacenter isolado dentro de uma região AWS |
| **CDK** | Cloud Development Kit - Framework para definir infraestrutura como código |
| **DR** | Disaster Recovery - Processos para recuperação após falha significativa |
| **GSI** | Global Secondary Index - Índice alternativo em DynamoDB |
| **IAM** | Identity and Access Management - Serviço de controle de acesso da AWS |
| **KMS** | Key Management Service - Serviço de gerenciamento de chaves criptográficas |
| **RCU/WCU** | Read/Write Capacity Units - Unidades de capacidade para Keyspaces/DynamoDB |
| **SLI** | Service Level Indicator - Métrica que mede aspecto de nível de serviço |
| **SLO** | Service Level Objective - Meta para um SLI |
| **VPC** | Virtual Private Cloud - Rede virtual isolada na AWS |
| **WAF** | Web Application Firewall - Proteção para aplicações web |

## 13. Apêndices

### Apêndice A: Diagrama de Arquitetura Detalhado

```
                                +------------------+
                                |   Aplicações     |
                                |    Clientes      |
                                +--------+---------+
                                         |
                                         v
+----------------------+       +-------------------+       +----------------------+
|    CloudFront CDN    | <---> |    API Gateway    | <---> |     WAF / Shield     |
+----------------------+       +---------+---------+       +----------------------+
                                         |
                                         v
                      +------------------------------------------+
                      |               VPC Privada                 |
                      |  +---------------+    +---------------+   |
                      |  |    Motor de   |    |  Serviços de  |   |
                      |  |    Decisão    |<-->|   Aplicação   |   |
                      |  | (ECS/Fargate) |    | (ECS/Fargate) |   |
                      |  +-------+-------+    +-------+-------+   |
                      |          |                    |           |
                      |          v                    v           |
                      |  +---------------+    +---------------+   |
                      |  | ElastiCache   |    |   Step        |   |
                      |  | Redis Cluster |    |  Functions    |   |
                      |  +-------+-------+    +-------+-------+   |
                      +----------|---------------------|----------+
                                 |                     |
          +---------------------+|+--------------------+
          |                     ||                     |
+---------v---------+  +--------v---------+  +---------v---------+  +-------------------+
|    Aurora MySQL   |  |   Amazon         |  |     DynamoDB      |  |  Kinesis Data     |
|      Cluster      |  |   Keyspaces      |  |   (Hot Data)      |  |     Streams       |
| (Multi-AZ, 3 nós) |  | (Auto-scaling)   |  | (On-demand, GSIs) |  | (Ingestão Dados)  |
+-------------------+  +------------------+  +-------------------+  +--------+----------+
          |                     |                     |                      |
          |                     |                     |                      |
+---------v---------------------v---------------------v----------------------v----------+
|                                AWS Backup / Replicação Cross-Region                   |
+-----------------------------------------------------------------------------------------+
          |                     |                     |                      |
+---------v---------------------v---------------------v----------------------v----------+
|                          CloudWatch / Observabilidade / Alarmes                      |
+-----------------------------------------------------------------------------------------+
```

### Apêndice B: Configurações de Banco de Dados

#### B.1 Aurora MySQL - Parâmetros de Otimização

##### Parâmetros do Cluster
| Parâmetro | Valor | Descrição |
|-----------|-------|-----------|
| `aurora_binlog_replication_max_yield_seconds` | 0.5 | Equilibra latência e throughput para replicação binlog |
| `aurora_disable_hash_join` | 0 | Permite uso de hash joins para consultas complexas |
| `aurora_parallel_query` | ON | Habilita processamento paralelo para consultas analíticas |
| `aurora_read_replica_read_committed` | ON | Melhora performance de leitura em réplicas |

##### Parâmetros de Instância
| Parâmetro | Valor | Descrição |
|-----------|-------|-----------|
| `innodb_buffer_pool_size` | 12G | 75% da memória disponível para caching de dados |
| `innodb_read_io_threads` | 16 | Otimizado para workloads com muitas leituras |
| `innodb_write_io_threads` | 16 | Otimizado para picos de escrita |
| `max_connections` | 2000 | Suporte a múltiplas aplicações conectadas |
| `innodb_flush_log_at_trx_commit` | 2 | Melhor performance com durabilidade aceitável |
| `innodb_flush_method` | O_DIRECT | Bypass do cache do sistema operacional |
| `query_cache_type` | 0 | Desativado (obsoleto no MySQL moderno) |
| `innodb_file_per_table` | 1 | Cada tabela em arquivo separado para otimização de espaço |
| `innodb_io_capacity` | 2000 | Para discos SSD de alta performance |
| `innodb_io_capacity_max` | 4000 | Para picos de carga |
| `innodb_log_file_size` | 1G | Reduz flush de disco e melhora performance |
| `innodb_log_files_in_group` | 4 | Aumenta durabilidade |
| `innodb_log_buffer_size` | 64M | Buffer para operações de log |
| `innodb_buffer_pool_instances` | 16 | Reduz contenção em sistemas multi-core |
| `innodb_thread_concurrency` | 0 | Permite MySQL gerenciar concorrência |
| `join_buffer_size` | 1M | Buffer para operações de join |
| `sort_buffer_size` | 4M | Buffer para operações de ordenação |
| `read_buffer_size` | 256K | Buffer para varredura sequencial |
| `read_rnd_buffer_size` | 512K | Buffer para leitura de linhas em ordem aleatória |
| `max_heap_table_size` | 64M | Tamanho máximo para tabelas em memória |
| `tmp_table_size` | 64M | Tabelas temporárias em memória |
| `table_open_cache` | 4000 | Cache de manipuladores de tabela |
| `table_definition_cache` | 2048 | Cache para definições de tabela |
| `binlog_format` | ROW | Formato de binlog para replicação confiável |
| `binlog_cache_size` | 2M | Cache para binlog por conexão |
| `binlog_stmt_cache_size` | 1M | Cache para statements no binlog |
| `binlog_row_image` | minimal | Reduz tamanho de binlog |
| `sync_binlog` | 1 | Durabilidade maximizada para binlog |
| `performance_schema` | 1 | Monitoramento detalhado habilitado |

##### Índices Críticos
| Tabela | Índice | Colunas | Propósito |
|--------|--------|---------|-----------|
| `customers` | `idx_customer_cpf` | `cpf` | Lookup rápido por CPF |
| `customers` | `idx_customer_status` | `status` | Filtrar por status |
| `transactions` | `idx_transaction_date` | `created_at` | Consultas por período |
| `transactions` | `idx_customer_transaction` | `customer_id, created_at` | Histórico de cliente |
| `credit_decisions` | `idx_decision_date` | `decision_date` | Análise temporal |
| `credit_decisions` | `idx_customer_decision` | `customer_id, decision_date` | Histórico de decisões |

#### B.2 Amazon Keyspaces - Parâmetros de Otimização

##### Configuração de Capacidade
| Parâmetro | Valor | Descrição |
|-----------|-------|-----------|
| `readCapacityUnits` | 500 (base) | Capacidade base inicial |
| `writeCapacityUnits` | 500 (base) | Capacidade base inicial |
| `minReadCapacity` | 100 | Mínimo para custo-benefício |
| `maxReadCapacity` | 10000 | Máximo para picos de carga |
| `minWriteCapacity` | 100 | Mínimo para custo-benefício |
| `maxWriteCapacity` | 10000 | Máximo para picos de carga |
| `targetUtilization` | 50% | Escala mais proativamente |
| `ttlSeconds` | 2592000 (30 dias) | Para dados transacionais temporários |

##### Otimizações de Schema

###### Tabela Principal: `creditplatform.creditdata`
```cql
CREATE TABLE creditplatform.creditdata (
  customer_id text,
  data_type text,
  transaction_id text,
  amount decimal,
  status text,
  credit_score int,
  monthly_income decimal,
  existing_debts decimal,
  created_at timestamp,
  updated_at timestamp,
  ttl timestamp,
  PRIMARY KEY (customer_id, data_type)
);
```

###### Design de Partição
| Tipo de Dado | Padrão de Chave | Exemplo | Benefício |
|--------------|-----------------|---------|-----------|
| Perfil Cliente | `customer_id + "PROFILE"` | `"C12345PROFILE"` | Evita partições quentes |
| Transações | `customer_id + "TXN#" + timestamp` | `"C12345TXN#20240401112233"` | Distribuição temporal |
| Decisões | `customer_id + "DECISION#" + timestamp` | `"C12345DECISION#20240401112233"` | Organização cronológica |

###### Estratégias de Consulta
| Cenário | Estratégia | Implementação |
|---------|------------|---------------|
| Consultas frequentes | Caching com Redis | TTL baseado na frequência de acesso |
| Leituras em lote | Batching | Múltiplos `customer_id` em uma consulta |
| Dados críticos | Consistência QUORUM | Para operações sensíveis a inconsistências |
| Consultas analíticas | Exportação programada | Para evitar consumo excessivo de RCUs |

### Apêndice C: Matriz de Responsabilidade

#### C.1 Matriz RACI

| Atividade | Equipe de Engenharia de Dados | Equipe de Operações | Equipe de Segurança | Equipe de Desenvolvimento | Equipe de Negócios |
|-----------|-------------------------------|---------------------|---------------------|---------------------------|---------------------|
| **Monitoramento diário de performance** | C | R | I | I | I |
| **Gestão de alertas e incidentes** | A | R | C | I | I |
| **Otimização contínua de queries** | R | C | I | A | I |
| **Escalonamento de recursos** | R | A | I | C | I |
| **Atualização de infraestrutura** | R | A | C | I | I |
| **Backups e testes de recuperação** | A | R | C | I | I |
| **Avaliação de segurança e compliance** | C | C | R | I | A |
| **Evolução do modelo de dados** | R | I | C | A | C |
| **Definição de SLAs e SLOs** | A | C | C | C | R |
| **Gestão de custos de infraestrutura** | R | C | I | I | A |
| **Testes de DR** | A | R | C | I | I |
| **Implementação de novas features** | C | I | C | R | A |

*Legenda: R = Responsável, A = Aprovação, C = Consultado, I = Informado*

#### C.2 Procedimentos Operacionais por Equipe

##### Equipe de Engenharia de Dados
- **Diariamente**: 
  - Revisar métricas de performance de bancos de dados
  - Analisar logs de ingestão de dados
  - Verificar processos de consistência de dados
- **Semanalmente**:
  - Otimizar queries com base em análise de métricas
  - Ajustar capacidade de recursos conforme necessidade
  - Validar integridade de backups
- **Mensalmente**:
  - Executar testes de recuperação de dados
  - Revisar e otimizar custos
  - Atualizar documentação técnica

##### Equipe de Operações
- **Diariamente**:
  - Monitorar alertas e dashboards
  - Responder a incidentes (P1/P2)
  - Verificar logs de sistema
- **Semanalmente**:
  - Verificar patches e atualizações de segurança
  - Revisar métricas de disponibilidade
  - Atualizar runbooks conforme necessário
- **Mensalmente**:
  - Executar testes de DR
  - Revisar políticas de escalonamento
  - Conduzir análise postmortem de incidentes

##### Equipe de Segurança
- **Diariamente**:
  - Monitorar alertas de segurança
  - Verificar logs de acesso
  - Investigar atividades suspeitas
- **Semanalmente**:
  - Revisar IAM e permissões
  - Verificar conformidade com políticas
  - Atualizar regras WAF conforme ameaças
- **Mensalmente**:
  - Conduzir testes de penetração
  - Atualizar matriz de riscos
  - Revisar planos de resposta a incidentes

##### Equipe de Desenvolvimento
- **Diariamente**:
  - Monitorar métricas de aplicação
  - Resolver bugs prioritários
  - Revisão de logs de erro
- **Semanalmente**:
  - Otimizar código baseado em perfis de performance
  - Revisar implementações de resiliência
  - Validar integrações entre serviços
- **Mensalmente**:
  - Implementar melhorias de performance
  - Refatorar componentes críticos
  - Validar requisitos técnicos vs. implementação

##### Equipe de Negócios
- **Diariamente**:
  - Acompanhar KPIs de negócio
  - Verificar dashboards executivos
  - Reportar problemas de usuário
- **Semanalmente**:
  - Revisar métricas de SLA/SLO
  - Priorizar backlog de desenvolvimento
  - Analisar tendências de uso
- **Mensalmente**:
  - Revisar custos vs. benefícios
  - Definir roadmap de evolução
  - Validar requisitos de negócio para próximas iterações

#### C.3 Matriz de Escalação

| Nível | Tempo de Resposta | Responsável Primário | Responsável Backup | Quando Escalar |
|-------|-------------------|----------------------|--------------------|----------------|
| **P1** | 15 minutos | Operações (24x7) | Engenharia de Dados | Após 30 min sem resolução |
| **P2** | 1 hora | Operações (horário comercial) | Desenvolvimento | Após 2 horas sem resolução |
| **P3** | 8 horas | Responsável designado | Operações | Após 1 dia sem resolução |
| **P4** | 24 horas | Responsável designado | N/A | Após 3 dias sem resolução |

*Níveis de Criticidade:*
- **P1**: Sistema inoperante ou com degradação severa
- **P2**: Funcionalidade crítica afetada ou degradação significativa
- **P3**: Funcionalidade não-crítica afetada ou problema pontual
- **P4**: Questão menor sem impacto imediato
