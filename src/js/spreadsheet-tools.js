"use strict";

// Excel 파일의 왕복 저장과 편집에 쓰는 DOM 없는 공용 연산.
const MNSpreadsheetTools = (() => {
  const clone = value => value == null ? value : structuredClone(value);
  const formula = () => typeof MNSpreadsheetFormula !== "undefined" ? MNSpreadsheetFormula : require("./spreadsheet-formula.js");
  function inputValue(text, numberFormat){
    if (typeof text !== "string") return text;
    if (numberFormat === "@") return text;
    if (text.startsWith("'")) return text.slice(1);
    const t = text.trim();
    if (!t) return "";
    if (/^[+-]?0\d+$/.test(t)) return text;
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%$/i.test(t)) return Number(t.slice(0,-1)) / 100;
    if (/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(t)) return Number(t.replace(/,/g,""));
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(t)){
      const digits = t.replace(/^[+-]|\.|^0+/g, "").split(/e/i)[0].length;
      const n = Number(t);
      return isFinite(n) && digits <= 15 ? n : text;
    }
    const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(t);
    if (match){
      const [, y, m, d] = match.map(Number);
      const date = new Date(y, m - 1, d);
      if (date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d) return date;
    }
    return text;
  }
  function validationFor(cell){
    if(cell.validation?.type==="list" && cell.dv?.values && cell.validation.formulae?.[0]==='"'+cell.dv.values.join(",")+'"')return clone(cell.validation);
    if (cell.dv && cell.dv.values) return { type:"list", allowBlank:true, showErrorMessage:true, errorStyle:"stop",
      errorTitle:"목록 값 필요", error:"목록에서 값을 선택하세요.", formulae:['"' + cell.dv.values.join(",") + '"'] };
    return clone(cell.validation || null);
  }
  function writeValidation(ws, cell, snapshot){
    if (ws.dataValidations && ws.dataValidations.model) delete ws.dataValidations.model[cell.address];
    const validation = validationFor(snapshot);
    if (validation && validation.type) cell.dataValidation = validation;
  }
  function readConditionalRules(ws){
    const out = [];
    const color = c => c && c.argb ? "#" + c.argb.slice(-6) : null;
    const ops = { greaterThanOrEqual:"ge", greaterThan:"gt", lessThanOrEqual:"le", lessThan:"lt", equal:"eq", notEqual:"ne", between:"between" };
    for (const group of ws.conditionalFormattings || []){
      for (const ref of String(group.ref || "").split(/\s+/)){
        const pair = ref.split(":").map(r => formula().parseA1Ref(r));
        if (!pair[0]) continue;
        const a = pair[0], b = pair[1] || a;
        for (const raw of group.rules || []){
          const rule = { kind:"unsupported", range:{s:{r:a.r,c:a.c},e:{r:b.r,c:b.c}}, native:clone(raw) };
          const fill = color(raw.style && raw.style.fill && (raw.style.fill.fgColor || raw.style.fill.bgColor));
          const fontColor = color(raw.style && raw.style.font && raw.style.font.color);
          if (raw.type === "cellIs" && ops[raw.operator] && (raw.formulae || []).every(v => String(v).trim() !== "" && isFinite(Number(v)))){
            Object.assign(rule,{kind:"highlight",op:ops[raw.operator],value:raw.formulae[0],value2:raw.formulae[1],fill,fontColor});
          } else if (raw.type === "containsText" && ["containsText","notContainsText"].includes(raw.operator)){
            Object.assign(rule,{kind:"highlight",op:raw.operator === "containsText" ? "contains" : "notcontains",value:raw.text,fill,fontColor});
          } else if (["colorScale","dataBar"].includes(raw.type) && raw.cfvo && raw.cfvo.length === 2 && raw.cfvo[0].type === "min" && raw.cfvo[1].type === "max"){
            if (raw.type === "colorScale" && Array.isArray(raw.color) && raw.color.length === 2 && raw.color.every(color))
              Object.assign(rule,{kind:"colorscale",minColor:color(raw.color[0]),maxColor:color(raw.color[1])});
            else if (raw.type === "dataBar" && color(raw.color)) Object.assign(rule,{kind:"databar",barColor:color(raw.color)});
          }
          out.push(rule);
        }
      }
    }
    return out;
  }
  function remapStructure(text, home, target, change){
    const f = formula();
    let tokens;
    try { tokens = f.tokenizeFormula(text); } catch(_){ return text; }
    const same = (a,b) => String(a).toLowerCase() === String(b).toLowerCase();
    const deleted = [...new Set(change.deleted || [])].sort((a,b)=>a-b);
    const axis = change.axis;
    const map = value => deleted.length
      ? (deleted.includes(value) ? null : value - deleted.filter(d => d < value).length)
      : value + (value >= change.at ? (change.count || 1) : 0);
    const rewrite = (token, coordinate) => {
      const ref = f.parseA1Ref(token.text);
      if (!ref) return token.text;
      const m = /^(\$?)[A-Za-z]+(\$?)\d+$/.exec(token.text);
      if (coordinate == null) return "#REF!";
      ref[axis] = coordinate;
      return m[1] + f.spreadsheetColumnName(ref.c) + m[2] + (ref.r + 1);
    };
    const out = [];
    for (let i=0; i<tokens.length; i++){
      let sheet = home, prefix = "";
      if (tokens[i+1] && tokens[i+1].text === "!" && tokens[i+2]){
        sheet = tokens[i].type === "sheetq" ? tokens[i].text.slice(1,-1).replace(/''/g,"'") : tokens[i].text;
        prefix = tokens[i].text + "!"; i+=2;
      }
      const a = tokens[i], b = tokens[i+1] && tokens[i+1].text === ":" ? tokens[i+2] : null;
      if(a.type==="colrange" && axis==="c" && same(sheet,target)){
        const ends=a.text.split(":"),indices=ends.map(v=>f.formulaColumnIndex(v.replace("$","")));
        let lo=Math.min(...indices),hi=Math.max(...indices);
        while(lo<=hi && deleted.includes(lo))lo++;
        while(hi>=lo && deleted.includes(hi))hi--;
        if(lo>hi)out.push(prefix+"#REF!");
        else {
          const reverse=indices[0]>indices[1];
          out.push(prefix+ends.map((v,j)=>(v.startsWith("$")?"$":"")+f.spreadsheetColumnName(map((j===0)!==reverse?lo:hi))).join(":"));
        }
        continue;
      }
      if (a.type !== "ref" || !same(sheet,target)){
        out.push(prefix+a.text);
        if (b && b.type === "ref"){ out.push(":"+b.text); i+=2; }
        continue;
      }
      const pa = f.parseA1Ref(a.text);
      if (b && b.type === "ref"){
        const pb = f.parseA1Ref(b.text);
        let lo = Math.min(pa[axis],pb[axis]), hi = Math.max(pa[axis],pb[axis]);
        if (deleted.length){
          while (lo<=hi && deleted.includes(lo)) lo++;
          while (hi>=lo && deleted.includes(hi)) hi--;
        }
        if (lo>hi) out.push(prefix+"#REF!");
        else {
          const reverse = pa[axis]>pb[axis];
          out.push(prefix+rewrite(a,map(reverse?hi:lo))+":"+rewrite(b,map(reverse?lo:hi)));
        }
        i+=2;
      } else out.push(prefix+rewrite(a,map(pa[axis])));
    }
    return out.join("");
  }
  function stableSort(rows, levels){
    const compare = (a,b) => {
      const av = a instanceof Date ? a.getTime() : a, bv = b instanceof Date ? b.getTime() : b;
      if (typeof av === "number" && typeof bv === "number") return av-bv;
      return String(av == null ? "" : av).localeCompare(String(bv == null ? "" : bv),undefined,{numeric:true,sensitivity:"base"});
    };
    return rows.map((row,index)=>({row,index})).sort((a,b)=>{
      for (const level of levels){
        const av=a.row[level.col]?.v, bv=b.row[level.col]?.v;
        const ae=av==null||av==="", be=bv==null||bv==="";
        const cmp=ae!==be ? (ae?1:-1) : compare(av,bv)*(level.dir||1);
        if(cmp) return cmp;
      }
      return a.index-b.index;
    });
  }

  function validationError(value, rule, listValues){
    if(!rule || !rule.type || rule.type==="any")return "";
    if(rule.showErrorMessage===false || ["warning","information"].includes(rule.errorStyle))return "";
    if((value==="" || value==null) && rule.allowBlank)return "";
    if(rule.type==="list"){
      const inline=rule.formulae && /^"([\s\S]*)"$/.exec(String(rule.formulae[0]));
      const list=inline?inline[1].split(","):listValues;
      if(!Array.isArray(list))return "";
      return list.some(x=>String(x).toLowerCase()===String(value).toLowerCase())?"":"목록에 없는 값입니다.";
    }
    if(!["whole","decimal","date","textLength"].includes(rule.type))return "";
    const n=rule.type==="textLength"?String(value??"").length:value instanceof Date?formula().spreadsheetDateSerial(value):value;
    if(typeof n!=="number" || !isFinite(n) || (rule.type==="whole" && !Number.isInteger(n)))return "허용된 입력 형식이 아닙니다.";
    const [a,b]=(rule.formulae || []).map(v=>Number(v));
    if(!Number.isFinite(a))return "";
    const good={between:n>=a&&n<=b,notBetween:n<a||n>b,equal:n===a,notEqual:n!==a,greaterThan:n>a,lessThan:n<a,greaterThanOrEqual:n>=a,lessThanOrEqual:n<=a}[rule.operator || "between"];
    return good===false?"입력한 값이 허용 범위를 벗어났습니다.":"";
  }
  function duplicateRows(model,bounds){
    const seen=new Set(),removed=[];
    for(let r=bounds.s.r;r<=bounds.e.r;r++){
      const values=[];
      for(let c=bounds.s.c;c<=bounds.e.c;c++){
        const v=model[r]?.[c]?.v;
        values.push(v instanceof Date?["date",v.getTime()]:[typeof v,typeof v==="string"?v.toLocaleLowerCase():v??""]);
      }
      const key=JSON.stringify(values);
      if(seen.has(key))removed.push(r);else seen.add(key);
    }
    return removed;
  }
  function pivotGrid(rows,groupCols,valueCols,agg,columnCol=-1){
    const groups=new Map(),columns=[],columnSet=new Set();
    const keyOf=v=>JSON.stringify(v.map(x=>[typeof x,x??""]));
    for(const row of rows){
      const keys=groupCols.map(c=>row[c]??""),key=keyOf(keys);
      if(!groups.has(key))groups.set(key,{keys,buckets:new Map()});
      const column=columnCol<0?"":row[columnCol]??"",ck=keyOf([column]);
      if(!columnSet.has(ck)){columnSet.add(ck);columns.push({key:ck,label:column});}
      const buckets=groups.get(key).buckets;
      if(!buckets.has(ck))buckets.set(ck,valueCols.map(()=>[]));
      valueCols.forEach((c,i)=>buckets.get(ck)[i].push(row[c]));
    }
    const aggregate=items=>{
      if(agg==="count")return items.length;
      const nums=items.map(v=>typeof v==="number"?v:inputValue(String(v??""))).filter(v=>typeof v==="number" && isFinite(v));
      const sum=nums.reduce((a,b)=>a+b,0);
      if(agg==="sum")return sum;if(agg==="avg")return nums.length?sum/nums.length:0;
      return nums.length?(agg==="min"?Math.min(...nums):Math.max(...nums)):0;
    };
    return {columns,rows:[...groups.values()].map(group=>[...group.keys,...columns.flatMap(col=>valueCols.map((_,i)=>aggregate(group.buckets.get(col.key)?.[i] || [])))])};
  }


  const settingsPath="customXml/classdock-spreadsheet.json";
  function readSettings(bytes){
    try{
      const Zip=typeof JSZip!=="undefined"?JSZip:require("../../vendor/jszip.min.js");
      const zip=new Zip(bytes),part=zip.file(settingsPath);
      if(!part)return {};
      const text=part.asText();if(text.length>2000000)return {};
      const settings=JSON.parse(text);
      return settings && settings.type==="ClassDockSpreadsheet" && settings.version===1 && settings.sheets && typeof settings.sheets==="object"?settings.sheets:{};
    }catch(_){return {};}
  }
  function writeSettings(bytes,sheets){
    const Zip=typeof JSZip!=="undefined"?JSZip:require("../../vendor/jszip.min.js");
    const zip=new Zip(bytes);
    zip.file(settingsPath,JSON.stringify({type:"ClassDockSpreadsheet",version:1,sheets}));
    const types=zip.file("[Content_Types].xml").asText();
    if(!types.includes('/'+settingsPath))zip.file("[Content_Types].xml",types.replace("</Types>",'<Override PartName="/'+settingsPath+'" ContentType="application/json"/></Types>'));
    const rels=zip.file("_rels/.rels").asText();
    if(!rels.includes(settingsPath))zip.file("_rels/.rels",rels.replace("</Relationships>",'<Relationship Id="rIdClassDockSettings" Type="https://classdock.local/relationships/spreadsheet-settings" Target="'+settingsPath+'"/></Relationships>'));
    return zip.generate({type:"uint8array",compression:"DEFLATE"});
  }



  function renameTableReferences(text,tableName,replacements,local=false,newTableName=tableName){
    return String(text).split(/("(?:[^"]|"")*")/).map((part,i)=>{
      if(i%2)return part;
      return part.replace(/([A-Za-z_][A-Za-z0-9_.]*)?\[(?:@\[(.*?)\]|(@?)([^\[\]]+))\]/g,(whole,name,nested,at,column)=>{
        if(name?name.toLowerCase()!==tableName.toLowerCase():!local)return whole;
        const old=nested??column,next=replacements.get(String(old).toLowerCase())??old;
        return (name?newTableName:"")+"["+(nested!=null?"@["+next+"]":(at || "")+next)+"]";
      });
    }).join("");
  }

  function expandReferences(text,home,row,tables,names=[],col=null){
    const f=formula(),qualified=(sheet,ref)=>"'"+String(sheet).replace(/'/g,"''")+"'!"+ref;
    const all=Object.entries(tables).flatMap(([sheet,list])=>(list || []).map(table=>({...table,sheet})));
    const local=all.find(t=>t.sheet===home && row>=t.range.s.r && row<=t.range.e.r && (col==null || (col>=t.range.s.c && col<=t.range.e.c)));
    let expanded=String(text).split(/("(?:[^"]|"")*")/).map((part,i)=>{
      if(i%2)return part;
      return part.replace(/([A-Za-z_][A-Za-z0-9_.]*)?\[(?:@\[(.*?)\]|(@?)([^\[\]]+))\]/g,(whole,name,nested,at,column)=>{
        const table=name?all.find(t=>t.name.toLowerCase()===name.toLowerCase()):local;
        if(!table)return whole;
        const col=(table.columns || []).findIndex(c=>String(c).toLowerCase()===String(nested??column).toLowerCase());
        if(col<0)return whole;
        const c=table.range.s.c+col,letter="$"+f.spreadsheetColumnName(c);
        if(nested!=null || at==="@")return qualified(table.sheet,letter+(row+1));
        const first=table.range.s.r+(table.headerRow===false?0:1),last=table.range.e.r-(table.totalsRow?1:0);
        if(last<first)return "#REF!";
        return qualified(table.sheet,letter+"$"+(first+1)+":"+letter+"$"+(last+1));
      });
    }).join("");
    if(names.length){
      let tokens;try{tokens=f.tokenizeFormula(expanded);}catch(_){return expanded;}
      expanded=tokens.map((t,i)=>{
        if(t.type!=="name" || ["(","!"].includes(tokens[i+1]?.text) || tokens[i-1]?.text==="!")return t.text;
        const named=names.find(n=>String(n.Name).toLowerCase()===t.text.toLowerCase() && (n.Sheet==null || n.home===home));
        return named?"("+String(named.Ref).replace(/^=/,"")+")":t.text;
      }).join("");
    }
    return expanded;
  }


  function customFunctionDefinition(name,parameters,body,names=[],original=null){
    const f=formula(),key=String(name).trim(),params=String(parameters).trim()?String(parameters).split(",").map(x=>x.trim()):[];
    const expression=String(body).trim().replace(/^=/,"");
    if(!f.formulaIdentifier(key) || f.SPREADSHEET_FN_HELP.some(fn=>fn[0]===key.toUpperCase()) || key.toUpperCase()==="AVG")
      return {error:"함수 이름은 한글·영문·밑줄로 시작하고 셀 주소나 기존 함수 이름과 겹치지 않아야 합니다."};
    if(names.some(n=>n!==original && (n.Sheet??null)===(original?.Sheet??null) && String(n.Name).toUpperCase()===key.toUpperCase()))
      return {error:"같은 이름의 함수 또는 이름 범위가 있습니다."};
    if(params.length>253 || params.some(p=>!f.formulaIdentifier(p,true)) || new Set(params.map(p=>p.toUpperCase())).size!==params.length)
      return {error:"입력값 이름은 중복 없이 쉼표로 구분하세요. 셀 주소, R, C, 마침표는 사용할 수 없습니다."};
    if(!expression || expression.length>10000)return {error:"계산식을 1~10,000자로 입력하세요."};
    const definition={Name:key,Ref:"LAMBDA("+[...params,expression].join(",")+")"};
    let ast;try{ast=f.parseFormula(definition.Ref);}catch(_){return {error:"계산식의 괄호·쉼표·연산자를 확인하세요."};}
    const lookup=target=>{
      const item=target===key.toUpperCase()?definition:names.find(n=>String(n.Name).toUpperCase()===target);
      if(!item)return null;try{return f.parseFormula(String(item.Ref).replace(/^=/,""));}catch(_){return null;}
    };
    if(!f.formulaIsSupported(ast,lookup))return {error:"계산식에 등록되지 않은 이름이나 현재 지원하지 않는 함수가 있습니다."};
    return {definition};
  }
  function writeDefinedNames(bytes,names){
    const Zip=typeof JSZip!=="undefined"?JSZip:require("../../vendor/jszip.min.js");
    const zip=new Zip(bytes),part=zip.file("xl/workbook.xml");if(!part)return bytes;
    const escape=value=>String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    let xml=part.asText();
    const previous=/<definedNames\b[^>]*>([\s\S]*?)<\/definedNames>/.exec(xml);
    // ExcelJS가 새 인쇄 설정으로 만든 시스템 이름은 그대로 둔다.
    const system=(previous?.[1].match(/<definedName\b[^>]*>[\s\S]*?<\/definedName>/g) || []).filter(entry=>/\bname="_xlnm\./i.test(entry));
    const definitions=(names || []).filter(n=>n.Name && n.Ref && !/^_xlnm\./i.test(n.Name)).map(n=>{
      const scope=Number.isInteger(n.Sheet)?' localSheetId="'+n.Sheet+'"':"";
      const comment=n.Comment?' comment="'+escape(n.Comment)+'"':"";
      const hidden=n.Hidden?' hidden="1"':"";
      return '<definedName name="'+escape(n.Name)+'"'+scope+comment+hidden+'>'+escape(formula().excelFormula(n.Ref))+'</definedName>';
    });
    const block=system.length || definitions.length?"<definedNames>"+system.join("")+definitions.join("")+"</definedNames>":"";
    if(previous)xml=xml.replace(previous[0],()=>block);
    else if(/<definedNames\b[^>]*\/>/.test(xml))xml=xml.replace(/<definedNames\b[^>]*\/>/,()=>block);
    else xml=xml.replace(/<\/sheets>/,match=>match+block);
    zip.file("xl/workbook.xml",xml);
    return zip.generate({type:"uint8array",compression:"DEFLATE"});
  }

  return { customFunctionDefinition,writeDefinedNames,renameTableReferences,expandReferences,readSettings,writeSettings,validationError, duplicateRows, pivotGrid, inputValue, validationFor, writeValidation, readConditionalRules, remapStructure, stableSort };
})();
if (typeof module === "object" && module.exports) module.exports = MNSpreadsheetTools;
