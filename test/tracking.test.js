'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {validateDraws,sha,parseCSV,parseNextDraw,refreshDataset,parsePrizes}=require('../official-data');
const {getRecommendation,readRecord,evaluateRecord,performanceReport,summarize,lineKey}=require('../tracking');
const {createServer}=require('../server');
const {publishState,loadPublished,publishedRecommendation}=require('../published-state');
test('published snapshot survives without the local journal and never creates a new draw',async t=>{
  const dir=temp(t),data=dataset(),file=path.join(dir,'published.json');
  const rec=getRecommendation(data,{dir,now:now()});
  publishState(data,await performanceReport(data,{dir}),{dir,file});
  const before=fs.readFileSync(file,'utf8');
  assert.equal(publishedRecommendation(data,{file,now:now()}).record.checksum,rec.record.checksum);
  assert.equal(loadPublished(data,file).performance.summary.pendingDraws,1);
  assert.equal(publishedRecommendation(data,{file,now:new Date(data.nextDraw.cutoffAt)}),null);
  assert.equal(fs.readFileSync(file,'utf8'),before);
  assert.throws(()=>loadPublished({...data,drawsHash:'different'},file));
});
test('official prize page matches CSV and preserves unpublished prizes as unknown',()=>{
  const html=fs.readFileSync(path.join(__dirname,'fixtures','3911.html'),'utf8');
  const actual={_id:3911,date:'2026-03-28',winNumbers:[2,3,8,9,10,11],strongNumber:2};
  const prizes=parsePrizes(html,actual);
  assert.equal(prizes['3'],10);
  assert.equal(Object.keys(prizes).length,8);
  assert.throws(()=>parsePrizes(html,{...actual,strongNumber:7}));
  assert.throws(()=>parsePrizes(html,{...actual,_id:3912}));
});
function dataset() {
  const draws=Array.from({length:100},(_,i)=>({_id:4000-i,date:new Date(Date.UTC(2026,0,1)-i*86400000).toISOString().slice(0,10),winNumbers:[1,2,3,4,5,6],strongNumber:1}));
  return {schemaVersion:1,source:'https://www.pais.co.il/Lotto/lotto_resultsDownload.aspx',fetchedAt:'2026-01-02T10:00:00Z',drawsHash:sha(JSON.stringify(draws)),draws,nextDraw:{id:4001,date:'2026-01-02',cutoffAt:'2026-01-02T20:45:00Z'}};
}
function temp(t){const d=fs.mkdtempSync(path.join(os.tmpdir(),'lotto-test-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}
const now=()=>new Date('2026-01-02T10:01:00Z');
test('reject duplicate balls, out-of-range strong, repeated IDs and gaps',()=>{
  const good=dataset().draws;validateDraws(good);
  for(const mutate of [d=>d[0].winNumbers[1]=1,d=>d[0].strongNumber=8,d=>d[0]._id=d[1]._id,d=>d.splice(2,1),d=>d[0].date='2026-02-30']){
    const d=structuredClone(good);mutate(d);assert.throws(()=>validateDraws(d));
  }
});
test('CSV uses all six actual columns and rejects duplicate numbers',()=>{
  const data=dataset();const csv='draw,date,1,2,3,4,5,6,strong\n'+data.draws.map(d=>[d._id,d.date.split('-').reverse().join('/'),...d.winNumbers,d.strongNumber].join(',')).join('\n');
  assert.deepEqual(parseCSV(csv,now()),data.draws);
  assert.throws(()=>parseCSV(csv.replace('1,2,3,4,5,6,1','1,1,3,4,5,6,1'),now()));
});
test('official holiday schedule: use next-event property, not stale identifier',()=>{
  const event={'@id':'https://www.pais.co.il/lotto/#next-event',identifier:'4000',startDate:'2026-01-04T22:45:00+02:00',additionalProperty:[{name:'מספר הגרלה',value:'4001'},{name:'סגירת מכירה',value:'יום ראשון, 04/01/2026 בשעה 22:45'}]};
  const html='<script type="application/ld+json">'+JSON.stringify({'@graph':[event]})+'</script>';
  assert.equal(parseNextDraw(html,4000,now()).id,4001);
  assert.equal(parseNextDraw(html,4000,new Date('2026-01-04T20:45:00Z')),null);
  assert.equal(parseNextDraw(html.replace('04/01/2026','05/01/2026'),4000,now()),null);
});
test('failed or malformed refresh never overwrites existing data',async t=>{
  const file=path.join(temp(t),'draws.json');fs.writeFileSync(file,'original');
  await assert.rejects(refreshDataset({file,fetcher:async()=>{throw Error('offline');},now:now()}));
  assert.equal(fs.readFileSync(file,'utf8'),'original');
  await assert.rejects(refreshDataset({file,fetcher:async()=>new Response('<html>error</html>'),now:now()}));
  assert.equal(fs.readFileSync(file,'utf8'),'original');
});
test('same draw is immutable across refreshes and separate processes',t=>{
  const dir=temp(t),data=dataset();
  const first=getRecommendation(data,{dir,now:now()});
  const second=getRecommendation(data,{dir,now:now()});
  assert.deepEqual(first,second);
  assert.notEqual(lineKey(first.record.strategy[0]),lineKey(first.record.strategy[1]));
  assert.notEqual(lineKey(first.record.baseline[0]),lineKey(first.record.baseline[1]));
  const script=`const {getRecommendation}=require(${JSON.stringify(path.resolve(__dirname,'../tracking'))});process.stdout.write(JSON.stringify(getRecommendation(${JSON.stringify(data)},{dir:${JSON.stringify(dir)},now:new Date('2026-01-02T10:01:00Z')})));`;
  assert.deepEqual(JSON.parse(execFileSync(process.execPath,['-e',script],{encoding:'utf8'})),first);
  assert.equal(getRecommendation(data,{dir,now:new Date(data.nextDraw.cutoffAt)}),null);
  const file=path.join(dir,'recommendations','4001.json');const corrupt=JSON.parse(fs.readFileSync(file));corrupt.strategy[0].strong=7;fs.writeFileSync(file,JSON.stringify(corrupt));assert.throws(()=>readRecord(file));
});
test('stale data and known outcomes cannot create a prospective record',t=>{
  const data=dataset(),dir=temp(t);
  assert.throws(()=>getRecommendation(data,{dir,now:new Date('2026-01-02T12:00:00Z')}));
  data.nextDraw.id=4000;assert.throws(()=>getRecommendation(data,{dir,now:now()}));
  assert.equal(fs.existsSync(path.join(dir,'recommendations')),false);
});
test('three hits qualify per line, never by combining two lines; unknown prizes stay null',()=>{
  const record={target:{id:9,date:'2026-01-02'},createdAt:'2026-01-01T10:00:00Z',pricePerLine:3,strategy:[{numbers:[1,2,3,7,8,9],strong:2},{numbers:[4,5,10,11,12,13],strong:1}],baseline:[{numbers:[1,2,7,8,9,10],strong:2},{numbers:[3,4,11,12,13,14],strong:2}]};
  const actual={_id:9,date:'2026-01-02',winNumbers:[1,2,3,4,5,6],strongNumber:1};
  const pending=evaluateRecord(record,actual);assert.equal(pending.strategy[0].prize,null);assert.equal(pending.baseline[0].prize,0);assert.equal(pending.baseline[1].prize,0);
  assert.equal(summarize([pending],0).strategy.netBeforeTax,null);
  const priced=evaluateRecord(record,actual,{'3':10});assert.equal(priced.strategy[0].prize,10);assert.equal(priced.strategy[1].prize,0);
  const s=summarize([priced],0);assert.equal(s.strategy.cost,6);assert.equal(s.baseline.cost,6);assert.equal(s.strategy.netBeforeTax,4);assert.equal(s.baseline.netBeforeTax,-6);assert.equal(s.baseline.maxDrawdown,6);
  assert.equal(evaluateRecord(record,{...actual,date:'2026-01-03'}).status,'schedule_changed');
});
test('newly saved recommendation waits for actual results; later loss settles without network',async t=>{
  const dir=temp(t),data=dataset();const rec=getRecommendation(data,{dir,now:now()});
  assert.equal((await performanceReport(data,{dir})).summary.pendingDraws,1);
  // Pick a six-number outcome with fewer than 3 hits in every recorded line.
  let numbers;
  outer:for(let start=1;start<=32;start++){const candidate=Array.from({length:6},(_,i)=>start+i);if([...rec.record.strategy,...rec.record.baseline].every(l=>l.numbers.filter(n=>candidate.includes(n)).length<3)){numbers=candidate;break outer;}}
  assert.ok(numbers,'a losing outcome must be available for this fixture');
  const actual={_id:4001,date:'2026-01-02',winNumbers:numbers,strongNumber:7};
  const report=await performanceReport({...data,draws:[actual,...data.draws]},{dir,fetcher:async()=>{throw Error('prizes unavailable');}});
  assert.equal(report.summary.evaluatedDraws,1);assert.equal(report.summary.pendingDraws,0);assert.equal(report.summary.strategy.cost,report.summary.baseline.cost);
  assert.equal(report.summary.strategy.payout,0);assert.equal(report.summary.baseline.payout,0);
});
test('saved record to winning result to verified prize page and cached settlement',async t=>{
  const dir=temp(t),data=dataset();const rec=getRecommendation(data,{dir,now:now()});
  const actual={_id:4001,date:'2026-01-02',winNumbers:rec.line1.numbers,strongNumber:rec.line1.strong};
  const levels={'6 + חזק':1000000,'6':100000,'5 + חזק':10000,'5':1000,'4 + חזק':100,'4':50,'3 + חזק':30,'3':10};
  const html='<div aria-label="מספר הגרלה 4001">02/01/2026</div><div aria-label="המספר החזק '+actual.strongNumber+'"></div><ol class="cat_data_info current">'+actual.winNumbers.map(n=>'<li><div tabindex="0">'+n+'</div></li>').join('')+'</ol><ol id="regularLottoList">'+Object.entries(levels).map(([level,value])=>'<li><div aria-label="רמת פרס '+level+'"></div><div aria-label="סכום זכייה '+value+' ₪"></div></li>').join('')+'</ol>';
  let calls=0;const options={dir,fetcher:async()=>{calls++;return new Response(html);}};
  const newer={...data,draws:[actual,...data.draws]};
  const result=await performanceReport(newer,options);
  assert.equal(result.results[0].strategy[0].prize,1000000);assert.equal(result.summary.strategy.cost,6);assert.equal(result.summary.baseline.cost,6);assert.equal(result.summary.missingPrizeDraws,0);
  const again=await performanceReport(newer,options);assert.equal(calls,1);assert.deepEqual(result,again);
  assert.equal(readRecord(path.join(dir,'recommendations','4001.json')).checksum,rec.record.checksum);
});
test('API returns the saved lines unchanged and keeps private files inaccessible',async t=>{
  const dir=temp(t),data=dataset();
  const server=createServer({dataset:async()=>data,recommend:d=>getRecommendation(d,{dir,now:now()}),report:d=>performanceReport(d,{dir})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const version=await(await fetch(base+'/api/version')).json();
  assert.equal(version.version,require('../package.json').version);
  const a=await(await fetch(base+'/api/analyze')).json();const b=await(await fetch(base+'/api/recommend')).json();
  assert.equal(a.version,version.version);
  assert.equal(a.available,true);assert.deepEqual(a.line2,b.line2);assert.equal(a.record.checksum,b.record.checksum);
  assert.equal((await fetch(base+'/.env')).status,404);assert.equal((await fetch(base+'/.lotto-data/recommendations/4001.json')).status,404);
  assert.equal((await fetch(base+'/api/notify',{method:'POST'})).status,405);
});

test('future policy is disjoint and existing legacy record stays immutable',t=>{
  const dir=temp(t),data=dataset();const rec=getRecommendation(data,{dir,now:now()});
  assert.equal(rec.record.algorithmVersion,'paper-disjoint-v2');
  assert.equal(rec.line1.numbers.filter(n=>rec.line2.numbers.includes(n)).length,0);
  assert.notEqual(rec.line1.strong,rec.line2.strong);
  const {checksum,...old}=rec.record;old.algorithmVersion='paper-v1';old.strategy[1]={numbers:[...old.strategy[0].numbers],strong:old.strategy[0].strong%7+1};
  const legacy={...old,checksum:sha(JSON.stringify(old))};const file=path.join(dir,'recommendations','4001.json');fs.writeFileSync(file,JSON.stringify(legacy));
  assert.deepEqual(getRecommendation(data,{dir,now:now()}).record,legacy);
});
test('disjoint random tickets are valid across all strong numbers',()=>{
  const {buildDisjointLine}=require('../analyze');
  for(let strong=1;strong<=7;strong++)for(let i=0;i<40;i++){
    const first={numbers:[1,2,3,35,36,37],strong},line=buildDisjointLine(first);
    assert.equal(new Set(line.numbers).size,6);assert.ok(line.numbers.every(n=>n>=1&&n<=37&&!first.numbers.includes(n)));
    assert.ok(line.strong>=1&&line.strong<=7);assert.notEqual(line.strong,strong);
  }
});
test('exact odds preserve jackpot and match independently enumerated counts',()=>{
  const {TOTAL,layouts}=require('../odds');assert.equal(TOTAL,16273488);assert.equal(layouts.length,13);
  assert.deepEqual(layouts[0].favorable,[1356068,280068,100268,16568,2618,386,14,2]);
  assert.deepEqual(layouts.find(r=>r.overlap===1&&r.sameStrong).favorable,[1338568,277168,100268,16568,2618,386,14,2]);
  for(const r of layouts){assert.equal(r.favorable[7],2);assert.ok(r.favorable[0]<=layouts[0].favorable[0]);}
});
