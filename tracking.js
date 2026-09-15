'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {sha,atomicWrite,parsePrizes,validateDraws}=require('./official-data');

function stateDir() {
  if(process.env.NODE_ENV==='production' && !process.env.LOTTO_STATE_DIR) {
    throw Error('נדרש LOTTO_STATE_DIR בכונן קבוע לשמירת ההמלצות בשרת');
  }
  return process.env.LOTTO_STATE_DIR || path.join(__dirname,'.lotto-data');
}
const lineKey=l=>[...l.numbers].sort((a,b)=>a-b).join(',')+'|'+l.strong;
function validateLines(lines) {
  if(!Array.isArray(lines)||lines.length!==2||new Set(lines.map(lineKey)).size!==2) throw Error('נדרשים שני טורים שונים');
  for(const l of lines) {
    if(l.numbers.length!==6||new Set(l.numbers).size!==6||l.numbers.some(n=>!Number.isInteger(n)||n<1||n>37)||!Number.isInteger(l.strong)||l.strong<1||l.strong>7) throw Error('טור לא תקין');
  }
}
function readRecord(file) {
  return validateRecord(JSON.parse(fs.readFileSync(file,'utf8')));
}
function validateRecord(value) {
  const {checksum,...record}=value;
  if(checksum!==sha(JSON.stringify(record))||record.schemaVersion!==1||record.mode!=='paper'||record.pricePerLine!==3) throw Error('יומן ההמלצות פגום; אין לחשב ממנו ביצועים');
  validateLines(record.strategy);
  validateLines(record.baseline);
  if(!Number.isFinite(Date.parse(record.createdAt))||!Number.isFinite(Date.parse(record.target.cutoffAt))||Date.parse(record.createdAt)>=Date.parse(record.target.cutoffAt)||record.sourceLastDrawId!==record.target.id-1) throw Error('המלצה אינה מתועדת לפני ההגרלה');
  return value;
}

