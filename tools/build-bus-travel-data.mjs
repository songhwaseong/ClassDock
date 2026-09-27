// 서울 OA-21217 일별 구간 운행시간 CSV(초)를 집계한다. 0은 관측 없음.
import fs from 'node:fs';
import readline from 'node:readline';
import crypto from 'node:crypto';
const [input, from, to] = process.argv.slice(2);
if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) throw new Error('Usage: node tools/build-bus-travel-data.mjs CSV YYYY-MM-DD YYYY-MM-DD');
const groups = new Map(), hash = crypto.createHash('sha256');
const stream = fs.createReadStream(input);
stream.on('data', bytes => hash.update(bytes));
const lines = readline.createInterface({input:stream, crlfDelay:Infinity});
let count = 0;
for await (const line of lines) {
  const values = line.replace(/^"|"$/g, '').split('\",\"');
  if (!/^\d{8}$/.test(values[0])) continue;
  if (values.length !== 31) throw new Error('Unexpected Seoul CSV columns');
  const day = values[0].replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  if (day < from || day > to) throw new Error('CSV date outside requested period');
  const [route, start, end] = values.slice(1,4), a=Number(values[29]), b=Number(values[30]);
  if (![route,start,end].every(v=>/^\d{9}$/.test(v)) || !Number.isInteger(a) || b!==a+1) continue;
  const key = [route,start,end,a,b].join(':');
  if (!groups.has(key)) groups.set(key,{route,start,end,a,b,sums:Array(25).fill(0),counts:Array(25).fill(0)});
  const group = groups.get(key);
  values.slice(4,29).forEach((value,i)=>{
    const seconds=Number(value);
    if (Number.isFinite(seconds) && seconds>0 && seconds<=7200) {group.sums[i]+=seconds;group.counts[i]++;}
  });
  count++;
}
const routes={};
for (const g of groups.values()) {
  const times=g.sums.map((sum,i)=>g.counts[i]?Math.round(sum/g.counts[i]):0);
  if (!times[0]) continue;
  (routes[g.route] ||= []).push([g.start,g.end,g.a,g.b,...times]);
}
for (const rows of Object.values(routes)) rows.sort((a,b)=>a[2]-b[2]);
const data={version:1,city:'11',unit:'seconds',from,to,source:'https://data.seoul.go.kr/dataList/OA-21217/S/1/datasetView.do',sourceSha256:hash.digest('hex'),routes};
const output='src/assets/bus-travel-seoul.json';
fs.writeFileSync(output,JSON.stringify(data));
console.log(JSON.stringify({output,records:count,routes:Object.keys(routes).length,sections:Object.values(routes).reduce((n,r)=>n+r.length,0),bytes:fs.statSync(output).size}));
