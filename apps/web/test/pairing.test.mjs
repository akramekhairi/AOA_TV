import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const compile=(source)=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const pairingModule={exports:{}};
new Function('exports',compile(readFileSync(new URL('../src/pairing.ts',import.meta.url),'utf8')))(pairingModule.exports);
const {configuredOrigin,pairedToken,tokenKey,phoneName,pairingCooldown}=pairingModule.exports;
const legacy='https://aoa-tv-api.onrender.com';
function storage(values={}) {const data=new Map(Object.entries(values));return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key),data};}

test('deployment configuration takes precedence and supports the legacy build variable',()=>{
  assert.equal(configuredOrigin({VITE_API_URL:'https://current.test/api/v1/',VITE_API_BASE_URL:legacy}),'https://current.test');
  assert.equal(configuredOrigin({VITE_API_BASE_URL:legacy}),legacy);
  assert.equal(configuredOrigin({}),legacy);
  for(const value of ['https://user:secret@host.test','javascript:alert(1)','https://host.test?token=x','http://remote.test']) assert.throws(()=>configuredOrigin({VITE_API_URL:value}));
});
test('known Render pairing migrates once to configured origin and logout stays logged out',()=>{
  const base='https://current.test';const store=storage({'aoa.backend':legacy,[tokenKey(legacy)]:'existing-device-token'});
  assert.equal(pairedToken(store,base),'existing-device-token');
  assert.equal(store.getItem(tokenKey(base)),'existing-device-token');
  assert.equal(store.getItem(tokenKey(legacy)),null);
  assert.equal(store.getItem('aoa.backend'),null);
  store.removeItem(tokenKey(base));assert.equal(pairedToken(store,base),'');
});
test('arbitrary saved backend cannot redirect requests or migrate its credentials',()=>{
  const base=configuredOrigin({VITE_API_URL:'https://current.test'});
  const store=storage({'aoa.backend':'https://untrusted.test',[tokenKey('https://untrusted.test')]:'foreign-token'});
  assert.equal(pairedToken(store,base),'');assert.equal(store.getItem(tokenKey(base)),null);
  const current=storage({[tokenKey(base)]:'current',[tokenKey(legacy)]:'stale'});
  assert.equal(pairedToken(current,base),'current');assert.equal(current.getItem(tokenKey(legacy)),null);
});
test('phone names require actual input and preserve intentional internal spacing',()=>{
  assert.equal(phoneName('  Family phone  '),'Family phone');
  assert.equal(phoneName('My  phone'),'My  phone');
  for(const value of ['', '   ', '\t\n']) assert.throws(()=>phoneName(value),/Enter a phone name/);
  assert.equal(pairingCooldown(),30);assert.equal(pairingCooldown(2),30);assert.equal(pairingCooldown(45),45);
});
function renderApp(values={}) {
  let source=readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');
  source=source.slice(0,source.indexOf("createRoot(document"))+'\nexport {App};';
  source=source.replaceAll('import.meta.env','buildEnv');
  const mod={exports:{}};
  const localRequire=name=>name==='./pairing'?pairingModule.exports:name.endsWith('.css')?{}:name.startsWith('./')?{}:require(name);
  new Function('require','module','exports','localStorage','buildEnv',compile(source))(localRequire,mod,mod.exports,storage(values),{VITE_API_URL:'https://current.test',BASE_URL:'/'});
  return renderToStaticMarkup(createElement(mod.exports.App));
}
test('registration shows required empty name, TV request action and six digit claim with no address controls',()=>{
  const html=renderApp({'aoa.backend':'https://untrusted.test'});
  assert.match(html,/Show pairing code on TV/);assert.match(html,/keep it open/);
  assert.match(html,/required="" maxLength="80" placeholder="My phone" value=""/);
  assert.match(html,/pattern="\[0-9\]\{6\}"/);
  assert.doesNotMatch(html,/Backend address|Save address|untrusted\.test/);
  assert.match(html,/disabled="">Pair with TV/);
});
