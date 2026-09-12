const fs=require('fs');
const change=(file,edits)=>{let s=fs.readFileSync(file,'utf8');for(const [a,b] of edits){if(!s.includes(a))throw new Error('Missing anchor: '+file+' '+a);s=s.replace(a,b);}fs.writeFileSync(file,s);};
change('src/js/jeju-bus-map.js',[
 ['start=button("지도에 표시"),stop=button("끄기"),fit=button','start=button("지도에 표시"),fit=button'],
 ['start.disabled=true;stop.disabled=true;fit.disabled=true;refresh.disabled=true;actions.append(start,stop,fit,refresh);','start.disabled=true;fit.disabled=true;refresh.disabled=true;actions.append(start,fit,refresh);'],
 ['stop.disabled=true;fit.disabled=true;toggle.setAttribute','fit.disabled=true;toggle.title=t("제주 버스 노선을 선택해 실시간 위치를 봅니다.");toggle.setAttribute'],
 ['toggle.addEventListener("click",()=>{panel.hidden=!panel.hidden;toggle.setAttribute("aria-expanded",String(!panel.hidden));if(!panel.hidden)input.focus();});',
  'toggle.addEventListener("click",()=>{\n      if(on){stopLive();panel.hidden=true;}\n      else panel.hidden=!panel.hidden;\n      toggle.setAttribute("aria-expanded",String(!panel.hidden));if(!panel.hidden)input.focus();\n    });'],
 ['stop.disabled=false;fit.disabled=false;toggle.setAttribute','fit.disabled=false;toggle.title=t("제주 버스 표시 끄기");toggle.setAttribute'],
 ['stop.addEventListener("click",stopLive);fit.addEventListener','fit.addEventListener']
]);
change('src/js/i18n.js', [['    // 제주 버스 실시간 지도','    // 제주 버스 실시간 지도\n    "제주 버스 표시 끄기": "Turn off Jeju buses",']]);
change('사용법.md', [['**노선 전체 보기**로 지도 범위를 다시 맞추고 **끄기**로 조회와 표시를 끝냅니다. 패널의 **닫기**는 패널만 접습니다.',
 '**노선 전체 보기**로 지도 범위를 다시 맞춥니다. 표시가 켜져 있을 때 편집 도구의 **🚌 제주 버스** 버튼을 다시 누르면 버스·노선 표시와 조회가 꺼지고 패널도 닫힙니다. 패널 안에는 별도의 끄기 버튼이 없습니다. 패널의 **닫기**는 버스 표시를 유지한 채 패널만 접습니다.']]);
change('docs/제주버스-실시간지도-설계.md', [['지도 도구막대에 `🚌 제주 버스` 버튼을 추가하고, 누르면 작은 노선 선택 패널을 연다.',
 '지도 도구막대의 `🚌 제주 버스`를 누르면 노선 선택 패널을 연다. 버스 표시가 켜진 상태에서 다시 누르면 조회·버스·노선 표시를 끄고 패널도 닫는다. 패널에는 별도의 끄기 버튼을 두지 않는다. 패널의 닫기는 패널만 접는다.']]);
change('tests/jeju-bus-controller.test.js',[
 ['start:actions.children[0],stop:actions.children[1],status:panel.children[5]','panel,actions,start:actions.children[0],status:panel.children[5]'],
 ['h.tick(31000);const last=h.pending.at(-1);h.doc.cleanupFns.forEach(fn=>fn());\n  assert.equal(last.request.options.signal.aborted,true);assert.equal(h.intervals.size,0);assert.equal(h.frames.size,0);\n  last.task.resolve(body("2",h.now()));await flush();assert.equal(h.groups[0].items.length,0);',
 'h.tick(31000);const last=h.pending.at(-1);\n  assert.equal(h.actions.children.some(button=>button.textContent==="끄기"),false);\n  assert.equal(h.button.attrs["aria-pressed"],"true");h.button.click();\n  assert.equal(last.request.options.signal.aborted,true);assert.equal(h.button.attrs["aria-pressed"],"false");\n  assert.equal(h.button.attrs["aria-expanded"],"false");assert.equal(h.panel.hidden,true);\n  assert.equal(h.groups[0].items.length,0);assert.equal(h.groups[1].items.length,0);assert.equal(h.frames.size,0);\n  const requestCount=h.pending.length;h.tick(60000);assert.equal(h.pending.length,requestCount);\n  last.task.resolve(body("2",h.now()));await flush();assert.equal(h.groups[0].items.length,0);\n  h.button.click();assert.equal(h.panel.hidden,false);h.start.click();assert.equal(h.button.attrs["aria-pressed"],"true");\n  const restarted=h.pending.at(-1);h.doc.cleanupFns.forEach(fn=>fn());\n  assert.equal(restarted.request.options.signal.aborted,true);assert.equal(h.intervals.size,0);\n  restarted.task.resolve(body("2",h.now()));await flush();assert.equal(h.groups[0].items.length,0);']
]);
