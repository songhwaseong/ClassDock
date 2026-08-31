"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const os=require("node:os");
const {spawnSync}=require("node:child_process");
const root=path.join(__dirname,".."), tempRoot=path.resolve(os.tmpdir());
const csc=["Framework64","Framework"].map(framework=>path.join(process.env.SystemRoot||"C:/Windows","Microsoft.NET",framework,"v4.0.30319","csc.exe")).find(file=>fs.existsSync(file));
const bash=process.platform==="win32" ? ["C:/Program Files/Git/bin/bash.exe","C:/Program Files/Git/usr/bin/bash.exe"].find(file=>fs.existsSync(file)) : null;
const posixPath=value=>value.replace(/\\/g,"/").replace(/^([A-Za-z]):/,(_,drive)=>"/"+drive.toLowerCase());
const quote=value=>"'"+value.replace(/'/g,"'\"'\"'")+"'";

test("Bash session bootstrap reports cwd without editing profiles and preserves prompt hooks",{skip:!csc||!bash},()=>{
  const temp=fs.mkdtempSync(path.join(tempRoot,"classdock-shell-"));
  try{
    const exe=path.join(temp,"shell-command.exe"), resource=path.join(root,"desktop/ssh_shell_integration.bash");
    const compiled=spawnSync(csc,["/nologo","/target:exe","/main:SshShellCommandTest","/r:System.IO.Compression.dll","/r:System.Security.dll","/out:"+exe,
      "/resource:"+resource+",ssh_shell_integration.bash",path.join(root,"desktop/launcher.cs"),path.join(root,"desktop/ssh_terminal.cs"),path.join(root,"desktop/ssh_files.cs"),path.join(__dirname,"fixtures/ssh-shell-command.cs")],{encoding:"utf8",timeout:30000,windowsHide:true});
    assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
    const token="0123456789abcdef0123456789abcdef";
    const built=spawnSync(exe,[token],{encoding:"utf8",timeout:5000,windowsHide:true});
    assert.equal(built.status,0,built.stderr);
    const destination=path.join(temp,"한글 100% 'folder'");fs.mkdirSync(destination);
    for(const prompt of ["PROMPT_COMMAND='printf \"HOOK:%s\\n\" \"$?\"'", "PROMPT_COMMAND=('printf \"HOOK:%s\\n\" \"$?\"' ':')", "export PROMPT_COMMAND='printf \"HOOK:%s\\n\" \"$?\"'"]){
      const profile="PS1='test> '\nPROFILE_MARKER=loaded\n"+prompt+"\n";
      fs.writeFileSync(path.join(temp,".bash_profile"),profile);
      const result=spawnSync(bash,["--noprofile","--norc","-c",built.stdout],{
        env:{...process.env,HOME:posixPath(temp),SHELL:"/usr/bin/bash",ENV:"/original-env",MSYS_NO_PATHCONV:"1"},
        input:"printf 'PROFILE:%s ENV:%s\\n' \"$PROFILE_MARKER\" \"$ENV\"\ncd -- "+quote(posixPath(destination))+"\nfalse\nprintf 'DONE\\n'\n\"$BASH\" --noprofile --norc -ic 'printf CHILD_OK'\nexit\n",
        encoding:"utf8",timeout:15000,windowsHide:true,maxBuffer:1024*1024
      });
      assert.equal(result.status,0,result.stdout+result.stderr);
      assert.match(result.stdout,/PROFILE:loaded ENV:\/original-env/,result.stderr);
      assert.match(result.stdout,/HOOK:1/);
      const locations=[...result.stdout.matchAll(/\x1b\]7;file:\/\/classdock-([a-f0-9]+)([^\x07]*)\x07/g)].map(match=>({token:match[1],path:decodeURIComponent(match[2])}));
      assert.ok(locations.length>=3,result.stdout+result.stderr);
      assert.ok(locations.some(location=>location.token===token&&location.path===posixPath(destination)));
      assert.equal(fs.readFileSync(path.join(temp,".bash_profile"),"utf8"),profile);
      assert.doesNotMatch(result.stdout+result.stderr,/exec 3<|CLASSDOCK_CWD_TOKEN=/,"initialization code must never enter the interactive input stream");
      assert.doesNotMatch(result.stderr,/__classdock_report_cwd: command not found/);
      assert.match(result.stdout,/CHILD_OK/);
    }
    const fallback=spawnSync(bash,["--noprofile","--norc","-c",built.stdout],{
      env:{...process.env,HOME:posixPath(temp),SHELL:"/usr/bin/sh",MSYS_NO_PATHCONV:"1"},
      input:"printf 'FALLBACK_OK\\n'\nexit\n",encoding:"utf8",timeout:10000,windowsHide:true
    });
    assert.equal(fallback.status,0,fallback.stdout+fallback.stderr);
    assert.match(fallback.stdout,/FALLBACK_OK/);assert.doesNotMatch(fallback.stdout,/classdock-/);
  }finally{
    assert.equal(path.dirname(path.resolve(temp)),tempRoot);
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
