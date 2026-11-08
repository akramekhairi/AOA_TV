import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText).toString('base64')}`;
const sharedUrl = moduleUrl(readFileSync(new URL('../../../packages/shared/src/index.ts',import.meta.url),'utf8'));
const source = readFileSync(new URL('../src/collectionFilters.ts',import.meta.url),'utf8').replace("'@aoa/shared'",JSON.stringify(sharedUrl));
const {filterCollection} = await import(moduleUrl(source));
const items = [
  {id:'ep',type:'episode',title:'أَحْلَام ـ الحلقة ١'},
  {id:'movie',type:'movie',title:'أحلام'},
  {id:'series',type:'series',title:'Dream World'},
  {id:'live',type:'live',title:'Dream TV'},
  {id:'ep2',type:'episode',title:'Dream World: Part 2'},
];
const ids = results => results.map(item=>item.id);

test('collection search matches Arabic titles despite vowel marks, tatweel and alef variants',()=>{
  assert.deepEqual(ids(filterCollection(items,' احلام ','')),['ep','movie']);
});

test('Series includes episodes in original progress order; Movies and Live stay separate',()=>{
  assert.deepEqual(ids(filterCollection(items,'','series')),['ep','series','ep2']);
  assert.deepEqual(ids(filterCollection(items,'','movie')),['movie']);
  assert.deepEqual(ids(filterCollection(items,'','live')),['live']);
  assert.deepEqual(ids(filterCollection(items,'','')),items.map(item=>item.id));
});

test('search and type combine and English search ignores case',()=>{
  assert.deepEqual(ids(filterCollection(items,'DREAM','series')),['series','ep2']);
  assert.deepEqual(ids(filterCollection(items,'احلام','series')),['ep']);
  assert.deepEqual(filterCollection(items,'missing','movie'),[]);
});
