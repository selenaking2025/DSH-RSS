import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFixture } from './fixture-server.mjs';
import { INVOKE_METHODS } from '../src/client/methods.ts';
import { BROWSER_METHODS, missingBackendMethods } from '../src/shared/capabilities.ts';
import { installFileActions } from '../src/client/files.ts';
import { createConfirmation } from '../src/client/confirmation.tsx';
import { PLUGIN_VERSION, CATPAW_SOURCE } from '../src/shared/version.ts';

async function until(check: () => Promise<boolean>, timeout = 15_000) {
  const end=Date.now()+timeout;
  while (!await check()) { if(Date.now()>end)throw new Error('Upstream fixture timeout');await new Promise(resolve=>setTimeout(resolve,50)); }
}
async function createBackend(options: object = {}) {
  const directory=await mkdtemp(join(tmpdir(),'catpaw-upstream-test-'));
  const {CatpawBackend}=await import(new URL('../dist/backend.js',import.meta.url).href);
  const backend=new CatpawBackend(directory,{disableScheduler:true,...options});
  return {directory,backend,call:(method:string,args:unknown[]=[])=>backend.call(method,args,'upstream-test'),
    async close(){await backend.close();await rm(directory,{recursive:true,force:true});}};
}

test('all upstream methods have a backend or explicit browser implementation',async()=>{
  const f=await createBackend({disableAutomaticBackups:true});
  try{
    await f.backend.start();assert.deepEqual(missingBackendMethods(INVOKE_METHODS,f.backend.availableMethods),[]);
    assert.deepEqual(missingBackendMethods([...INVOKE_METHODS,'futureFeature'],f.backend.availableMethods),['futureFeature']);
    const methods:Record<string,unknown>={};installFileActions({rss:methods} as any,async()=>false);
    for(const method of BROWSER_METHODS)assert.equal(typeof methods[method],'function',method);
    const status=await f.call('getAppStatus');assert.equal(status.version,PLUGIN_VERSION);assert.deepEqual(status.upstream,CATPAW_SOURCE);
  }finally{await f.close();}
});

test('automatic backups run on startup, preserve data, retain seven snapshots and survive restart', {timeout:60_000}, async()=>{
  const f=await createBackend();const fixture=await startFixture();
  try{
    await f.backend.start();await until(async()=>Boolean((await f.call('getAutomaticBackupStatus')).lastSuccessAt));
    await f.call('addFeed',[{url:`${fixture.origin}/rss`}]);const [entry]=await f.call('listEntries',[{}]);
    await f.call('markRead',[entry.id,true]);await f.call('toggleStar',[entry.id]);
    for(let i=0;i<8;i++)await f.call('runAutomaticBackup');
    const status=await f.call('getAutomaticBackupStatus');assert.equal(status.running,false);
    const bytes=await readFile(status.lastBackupPath);assert.equal(bytes.subarray(0,16).toString(),'SQLite format 3\0');
    assert.equal((await readdir(status.directory)).filter(name=>name.endsWith('.sqlite3')).length,7);
    await f.call('setAutomaticBackupEnabled',[false]);await f.backend.restart();
    assert.equal((await f.call('getAutomaticBackupStatus')).enabled,false);
    const saved=await f.call('getEntry',[entry.id]);assert.equal(saved.isRead,1);assert.equal(saved.isStarred,1);
    await f.call('resetAutomaticBackupDirectory');
    await assert.rejects(f.call('setAutomaticBackupEnabled',['yes']),/IPC_INVALID_INPUT/);
  }finally{await f.close();await fixture.close();}
});

