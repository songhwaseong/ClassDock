const fs=require('fs');
const read=p=>fs.readFileSync(p,'utf8');
const write=(p,s)=>fs.writeFileSync(p,s,'utf8');
const replace=(s,a,b)=>{if(!s.includes(a))throw new Error('anchor missing: '+a.slice(0,100));return s.replace(a,b);};
let p='desktop/launcher.cs',s=read(p);
s=replace(s,'    static bool TryProxyMapTile(',read('.tmp/jeju-bus-backend.txt').replace(/^\uFEFF/,'')+'    static bool TryProxyMapTile(');
s=replace(s,'            if (path == "/can-proxy-subway" || path == "/subway-key-status") return true;',
'            if (path == "/can-proxy-jeju-bus" || path.StartsWith("/jeju-bus-", StringComparison.Ordinal)) return true;\n            if (path == "/can-proxy-subway" || path == "/subway-key-status") return true;');
const block=`                else if (method == "GET" && path == "/can-proxy-jeju-bus")
                {
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("yes"));
                }
                else if (method == "GET" && path.StartsWith("/jeju-bus-", StringComparison.Ordinal))
                {
                    int question = path.IndexOf('?');
                    string kind = (question < 0 ? path : path.Substring(0, question)).Substring("/jeju-bus-".Length);
                    string value = (QueryValue(path, kind == "routes" ? "keyword" : "routeId") ?? "").Trim();
                    if (!(kind == "routes" || kind == "route" || kind == "shape" || kind == "position") || !ValidJejuBusValue(kind, value))
                    { WriteResponse(stream, "400 Bad Request", "text/plain", Encoding.UTF8.GetBytes("bus-bad-request")); return; }
                    byte[] result; DateTime fetchedAt; bool stale; int retry;
                    if (TryJejuBus(kind, value, QueryValue(path, "refresh") == "1", out result, out fetchedAt, out stale, out retry))
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", result,
                            "X-ClassDock-Bus-Fetched-At: " + fetchedAt.ToString("o", CultureInfo.InvariantCulture) + "\\r\\n"
                            + "X-ClassDock-Bus-Stale: " + (stale ? "1" : "0") + "\\r\\n");
                    else WriteResponse(stream, "503 Service Unavailable", "text/plain", Encoding.UTF8.GetBytes("bus-fetch-failed"),
                        "Retry-After: " + retry.ToString(CultureInfo.InvariantCulture) + "\\r\\n");
                }
`;
s=replace(s,'                else if (method == "GET" && path == "/can-proxy-subway")',block+'                else if (method == "GET" && path == "/can-proxy-subway")');write(p,s);
p='desktop/build.bat';s=read(p);s=replace(s,'/r:System.Security.dll','/r:System.Security.dll /r:System.Web.Extensions.dll');write(p,s);
p='src/js/map-viewer.js';s=read(p);
s=replace(s,'  /* ── 되돌리기 ──','  const jejuBus = typeof MNJejuBusMap !== "undefined" ? MNJejuBusMap.mount({ map, stage, toolRow, doc, t:mapT }) : null;\n\n  /* ── 되돌리기 ──');
s=replace(s,'".map-network-notice", ".map-radius-panel"','".map-network-notice", ".map-radius-panel", ".map-jeju-bus-panel"');
s=replace(s,'  const captureMapPng = async () => {','  const captureMapPng = async () => {\n    const resume = jejuBus ? jejuBus.freeze() : () => {};\n    try { return await captureMapPngFrozen(); } finally { resume(); }\n  };\n  const captureMapPngFrozen = async () => {');
s=replace(s,'mapCaptureDataUrl(stage, mapAttributionText(model), labels)','mapCaptureDataUrl(stage, [mapAttributionText(model), jejuBus && jejuBus.captureNote()].filter(Boolean).join(" · "), labels)');write(p,s);
p='src/js/state.js';s=read(p);s=replace(s,'  { id:"mapSubway",','  { id:"mapJejuBus", label:"제주 버스", cls:"map-toolvis-jeju-bus", target:"map" },\n  { id:"mapSubway",');write(p,s);
p='scripts.manifest.json';const manifest=JSON.parse(read(p));const added=['jeju-bus-api.js','jeju-bus-live.js','jeju-bus-map.js'];
manifest.localScripts.splice(manifest.localScripts.indexOf('map-viewer.js'),0,...added);
for(const layer of manifest.applicationLayers)if(layer.scripts.includes('map-viewer.js'))layer.scripts.splice(layer.scripts.indexOf('map-viewer.js'),0,...added);
manifest.scriptDependencies['jeju-bus-map.js']=['jeju-bus-api.js','jeju-bus-live.js'];
manifest.scriptDependencies['map-viewer.js']=[...(manifest.scriptDependencies['map-viewer.js'] || []),'jeju-bus-map.js'];
write(p,JSON.stringify(manifest,null,2)+'\n');
p='classdock.html';s=read(p);s=replace(s,'<script src="src/js/map-viewer.js"></script>',added.map(f=>'<script src="src/js/'+f+'"></script>').join('\n')+'\n<script src="src/js/map-viewer.js"></script>');write(p,s);
p='src/styles.css';s=read(p);s=replace(s,'  html.hide-tool-mapSubway .map-toolvis-subway,','  html.hide-tool-mapJejuBus .map-toolvis-jeju-bus,\n  html.hide-tool-mapSubway .map-toolvis-subway,');
s+=`\n/* 제주 버스: 패널은 지도 편집 층이며 내보낼 때 감춘다. */
.map-jeju-bus-panel{position:absolute;top:12px;right:12px;z-index:1000;width:min(390px,calc(100% - 24px));max-height:calc(100% - 24px);overflow:auto;box-sizing:border-box;padding:14px;border:1px solid #98b9bd;border-radius:12px;background:var(--panel,#fff);color:var(--text,#172b33);box-shadow:0 5px 20px #0003;font:13px/1.5 sans-serif}
.map-jeju-bus-panel[hidden]{display:none}
.map-jeju-bus-heading,.map-jeju-bus-search,.map-jeju-bus-actions{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.map-jeju-bus-heading{justify-content:space-between}.map-jeju-bus-search input{flex:1;min-width:100px}
.map-jeju-bus-panel>select{width:100%;max-width:100%}.map-jeju-bus-preview{white-space:pre-wrap;max-height:120px;overflow:auto;font-size:12px;overflow-wrap:anywhere}
.map-jeju-bus-status{font-weight:600}.map-jeju-bus-note{font-size:12px;opacity:.8}.map-jeju-bus-panel a{color:#087f8c}
.map-jeju-bus-icon{display:inline-flex;align-items:center;gap:3px;padding:2px 5px;border:2px solid white;border-radius:8px;background:#087f8c;color:white;box-shadow:0 1px 4px #0006;font:bold 11px/18px sans-serif;white-space:nowrap}
.map-jeju-bus-number{display:none}.bus-wide-label .map-jeju-bus-number{display:inline}
.map-jeju-bus-marker.bus-relocated .map-jeju-bus-icon{animation:jejuBusAppear .7s ease-out}
@keyframes jejuBusAppear{from{opacity:.25}to{opacity:1}}
@media(prefers-reduced-motion:reduce){.map-jeju-bus-marker.bus-relocated .map-jeju-bus-icon{animation:none}}
`;
write(p,s);
