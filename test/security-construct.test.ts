// Em /test/constructs/security-construct.test.ts 
// Provavelmente vai dar erro nesse teste da forma como coloquei. Porem o objetivo dele era mostrar um exemplo pratico de como pode ser feito
// a analise dos templates etc.

import { Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { SecurityConstruct } from '../lib/constructs/security-construct';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

test('SecurityConstruct cria recursos corretos', () => {
  const stack = new Stack();
  const vpc = new ec2.Vpc(stack, 'TestVpc');
  new SecurityConstruct(stack, 'TestSecurity', { vpc });
  
  const template = Template.fromStack(stack);
  
  // Verificar se a chave KMS foi criada
  template.hasResourceProperties('AWS::KMS::Key', {
    EnableKeyRotation: true
  });
  
  // Verificar se o WAF foi configurado
  template.hasResourceProperties('AWS::WAFv2::WebACL', {
    Scope: 'REGIONAL'
  });
});