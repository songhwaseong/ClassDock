const fs=require('fs'),p='src/js/jeju-bus-map.js';let s=fs.readFileSync(p,'utf8');
s=s.replace('select.disabled=!result.length;','try { const saved=JSON.parse(localStorage.getItem("mapJejuBusRoute") || "null");\n          if(saved && saved.provider===MNJejuBusApi.provider && result.some(r=>r.id===saved.id))select.value=saved.id;\n        }catch(_){}\n        select.disabled=!result.length;');
s=s.replace('generation++;state=MNJejuBusLive.create();active=choice;', 'try{localStorage.setItem("mapJejuBusRoute",JSON.stringify({provider:MNJejuBusApi.provider,id:choice.id}));}catch(_){}\n      generation++;state=MNJejuBusLive.create();active=choice;');
fs.writeFileSync(p,s);