// Publish a complete file only once, including across separate Node processes.
function createOnce(file, value) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=`${file}.${crypto.randomUUID()}.tmp`;
  try {
    const fd=fs.openSync(temp,'wx');
    try {fs.writeFileSync(fd,JSON.stringify(value,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    try {fs.linkSync(temp,file);}catch(e){if(e.code!=='EEXIST')throw e;}
  } finally {if(fs.existsSync(temp))fs.unlinkSync(temp);}
}

function getRecommendation(data,{dir=stateDir(),now=new Date()}={}) {
  const target=data.nextDraw;
  if(!target || !Number.isFinite(Date.parse(target.cutoffAt)) || Date.parse(target.cutoffAt)<=now.getTime()) return null;
  validateDraws(data.draws);
  if(target.id!==data.draws[0]._id+1||!Number.isFinite(Date.parse(data.fetchedAt))||now.getTime()-Date.parse(data.fetchedAt)>3600000||now.getTime()<Date.parse(data.fetchedAt)||sha(JSON.stringify(data.draws))!==data.drawsHash) throw Error('אין נתונים עדכניים ומאומתים להמלצה חדשה');
  const file=path.join(dir,'recommendations',`${target.id}.json`);
  if(!fs.existsSync(file)) {
    const analyzer=require('./analyze');
    const rec=analyzer.generateRecommendations(structuredClone(data.draws));
    const strategy=[rec.line1,rec.line2];
    validateLines(strategy);
    const baseline=[analyzer.buildRandomLine()];
    do {baseline[1]=analyzer.buildRandomLine();}while(lineKey(baseline[0])===lineKey(baseline[1]));
    validateLines(baseline);
    const source=fs.readFileSync(path.join(__dirname,'analyze.js'),'utf8');
    const algorithmHash=sha(source);
    const record={schemaVersion:1,mode:'paper',createdAt:now.toISOString(),target,sourceLastDrawId:data.draws[0]._id,inputHash:data.drawsHash,algorithmVersion:'paper-disjoint-v2',algorithmHash,pricePerLine:3,strategy,baseline,analysis:rec.analysis};
    // Preserve the exact inputs used; neither record nor inputs are regenerated on refresh.
    createOnce(path.join(dir,'inputs',`${data.drawsHash}.json`),data);
    createOnce(path.join(dir,'algorithms',`${algorithmHash}.json`),{source});
    createOnce(file,{...record,checksum:sha(JSON.stringify(record))});
  }
  const record=readRecord(file);
  if(record.target.id!==target.id) throw Error('שיוך ההמלצה להגרלה שגוי');
  return {record,line1:record.strategy[0],line2:record.strategy[1],analysis:record.analysis,target,createdAt:record.createdAt,mode:'paper'};
}

function evaluateRecord(record,actual,prizes=null) {
  if(record.target.id!==actual._id) throw Error('מספר הגרלה שונה מההמלצה');
  if(record.target.date!==actual.date) return {drawId:actual._id,status:'schedule_changed',reason:'תאריך ההגרלה השתנה; יש לבדוק את התיעוד ידנית'};
  const score=line=>{
    const hits=line.numbers.filter(n=>actual.winNumbers.includes(n));
    const strongHit=line.strong===actual.strongNumber;
    const level=hits.length+(strongHit?' + חזק':'');
    const prize=hits.length<3?0:(prizes?.[level] ?? null);
    return {...line,hits,strongHit,prize};
  };
  const strategy=record.strategy.map(score),baseline=record.baseline.map(score);
  const complete=[...strategy,...baseline].every(l=>l.prize!==null);
  return {drawId:actual._id,date:actual.date,createdAt:record.createdAt,algorithmVersion:record.algorithmVersion,status:complete?'evaluated':'prizes_pending',strategy,baseline,costPerPolicy:record.pricePerLine*2,actual};
}

function summarize(results,pendingCount) {
  const evaluated=results.filter(r=>r.strategy);
  const fullyPriced=evaluated.filter(r=>r.status==='evaluated');
  function policy(key) {
    const lines=evaluated.flatMap(r=>r[key]);
    const cost=evaluated.reduce((s,r)=>s+r.costPerPolicy,0);
    const allPriced=fullyPriced.length===evaluated.length;
    const payout=allPriced?lines.reduce((s,l)=>s+l.prize,0):null;
    let balance=0,peak=0,maxDrawdown=0;
    if(allPriced)for(const r of evaluated){balance+=r[key].reduce((s,l)=>s+l.prize,0)-r.costPerPolicy;peak=Math.max(peak,balance);maxDrawdown=Math.max(maxDrawdown,peak-balance);}
    return {lines:lines.length,cost,payout,netBeforeTax:payout===null?null:payout-cost,maxDrawdown:allPriced?maxDrawdown:null,winningLines:lines.filter(l=>l.hits.length>=3).length,hitsHistogram:Array.from({length:7},(_,n)=>lines.filter(l=>l.hits.length===n).length)};
  }
  return {mode:'paper',evaluatedDraws:evaluated.length,pendingDraws:pendingCount,excludedDraws:results.filter(r=>!r.strategy).length,missingPrizeDraws:evaluated.length-fullyPriced.length,strategy:policy('strategy'),baseline:policy('baseline'),edgeProven:false};
}

async function performanceReport(data,{dir=stateDir(),fetcher=fetch}={}) {
  const folder=path.join(dir,'recommendations');
  const records=fs.existsSync(folder)?fs.readdirSync(folder).filter(f=>/^\d+\.json$/.test(f)).map(f=>readRecord(path.join(folder,f))).sort((a,b)=>a.target.id-b.target.id):[];
  const byId=new Map(data.draws.map(d=>[d._id,d]));
  const results=[];
  let pending=0;
  for(const record of records) {
    const actual=byId.get(record.target.id);
    if(!actual){pending++;continue;}
    let result=evaluateRecord(record,actual);
    if(result.status==='prizes_pending') {
      const url=`https://www.pais.co.il/lotto/currentlotto.aspx?lotteryId=${actual._id}`;
      const file=path.join(dir,'prizes',`${actual._id}.json`);
      try {
        let cached;
        if(fs.existsSync(file))cached=JSON.parse(fs.readFileSync(file,'utf8'));
        const fingerprint=sha(JSON.stringify(actual));
        let prizes;
        if(cached?.actualHash===fingerprint)prizes=parsePrizes(cached.html,actual);
        else {
          const response=await fetcher(url,{signal:AbortSignal.timeout(15000)});
          if(!response.ok)throw Error('טבלת הפרסים לא זמינה');
          const html=await response.text();
          prizes=parsePrizes(html,actual);
          atomicWrite(file,{actualHash:fingerprint,source:url,html,fetchedAt:new Date().toISOString()});
        }
        result=evaluateRecord(record,actual,prizes);
        result.prizeSource=url;
      } catch(e) {result.prizeError=e.message;}
    }
    results.push(result);
  }
  return {summary:summarize(results,pending),results,notice:'בדיקה על הנייר בלבד. הזכיות מחושבות לפי הפרס שפורסם לטור, לפני מס; סכום חסר אינו נחשב לאפס. זו אינה הוכחה ליתרון חיזוי.'};
}
module.exports={stateDir,lineKey,validateLines,getRecommendation,readRecord,validateRecord,evaluateRecord,summarize,performanceReport};
