#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MainStack } from '../lib/stacks/main-stack';

const app = new cdk.App();

// Parâmetros via contexto do CDK
const environment = app.node.tryGetContext('environment') || 'dev';
const account = app.node.tryGetContext('account') || process.env.CDK_DEFAULT_ACCOUNT;
const region = app.node.tryGetContext('region') || process.env.CDK_DEFAULT_REGION;

// Configurações específicas do ambiente
const envConfigs: { [key: string]: any } = {
  dev: {
    prefix: 'dev',
    instanceSize: 'SMALL',
  },
  staging: {
    prefix: 'staging',
    instanceSize: 'MEDIUM',
  },
  prod: {
    prefix: 'prod',
    instanceSize: 'LARGE',
  },
};

const config = envConfigs[environment];

if (!config) {
  throw new Error(`Ambiente '${environment}' não configurado. Use um dos seguintes: ${Object.keys(envConfigs).join(', ')}`);
}

// Criação do stack principal
new MainStack(app, `${config.prefix}-CreditPlatform`, {
  env: {
    account,
    region,
  },
  tags: {
    Environment: environment,
    Project: 'CreditPlatform',
    Owner: 'DataEngineering',
  },
});

app.synth();