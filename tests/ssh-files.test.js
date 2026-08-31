"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const os=require("node:os");
const {spawnSync}=require("node:child_process");
const root=path.join(__dirname,"..");
const csc=["Framework64","Framework"].map(framework=>path.join(process.env.SystemRoot||"C:/Windows","Microsoft.NET",framework,"v4.0.30319","csc.exe")).find(file=>fs.existsSync(file));
test("SFTP wire, bounded reads, cancellation and atomic local save preserve file bytes",{skip:process.platform!=="win32"||!csc},()=>{
  const tempRoot=fs.realpathSync(os.tmpdir()),temp=fs.mkdtempSync(path.join(tempRoot,"classdock-sftp-test-"));
  try{
    const exe=path.join(temp,"sftp-tests.exe");
    const compiled=spawnSync(csc,["/nologo","/target:exe","/main:SshFilesTest","/r:System.IO.Compression.dll","/r:System.Security.dll","/out:"+exe,
      path.join(root,"desktop/launcher.cs"),path.join(root,"desktop/ssh_terminal.cs"),path.join(root,"desktop/ssh_files.cs"),path.join(__dirname,"fixtures/ssh-files.cs")],{encoding:"utf8",timeout:30000,windowsHide:true});
    assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
    const run=spawnSync(exe,[temp],{encoding:"utf8",timeout:30000,windowsHide:true});
    assert.equal(run.status,0,run.stdout+run.stderr);
    assert.match(run.stdout,/SFTP file checks passed/);
  }finally{
    assert.equal(path.dirname(path.resolve(temp)),tempRoot);
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
