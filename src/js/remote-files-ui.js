"use strict";

const MNRemoteFilesUI = (() => {
  const policy = MNRemoteFiles;
  const el = (tag, text, className) => { const node=document.createElement(tag); if(text) node.textContent=text; if(className) node.className=className; return node; };
  const button = text => { const node=el("button",text,"btn"); node.type="button"; return node; };
  const field = (label, input) => { const node=el("label", "", "ssh-file-field"); node.append(el("span",label),input); return node; };
  const id = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b=>b.toString(16).padStart(2,"0")).join("");
  const bundle = strings => {
    const chunks=strings.map(value=>new TextEncoder().encode(String(value || "")));
    const bytes=new Uint8Array(chunks.reduce((n,b)=>n+4+b.length,0)); let at=0;
    chunks.forEach(chunk=>{ new DataView(bytes.buffer).setUint32(at,chunk.length,true); at+=4; bytes.set(chunk,at); at+=chunk.length; });
    return bytes;
  };
  const http = async (url, options={}) => {
    const abort=new AbortController(), timer=setTimeout(()=>abort.abort(),15000);
    try {
      const response=await fetch(url,{ ...options, cache:"no-store", signal:abort.signal });
      if(!response.ok) throw new Error((await response.text()).slice(0,300));
      return response;
    } catch(error){ if(error.name==="AbortError") throw new Error("ssh-file-timeout"); throw error; }
    finally { clearTimeout(timer); }
  };
  const post = async (op, values, requestId=id()) => {
    const body=bundle([requestId,...values]);
    try { return await (await http("/ssh-file-"+op,{method:"POST",headers:{"Content-Type":"application/octet-stream","X-ClassDock-Action":"1"},body})).json(); }
    finally { body.fill(0); }
  };
  const release = key => { if(key) post("release",[key]).catch(()=>{}); };
  const deadline = async (promise, ms, stop) => {
    let timer;
    try { return await Promise.race([promise,new Promise((_,reject)=>{ timer=setTimeout(()=>{ stop(); reject(new Error("미리보기 처리 시간이 초과되었습니다. 다운로드를 이용하세요.")); },ms); })]); }
    finally { clearTimeout(timer); }
  };

  const imageViewer = async (bytes, signal) => {
    const info=policy.imageInfo(bytes);
    // A single-frame GIF avoids animation and excess frame decoding.
    const payload=info.frameEnd ? new Uint8Array(info.frameEnd+1) : bytes;
    if(info.frameEnd){ payload.set(bytes.subarray(0,info.frameEnd)); payload[info.frameEnd]=0x3b; }
    const source="onmessage=async e=>{try{const bitmap=await createImageBitmap(new Blob([e.data.bytes],{type:e.data.mime}));postMessage({bitmap},[bitmap]);}catch(_){postMessage({error:true});}};";
    const workerUrl=URL.createObjectURL(new Blob([source],{type:"text/javascript"}));
    let worker, bitmap, abort;
    try {
      worker=new Worker(workerUrl);
      bitmap=await deadline(new Promise((resolve,reject)=>{
        abort=()=>{worker.terminate();reject(new Error("ssh-file-cancelled"));};
        signal.addEventListener("abort",abort,{once:true});
        if(signal.aborted){abort();return;}
        worker.onmessage=event=>event.data.bitmap ? resolve(event.data.bitmap) : reject(new Error("이미지를 해석하지 못했습니다. 다운로드를 이용하세요."));
        worker.onerror=()=>reject(new Error("이미지 미리보기를 시작하지 못했습니다."));
        worker.postMessage({bytes:payload,mime:info.mime});
      }),10000,()=>worker.terminate());
    } finally { worker?.terminate(); if(abort)signal.removeEventListener("abort",abort); URL.revokeObjectURL(workerUrl); }
    if(bitmap.width*bitmap.height>25000000){ bitmap.close(); throw new Error("이미지 해상도 제한을 넘었습니다."); }
    const root=el("div","","ssh-file-image"), controls=el("div","","ssh-file-tools"), area=el("div","","ssh-file-canvas-area");
    const canvas=el("canvas"), fit=button("화면 맞춤"), original=button("원본 크기"), minus=button("−"), plus=button("+"), label=el("span");
    canvas.setAttribute("aria-label","원격 이미지 미리보기");
    let scale=Math.min(1,800/bitmap.width,600/bitmap.height), disposed=false;
    const draw = () => {
      if(disposed) return;
      scale=Math.max(0.02,Math.min(scale,4,Math.sqrt(8000000/(bitmap.width*bitmap.height))));
      canvas.width=Math.max(1,Math.round(bitmap.width*scale)); canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);
      label.textContent=bitmap.width+" × "+bitmap.height+" · "+Math.round(scale*100)+"%";
    };
    fit.onclick=()=>{ scale=Math.min(1,(area.clientWidth||800)/bitmap.width,600/bitmap.height); draw(); };
    original.onclick=()=>{ scale=1; draw(); }; minus.onclick=()=>{ scale/=1.25; draw(); }; plus.onclick=()=>{ scale*=1.25; draw(); };
    controls.append(fit,original,minus,plus,label); area.append(canvas); root.append(controls,area);
    try { draw(); } catch(error) { bitmap.close(); canvas.width=canvas.height=1; throw error; }
    return { root, dispose:()=>{ disposed=true; bitmap.close(); canvas.width=canvas.height=1; } };
  };

  const textViewer = (bytes, job) => {
    const root=el("div"), controls=el("div","","ssh-file-tools"), status=el("div","","ssh-file-note"), content=el("div","","ssh-file-text-content");
    const encoding=el("select"), search=el("input"), next=button("다음 찾기"), mode=button("원문 보기");
    encoding.setAttribute("aria-label","텍스트 인코딩");
    [["auto","자동 (UTF-8/BOM)"],["utf-8","UTF-8"],["euc-kr","CP949"],["utf-16le","UTF-16 LE"],["utf-16be","UTF-16 BE"]].forEach(([value,label])=>{const opt=el("option",label);opt.value=value;encoding.append(opt);});
    search.type="search"; search.placeholder="표시된 내용에서 찾기"; search.setAttribute("aria-label",search.placeholder);
    let table=job.kind==="table", matches=[], matchIndex=-1;
    const find = () => {
      content.querySelectorAll(".ssh-file-match").forEach(node=>node.classList.remove("ssh-file-match"));
      const term=search.value.toLocaleLowerCase();
      matches=term ? [...content.querySelectorAll(".ssh-file-line,td")].filter(node=>node.textContent.toLocaleLowerCase().includes(term)) : [];
      matchIndex=-1; next.textContent=matches.length ? "다음 찾기 · "+matches.length+"곳" : "다음 찾기";
      if(term && !matches.length) next.textContent="표시 범위에 일치 없음";
    };
    const render = () => {
      content.replaceChildren(); status.textContent="";
      try {
        const text=policy.decodeText(bytes,job.partial,encoding.value);
        if(table){
          const parsed=policy.parseTable(text,/\.tsv$/i.test(job.path)?"\t":",",job.partial);
          const grid=el("table","","ssh-file-table"); grid.setAttribute("aria-label","CSV 읽기 전용 미리보기");
          const body=el("tbody");
          parsed.rows.forEach(row=>{ const tr=el("tr"); row.forEach(cell=>tr.append(el("td",cell))); body.append(tr); });
          grid.append(body);content.append(grid);status.textContent=parsed.rows.length+"행 · 수식은 실행하지 않습니다."+(parsed.limited?" 앞부분만 표시합니다.":"");
        } else {
          const parsed=policy.textLines(text), pre=el("pre","","ssh-file-pre");
          parsed.lines.forEach((line,index)=>{const span=el("span",line||" ","ssh-file-line");span.dataset.line=String(index+1);pre.append(span);});
          content.append(pre);status.textContent=parsed.lines.length+"줄 · 검색은 표시 범위만 대상입니다."+((job.partial||parsed.limited)?" 앞부분만 표시합니다.":"");
        }
      } catch(error){ status.textContent=error instanceof TypeError ? "텍스트 해석에 실패했습니다. CP949 등 인코딩을 바꾸거나 다운로드하세요." : policy.errorText(error); }
      mode.textContent=table?"원문 보기":"표 보기"; find();
    };
    encoding.onchange=render; mode.onclick=()=>{table=!table;render();}; search.oninput=find;
    next.onclick=()=>{ if(!matches.length)return; matches.forEach(node=>node.classList.remove("ssh-file-match"));const node=matches[++matchIndex%matches.length];node.classList.add("ssh-file-match");node.scrollIntoView({block:"nearest",inline:"nearest"}); };
    search.onkeydown=event=>{if(event.key==="Enter"){event.preventDefault();next.click();}};
    controls.append(encoding,search,next);if(job.kind==="table")controls.append(mode);
    root.append(controls,status,content);render();
    return {root,dispose:()=>{content.replaceChildren();bytes=null;}};
  };

  const pdfViewer = async (bytes, signal) => {
    await ensureWorker();
    let worker=null, loading=null, pdf=null, renderTask=null, disposed=false, renderGeneration=0, page=1, scale=1;
    const dispose=()=>{disposed=true;renderGeneration++;signal.removeEventListener("abort",dispose);try{renderTask?.cancel();}catch(_){}try{loading?.destroy()?.catch(()=>{});}catch(_){}try{worker?.destroy();}catch(_){};};
    signal.addEventListener("abort",dispose,{once:true});
    if(signal.aborted){dispose();throw new Error("ssh-file-cancelled");}
    try {
      worker=new pdfjsLib.PDFWorker({name:"remote-file-"+id()});
      loading=pdfjsLib.getDocument({data:bytes,worker,isEvalSupported:false,disableFontFace:true,useSystemFonts:false,maxImageSize:25000000,
        disableAutoFetch:true,disableStream:true,stopAtErrors:true});
      const protectedPdf=new Promise((_,reject)=>{loading.onPassword=()=>{dispose();reject(new Error("암호화된 PDF는 다운로드해서 열어 주세요."));};});
      pdf=await deadline(Promise.race([loading.promise,protectedPdf]),15000,dispose);
      const root=el("div"), tools=el("div","","ssh-file-tools"), area=el("div","","ssh-file-canvas-area"), status=el("div","","ssh-file-note");
      const prev=button("이전 페이지"), next=button("다음 페이지"), minus=button("−"), plus=button("+"), label=el("span");
      const render=async(first=false)=>{
        const generation=++renderGeneration;
        try{
          renderTask?.cancel();
          const pdfPage=await deadline(pdf.getPage(page),10000,dispose);
          if(disposed||generation!==renderGeneration)return;
          const natural=pdfPage.getViewport({scale:1});
          const safeScale=Math.min(scale,Math.sqrt(8000000/(natural.width*natural.height)),8192/natural.width,8192/natural.height);
          if(!Number.isFinite(safeScale)||safeScale<=0)throw new Error("PDF 페이지 크기를 확인하지 못했습니다.");
          const viewport=pdfPage.getViewport({scale:safeScale}), canvas=el("canvas");
          canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);canvas.setAttribute("aria-label","PDF "+page+"페이지");
          renderTask=pdfPage.render({canvasContext:canvas.getContext("2d"),viewport});
          await deadline(renderTask.promise,15000,dispose);
          if(disposed||generation!==renderGeneration)return;
          area.replaceChildren(canvas);label.textContent=page+" / "+pdf.numPages+" · "+Math.round(safeScale*100)+"%";
          prev.disabled=page<=1;next.disabled=page>=pdf.numPages;status.textContent="읽기 전용 · 링크·첨부·스크립트는 실행하지 않습니다.";
          pdfPage.cleanup();
        }catch(error){
          if(first)throw error;
          if(error.name!=="RenderingCancelledException")status.textContent="PDF 표시 실패. 다운로드로 확인하세요. "+policy.errorText(error);
        }
      };
      prev.onclick=()=>{if(page>1){page--;render();}};next.onclick=()=>{if(page<pdf.numPages){page++;render();}};
      minus.onclick=()=>{scale=Math.max(0.25,scale/1.25);render();};plus.onclick=()=>{scale=Math.min(4,scale*1.25);render();};
      tools.append(prev,next,minus,plus,label);root.append(tools,status,area);await render(true);
      return {root,dispose:()=>{dispose();area.replaceChildren();}};
    }catch(error){dispose();throw error;}
  };

  const create = ({getSession,getDirectory=()=>"",onVisibility,onBusy}) => {
    const panel=el("section","","ssh-file-panel");panel.hidden=true;
    const heading=el("div","","ssh-file-heading"), identity=el("strong","원격 파일"), close=button("터미널로 돌아가기");
    heading.append(identity,close);
    const grid=el("div","","ssh-file-grid"), path=el("input"), secret=el("input"), resolved=el("div","","ssh-file-path");
    path.type="text";path.autocomplete="off";path.spellcheck=false;path.maxLength=4096;
    path.placeholder="예: /home/student/result.png";
    secret.type="password";secret.autocomplete="off";secret.maxLength=16384;secret.setAttribute("data-lpignore","true");
    const secretField=field("파일 연결 인증",secret);
    grid.append(field("원격 파일 경로",path),secretField);
    const directoryHint=el("div","","ssh-file-note");
    const note=el("p","Bash 접속에서는 현재 폴더를 자동으로 채웁니다. 뒤에 파일명을 입력하세요. 직접 수정한 경로는 유지하며, 입력칸을 비우면 자동 경로를 다시 사용합니다. 파일은 원래 연결한 서버·계정에서 읽으므로 다른 SSH·sudo·컨테이너 안의 경로는 직접 확인하세요.","ssh-file-note");
    const actions=el("div","","ssh-file-tools"), preview=button("미리보기"), download=button("다운로드…"), refresh=button("새로고침"), cancel=button("작업 취소");
    actions.append(preview,download,refresh,cancel);cancel.hidden=true;
    const status=el("div","","ssh-file-status"), progress=el("progress"), meta=el("div","","ssh-file-meta"), viewport=el("div","","ssh-file-preview");
    status.setAttribute("role","status");status.setAttribute("aria-live","polite");progress.max=100;progress.hidden=true;
    panel.append(heading,grid,directoryHint,resolved,note,actions,status,progress,meta,viewport);
    let peerId="", peerSession="", currentJob="", generation=0, busy=false, action="", viewer=null, previewData=null, rendering=null;
    let automaticPath=true, automaticValue="";
    const authUi=()=>{
      const session=getSession(); secretField.hidden=!!peerId;
      secretField.firstElementChild.textContent=session.authentication==="private-key" ? "파일 연결 키 암호 (암호화된 키만)" : "파일 연결 SSH 비밀번호";
      secret.placeholder=session.authentication==="private-key" ? "암호 없는 키는 비워 두세요" : "별도 파일 연결에 다시 입력";
    };
    const setBusy = value => {
      busy=value;preview.disabled=download.disabled=refresh.disabled=path.disabled=secret.disabled=value;
      cancel.hidden=!value; progress.hidden=!value; if(value)progress.removeAttribute("value");
      onBusy(value && action==="download");
      if(!value)updateDirectory();
    };
    const updatePath=()=>{
      if(!path.value){resolved.textContent="/로 시작하는 전체 경로를 입력하세요. 예: /home/student/result.png";return;}
      try{resolved.textContent="확인 경로: "+policy.resolvePath(path.value);}catch(error){resolved.textContent=policy.errorText(error);}
    };
    const updateDirectory=()=>{
      const directory=getDirectory();
      directoryHint.textContent=directory ? "자동 감지한 현재 폴더: "+directory
        : "현재 폴더 자동 감지 대기 중입니다. 지원하지 않는 셸에서는 전체 파일 경로를 직접 입력하세요.";
      // Also preserve values set by autofill or other input methods that omit an input event.
      if(path.value!==automaticValue && path.value!=="")automaticPath=false;
      if(!busy && automaticPath){path.value=directory;automaticValue=directory;}
      updatePath();
    };
    path.oninput=()=>{automaticPath=path.value==="";if(automaticPath)automaticValue="";updateDirectory();};
    const abandonPeer=()=>{const old=peerId;peerId="";peerSession="";if(old)post("disconnect",[old]).catch(()=>{});authUi();};
    const waitJob=async(op,values,epoch)=>{
      const requestId=id();currentJob=requestId;
      let result;
      try{result=await post(op,values,requestId);}
      catch(error){
        // Recover a lost start response without creating another connection or save dialog.
        try{result=await (await http("/ssh-file-job?id="+requestId)).json();}
        catch(_){post("cancel",[requestId]).catch(()=>{});throw error;}
      }
      let failures=0;
      while(true){
        if(epoch!==generation){post("cancel",[requestId]).catch(()=>{});if(op==="connect"&&result.peerId)post("disconnect",[result.peerId]).catch(()=>{});if(op==="inspect")release(result.fileId);release(requestId);throw new Error("ssh-file-cancelled");}
        if(op==="connect" && result.peerId && result.connected){peerId=result.peerId;peerSession=getSession().id;}
        // A failed authentication never leaves a reusable connection ID or a hidden credential field.
        if(result.connected===false){peerId="";peerSession="";authUi();}
        const labels={waiting:"요청 준비 중…",authenticating:"파일 연결 인증 중…",inspecting:"파일 정보 확인 중…",reading:"파일을 가져오는 중…",choosing:"Windows 저장창에서 위치를 선택하세요.",saving:"파일 저장 중…"};
        if(!result.done)status.textContent=labels[result.state]||"처리 중…";
        if(result.state==="reading"){
          status.textContent+=" "+policy.formatBytes(result.bytes)+" / "+policy.formatBytes(result.total);
          if(Number(result.total)>0)progress.value=Math.min(100,Number(result.bytes)/Number(result.total)*100);
        }
        if(result.done){currentJob="";if(result.state==="failed"||result.state==="cancelled")throw new Error(result.error||"ssh-file-cancelled");return result;}
        await new Promise(resolve=>setTimeout(resolve,350));
        try{result=await (await http("/ssh-file-job?id="+requestId)).json();failures=0;}
        catch(error){if(++failures>=3){post("cancel",[requestId]).catch(()=>{});throw error;}status.textContent="파일 상태 확인 재시도 "+failures+"/3";}
      }
    };
    const run=async(mode,usePrevious=false)=>{
      if(busy)return;
      const session=getSession();if(!session.id){status.textContent="먼저 SSH 서버에 접속하세요.";return;}
      const epoch=++generation, renderAbort=new AbortController();rendering=renderAbort;action=mode;setBusy(true);
      let newViewer=null, previewJob="", fileToRelease="";
      try{
        const requestedPath=usePrevious&&previewData ? previewData.path : policy.resolvePath(path.value);
        if(peerSession!==session.id)abandonPeer();
        if(!peerId){
          const password=secret.value;secret.value="";
          if(session.authentication!=="private-key"&&!password)throw new Error("파일 연결 SSH 비밀번호를 입력하세요.");
          const opened=await waitJob("connect",[session.id,password],epoch);peerId=opened.peerId;peerSession=session.id;authUi();
        }
        const info=await waitJob("inspect",[peerId,requestedPath],epoch);
        fileToRelease=info.fileId;
        if(mode==="download"){
          const chosen=await waitJob("save-pick",[info.fileId],epoch);
          await waitJob("download",[info.fileId,chosen.id],epoch);
          status.textContent="다운로드 완료 · "+info.path+" · "+policy.formatBytes(info.size);
        }else{
          const data=await waitJob("preview",[info.fileId],epoch);previewJob=data.id;
          if(data.kind==="unsupported"||data.kind==="too-large")newViewer={root:el("p",data.kind==="too-large"?"미리보기 크기 제한을 넘었습니다. 원본 다운로드를 이용하세요.":"이 형식은 미리보기를 지원하지 않습니다. 다운로드를 이용하세요."),dispose:()=>{}};
          else{
            const response=await http("/ssh-file-content?id="+data.id), bytes=new Uint8Array(await deadline(response.arrayBuffer(),15000,()=>{}));
            if(bytes.byteLength>30*1024*1024)throw new Error("미리보기 크기 제한을 넘었습니다.");
            if(data.kind==="image")newViewer=await imageViewer(bytes,renderAbort.signal);
            else if(data.kind==="pdf")newViewer=await pdfViewer(bytes,renderAbort.signal);
            else newViewer=textViewer(bytes,data);
          }
          if(epoch!==generation){newViewer.dispose();newViewer=null;return;}
          viewer?.dispose();viewer=newViewer;newViewer=null;viewport.replaceChildren(viewer.root);previewData=data;
          meta.textContent=data.path+" · "+policy.formatBytes(data.size)+" · "+new Date(data.readAt).toLocaleTimeString()+"에 읽음"+(data.partial?" · 앞부분만 표시":"");
          status.textContent="미리보기 준비 완료. 원격 파일은 변경하지 않습니다.";
        }
      }catch(error){
        if(epoch===generation){
          status.textContent=(mode==="preview"&&viewer?"새로고침 실패 — 이전 내용 유지. ":"")+policy.errorText(error);
          if(/ssh-file-(closed|expired|authentication|protocol|io|timeout|cancelled)/.test(String(error.message)))abandonPeer();
        }
      }finally{
        release(previewJob);release(fileToRelease);newViewer?.dispose();
        if(epoch===generation){currentJob="";secret.value="";setBusy(false);authUi();}
      }
    };
    const cancelWork=()=>{
      if(!busy)return;
      generation++;const job=currentJob;currentJob="";
      rendering?.abort();rendering=null;
      if(job)post("cancel",[job]).catch(()=>{});
      abandonPeer();secret.value="";setBusy(false);status.textContent="취소 요청을 보냈습니다. 불완전한 파일은 저장하지 않습니다.";
    };
    const hide=()=>{
      if(busy&&action!=="download")cancelWork();
      panel.hidden=true;secret.value="";viewer?.dispose();viewer=null;previewData=null;viewport.replaceChildren();meta.textContent="";
      onVisibility(false);
    };
    const reset=()=>{cancelWork();abandonPeer();hide();path.value="";automaticValue="";automaticPath=true;};
    const show=()=>{
      panel.hidden=false;identity.textContent="원격 파일 · "+getSession().identity;authUi();onVisibility(true);updateDirectory();
      if(!busy)setTimeout(()=>path.focus(),0);
    };
    preview.onclick=()=>run("preview");download.onclick=()=>run("download");refresh.onclick=()=>run("preview",true);cancel.onclick=cancelWork;close.onclick=hide;
    path.onkeydown=event=>{if(event.key==="Enter"){event.preventDefault();run("preview");}};
    panel.addEventListener("keydown",event=>{if(event.key==="Escape"){event.stopPropagation();hide();}});
    return {panel,show,hide,reset,updateDirectory,cancel:cancelWork};
  };
  return {create};
})();
