// Synthetic JMeter inputs for the converter harness (no real company data).
const fs = require('fs'), path = require('path');
const D = path.join(__dirname, 'inputs'); fs.mkdirSync(D, { recursive: true });
const sampler = (name, method, p, body, extra = '') => `
        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${name}" enabled="true">
          <stringProp name="HTTPSampler.domain">\${HOST}</stringProp>
          <stringProp name="HTTPSampler.protocol">https</stringProp>
          <stringProp name="HTTPSampler.path">${p}</stringProp>
          <stringProp name="HTTPSampler.method">${method}</stringProp>${body ? `
          <boolProp name="HTTPSampler.postBodyRaw">true</boolProp>
          <elementProp name="HTTPsampler.Arguments" elementType="Arguments"><collectionProp name="Arguments.arguments">
            <elementProp name="" elementType="HTTPArgument"><stringProp name="Argument.value">${body}</stringProp></elementProp>
          </collectionProp></elementProp>` : ''}
        </HTTPSamplerProxy>
        <hashTree>${extra}</hashTree>`;
const jsonEx = (ref, p) => `<JSONPostProcessor guiclass="JSONPostProcessorGui" testclass="JSONPostProcessor" testname="${ref}" enabled="true"><stringProp name="JSONPostProcessor.referenceNames">${ref}</stringProp><stringProp name="JSONPostProcessor.jsonPathExprs">${p}</stringProp></JSONPostProcessor><hashTree/>`;
const regEx = (ref, re) => `<RegexExtractor guiclass="RegexExtractorGui" testclass="RegexExtractor" testname="${ref}" enabled="true"><stringProp name="RegexExtractor.refname">${ref}</stringProp><stringProp name="RegexExtractor.regex">${re}</stringProp><stringProp name="RegexExtractor.template">$1$</stringProp><stringProp name="RegexExtractor.match_number">1</stringProp></RegexExtractor><hashTree/>`;
const csvDs = `<CSVDataSet guiclass="TestBeanGUI" testclass="CSVDataSet" testname="Users" enabled="true"><stringProp name="filename">users.csv</stringProp><stringProp name="variableNames">USER,PASS</stringProp><stringProp name="delimiter">,</stringProp></CSVDataSet><hashTree/>`;
const vars = `<Arguments guiclass="ArgumentsPanel" testclass="Arguments" testname="Vars" enabled="true"><collectionProp name="Arguments.arguments"><elementProp name="HOST" elementType="Argument"><stringProp name="Argument.name">HOST</stringProp><stringProp name="Argument.value">shop.example.com</stringProp></elementProp></collectionProp></Arguments><hashTree/>`;
const tg = (cls, name, threads, inner) => `
      <${cls} guiclass="ThreadGroupGui" testclass="${cls}" testname="${name}" enabled="true">
        <stringProp name="ThreadGroup.num_threads">${threads}</stringProp><stringProp name="ThreadGroup.ramp_time">10</stringProp>
      </${cls}>
      <hashTree>${inner}
      </hashTree>`;
const plan = (name, body) => `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3"><hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="${name}" enabled="true"/>
    <hashTree>${vars}${body}
    </hashTree>
</hashTree></jmeterTestPlan>
`;
fs.writeFileSync(path.join(D, 'simple.jmx'), plan('Simple Plan', tg('ThreadGroup', 'Shoppers', 5,
  sampler('T01_Home', 'GET', '/') + sampler('T02_Login', 'POST', '/api/login', '{"user":"${USER}","password":"secret"}', jsonEx('token', '$.token')))));
const ifc = (cond, inner) => `<IfController guiclass="IfControllerPanel" testclass="IfController" testname="If logged in" enabled="true"><stringProp name="IfController.condition">${cond}</stringProp></IfController><hashTree>${inner}</hashTree>`;
const loop = (n, inner) => `<LoopController guiclass="LoopControlPanel" testclass="LoopController" testname="Browse ${n}x" enabled="true"><stringProp name="LoopController.loops">${n}</stringProp></LoopController><hashTree>${inner}</hashTree>`;
fs.writeFileSync(path.join(D, 'rich.jmx'), plan('Rich Plan', csvDs +
  tg('ThreadGroup', 'Buyers', 10,
    sampler('T01_Login', 'POST', '/api/login', '{"user":"${USER}","pass":"${PASS}"}', jsonEx('token', '$.token') + regEx('csrf', 'name="csrf" value="(.+?)"')) +
    ifc('${__jexl3("${token}" != "")}', loop(3, sampler('T02_Search', 'GET', '/api/search?q=shoes&csrf=${csrf}') + sampler('T03_Item', 'GET', '/api/items/1042', null, jsonEx('itemId', '$.id'))))) +
  tg('ThreadGroup', 'Browsers', 20, sampler('T10_Home', 'GET', '/') + sampler('T11_Catalogue', 'GET', '/catalogue'))));
fs.writeFileSync(path.join(D, 'setup-teardown.jmx'), plan('Setup Teardown Plan',
  tg('SetupThreadGroup', 'Setup', 1, sampler('S01_Seed', 'POST', '/api/seed', '{"n":10}')) +
  tg('ThreadGroup', 'Main', 3, sampler('T01_Get', 'GET', '/api/orders', null, jsonEx('orderId', '$[0].id'))) +
  tg('PostThreadGroup', 'Teardown', 1, sampler('Z01_Clean', 'DELETE', '/api/seed'))));
fs.writeFileSync(path.join(D, 'users.csv'), 'USER,PASS\nalice@example.com,Secret1\nbob@example.com,Secret2\n');
fs.writeFileSync(path.join(D, 'client.pem'), '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUSYNTHETICTESTONLY0000000000000wCgYIKoZIzj0EAwIw\n-----END CERTIFICATE-----\n');
fs.writeFileSync(path.join(D, 'invalid.json'), '{ "info": { "name": "broken" , ');
fs.writeFileSync(path.join(D, 'empty-collection.json'), JSON.stringify({ info: { name: 'Empty', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [] }));
fs.writeFileSync(path.join(D, 'notes.txt'), 'not a collection');
fs.writeFileSync(path.join(D, 'broken.jmx'), '<jmeterTestPlan><hashTree><TestPlan');
console.log('inputs written to', D);
