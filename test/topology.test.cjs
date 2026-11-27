const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const {Git} = require('../dist/git');
const {scanWorktrees} = require('../dist/worktrees');
const {TopologyWatcher} = require('../dist/topology');
require('node:test').test('文件系统事件发现外部 worktree 增删、移动及登记目录重建', async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'worktree-topology-')));
 const source=path.join(root,'source');await fs.mkdir(source);
 const git=(...args)=>execFileSync('git',['-C',source,...args],{stdio:'pipe',env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
 git('init','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');git('commit','--allow-empty','-qm','fixture');
 const cli=new Git();let features=[];let timer;let running=false;let pending=false;
 const watcher=new TopologyWatcher(()=>{clearTimeout(timer);timer=setTimeout(()=>void scan(),50)});
 async function scan(){if(running){pending=true;return;} running=true;try{features=await scanWorktrees({folders:[source],roots:[],knownRepositories:[path.join(root,'external'),path.join(root,'moved')],excluded:[],onTopologyDiscovered:dirs=>watcher.update(dirs)},cli);}finally{running=false;if(pending){pending=false;await scan();}}}
 async function expect(dir,present){const until=Date.now()+5000;while(features.flatMap(f=>f.repositories).some(r=>r.directory===dir)!==present){assert.ok(Date.now()<until,'event-driven discovery timed out');await new Promise(r=>setTimeout(r,30));}}
 try{
  await scan();const outside=path.join(root,'external');git('worktree','add','-qb','feat/external',outside);await expect(outside,true);
  const moved=path.join(root,'moved');git('worktree','move',outside,moved);await expect(moved,true);await expect(outside,false);
  git('worktree','remove',moved);await expect(moved,false);
  git('worktree','add',outside,'feat/external');await expect(outside,true);git('worktree','remove',outside);await expect(outside,false);
  console.log('PASS: first external worktree creation, move, deletion, registry recreation without polling');
 }finally{watcher.dispose();clearTimeout(timer);while(running)await new Promise(r=>setTimeout(r,30));cli.dispose();await fs.rm(root,{recursive:true,force:true});}
});