test('Harness models obey shared budgets and long-text confirmations are scoped and cancellable', {timeout:60_000},async()=>{
  let modelCalls=0;
  const f=await createBackend({disableAutomaticBackups:true,harnessModel:{model:'fixture-text',generate:async(request:{content:string})=>{
    modelCalls++;const input=JSON.parse(request.content);return JSON.stringify({translations:input.segments.map((text:string)=>`译文：${text}`)});
  }}});
  const fixture=await startFixture();
  try{
    await f.backend.start();await f.call('addFeed',[{url:`${fixture.origin}/rss`}]);const [entry]=await f.call('listEntries',[{}]);
    const input={requestId:'budget-test',entryId:entry.id,selection:{providerId:'harness',model:'fixture-text'},targetLanguage:'zh-CN',texts:['Read saved articles.']};
    await f.call('setModelDailyTokenLimit',[1]);const blocked=await f.call('translateArticle',[input]);
    assert.equal(blocked.ok,false);assert.match(blocked.error,/额度不足/);assert.equal(modelCalls,0);
    await f.call('setModelDailyTokenLimit',[1000000]);assert.equal((await f.call('translateArticle',[input])).ok,true);
    const usage=(await f.call('getModelUsage')).data;assert.equal(usage.requests,1);assert.ok(usage.usedTokens>8192);assert.equal(usage.estimatedRequests,1);
    await f.call('translateArticle',[{...input,requestId:'cached'}]);assert.equal(modelCalls,1);
    const long={...input,requestId:'long-text',texts:Array.from({length:8},(_,i)=>`${i}: ${'Long text. '.repeat(200)}`)};
    const task=f.call('translateArticle',[long]);
    let question:any;
    await until(async()=>{const events=await f.backend.events('upstream-test',0,new AbortController().signal);question=events.events.find((e:any)=>e.channel==='catpaw:modelConfirmation');return Boolean(question);});
    await assert.rejects(f.backend.call('answerModelConfirmation',[question.value.id,true],'different-owner'),/EXPIRED/);
    await f.call('answerModelConfirmation',[question.value.id,false]);assert.equal((await task).code,'CANCELLED');assert.equal(modelCalls,1);
    await assert.rejects(f.call('answerModelConfirmation',[question.value.id,true]),/EXPIRED/);
    const since=(await f.backend.events('upstream-test',0,new AbortController().signal)).sequence;
    const controller=new AbortController();const cancelled=assert.rejects(f.backend.call('translateArticle',[{...long,requestId:'cancel-long'}],'upstream-test',controller.signal),/CANCELLED/);
    await until(async()=>{const events=await f.backend.events('upstream-test',since,new AbortController().signal);return events.events.some((e:any)=>e.channel==='catpaw:modelConfirmation');});
    controller.abort();await cancelled;assert.equal(modelCalls,1);
    const finalTask=f.call('translateArticle',[{...long,requestId:'accepted-long'}]);
    let accepted:any;
    await until(async()=>{const events=await f.backend.events('upstream-test',since,new AbortController().signal);accepted=events.events.filter((e:any)=>e.channel==='catpaw:modelConfirmation').at(-1);return Boolean(accepted&&accepted.value.id!==question.value.id);});
    // The cancelled request's event can precede the new question; wait for the live one.
    await until(async()=>{try{await f.call('answerModelConfirmation',[accepted.value.id,true]);return true;}catch{const events=await f.backend.events('upstream-test',0,new AbortController().signal);accepted=events.events.filter((e:any)=>e.channel==='catpaw:modelConfirmation').at(-1);return false;}});
    assert.equal((await finalTask).ok,true);assert.ok(modelCalls>1);
  }finally{await f.close();await fixture.close();}
});

test('browser confirmation closes on cancellation and does not approve overlapping questions',async()=>{
  const controller=createConfirmation();let current:unknown;const stop=controller.subscribe(value=>{current=value;});
  const signal=new AbortController();const first=controller.ask({title:'first',detail:'test'},signal.signal);
  assert.equal(await controller.ask({title:'second',detail:'test'}),false);assert.ok(current);
  signal.abort();assert.equal(await first,false);assert.equal(current,null);
  const second=controller.ask({title:'next',detail:'test'});controller.answer(true);assert.equal(await second,true);stop();
});
