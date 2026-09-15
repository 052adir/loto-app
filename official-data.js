'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const CSV_URL = 'https://www.pais.co.il/Lotto/lotto_resultsDownload.aspx';
const LOTTO_URL = 'https://www.pais.co.il/lotto/';
// Keep only a documented period using the current 37/7 format and price.
const ERA_START = '2019-08-04';
const DATA_PATH = path.join(__dirname, 'public', 'draws.json');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function validateDraws(draws) {
  if (!Array.isArray(draws) || draws.length < 100) throw Error('מאגר ההגרלות חסר או קצר מדי');
  const ids = new Set();
  for (const d of draws) {
    if (!Number.isInteger(d._id) || ids.has(d._id) || !/^\d{4}-\d{2}-\d{2}$/.test(d.date) ||
        !Number.isFinite(Date.parse(d.date)) || new Date(d.date).toISOString().slice(0,10) !== d.date || d.date < ERA_START ||
        !Array.isArray(d.winNumbers) || d.winNumbers.length !== 6 || new Set(d.winNumbers).size !== 6 ||
        d.winNumbers.some(n => !Number.isInteger(n) || n < 1 || n > 37) ||
        !Number.isInteger(d.strongNumber) || d.strongNumber < 1 || d.strongNumber > 7) throw Error('נתוני הגרלה לא תקינים: ' + d._id);
    ids.add(d._id);
  }
  for (let i = 1; i < draws.length; i++) {
    if (draws[i-1]._id !== draws[i]._id + 1 || draws[i-1].date <= draws[i].date) throw Error('פער או סדר שגוי במאגר ההגרלות');
  }
  return draws;
}

function parseCSV(text, now = new Date()) {
  const rows = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/).slice(1);
  const draws = [];
  for (const row of rows) {
    if (!row.trim()) continue;
    const c = row.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
    if (!/^\d+$/.test(c[0]) || !/^\d{2}\/\d{2}\/\d{4}$/.test(c[1] || '')) throw Error('מבנה קובץ הפיס השתנה');
    const [day, month, year] = c[1].split('/');
    const date = `${year}-${month}-${day}`;
    if (date < ERA_START) continue;
    if (date > now.toISOString().slice(0,10)) throw Error('תוצאת הגרלה עם תאריך עתידי');
    draws.push({_id:Number(c[0]), date, winNumbers:c.slice(2,8).map(Number).sort((a,b)=>a-b), strongNumber:Number(c[8])});
  }
  return validateDraws(draws.sort((a,b)=>b._id-a._id));
}

function parseNextDraw(html, latestId, now = new Date()) {
  for (const match of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    let doc;
    try { doc = JSON.parse(match[1].replace(/\/\*[\s\S]*?\*\//g, '')); } catch { continue; }
    const event = (doc['@graph'] || []).find(e => String(e['@id']).endsWith('#next-event'));
    if (!event) continue;
    // Event.identifier on the source can contain the PREVIOUS draw number.
    const prop = name => (event.additionalProperty || []).find(p=>p.name===name)?.value;
    const id = Number(prop('מספר הגרלה'));
    const cutoff = event.startDate;
    const closing = prop('סגירת מכירה') || '';
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}):\d{2}[+-]\d{2}:\d{2}$/.exec(cutoff || '');
    if (id !== latestId+1 || !m || !Number.isFinite(Date.parse(cutoff)) ||
        new Date(cutoff.slice(0,10)).toISOString().slice(0,10)!==cutoff.slice(0,10) ||
        !closing.includes(`${m[3]}/${m[2]}/${m[1]}`) || !closing.includes(m[4])) return null;
    if (Date.parse(cutoff) <= now.getTime() || Date.parse(cutoff)-now.getTime() > 14*86400000) return null;
    return {id, date:cutoff.slice(0,10), cutoffAt:cutoff, source:LOTTO_URL};
  }
  return null;
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(value,null,2)); fs.renameSync(temp,file); }
  finally { if(fs.existsSync(temp)) fs.unlinkSync(temp); }
}

function loadDataset(file = DATA_PATH) {
  const data = JSON.parse(fs.readFileSync(file,'utf8'));
  if (data.schemaVersion !== 1 || data.source !== CSV_URL || !Number.isFinite(Date.parse(data.fetchedAt))) throw Error('נדרש עדכון למאגר הרשמי: npm run update');
  validateDraws(data.draws);
  if (data.drawsHash !== sha(JSON.stringify(data.draws))) throw Error('שלמות קובץ ההגרלות נפגעה');
  return data;
}

async function refreshDataset({file=DATA_PATH, fetcher=fetch, now=new Date()} = {}) {
  const [csv, home] = await Promise.all([
    fetcher(CSV_URL,{signal:AbortSignal.timeout(20000)}).then(async r=>{if(!r.ok)throw Error('לא ניתן להוריד תוצאות רשמיות');return new TextDecoder('windows-1255').decode(await r.arrayBuffer());}),
    fetcher(LOTTO_URL,{signal:AbortSignal.timeout(20000)}).then(async r=>{if(!r.ok)throw Error('לא ניתן לאמת את מועד ההגרלה');return r.text();})
  ]);
  const draws = parseCSV(csv,now);
  let previous;
  try { previous=loadDataset(file); } catch { /* first migration */ }
  if(previous && draws[0]._id < previous.draws[0]._id) throw Error('מקור התוצאות חזר לגרסה ישנה; הקובץ הקיים נשמר');
  const data={schemaVersion:1,source:CSV_URL,fetchedAt:now.toISOString(),eraStart:ERA_START,drawsHash:sha(JSON.stringify(draws)),nextDraw:parseNextDraw(home,draws[0]._id,now),draws};
  atomicWrite(file,data);
  return data;
}

let refreshPromise;
async function currentDataset() {
  let data;
  try { data=loadDataset(); } catch { /* migrate or recover through official download */ }
  const now=Date.now();
  if(data && now-Date.parse(data.fetchedAt)>=0 && now-Date.parse(data.fetchedAt)<3600000) return data;
  if(!refreshPromise) refreshPromise=refreshDataset().finally(()=>{refreshPromise=null;});
  return refreshPromise;
}

function parsePrizes(html, actual) {
  if (!html.includes(`מספר הגרלה ${actual._id}`) || !html.includes(actual.date.split('-').reverse().join('/'))) throw Error('עמוד הזכיות אינו תואם להגרלה');
  const numbersBlock=html.match(/<ol class="cat_data_info current"[\s\S]*?<\/ol>/)?.[0] || '';
  const nums=[...numbersBlock.matchAll(/<div tabindex="0">(\d+)<\/div>/g)].map(m=>+m[1]).sort((a,b)=>a-b);
  const strong=Number(html.match(/aria-label="המספר החזק (\d+)"/)?.[1]);
  if(JSON.stringify(nums)!==JSON.stringify(actual.winNumbers) || strong!==actual.strongNumber) throw Error('סתירה בין קובץ התוצאות לעמוד הזכיות');
  const block=html.match(/<ol id="regularLottoList"[\s\S]*?<\/ol>/)?.[0] || '';
  const result={};
  for(const item of block.matchAll(/<li\b[\s\S]*?<\/li>/g)) {
    const level=item[0].match(/aria-label="רמת פרס ([^"]+)"/)?.[1];
    const amount=item[0].match(/aria-label="סכום זכייה ([\d,]+) ₪"/)?.[1];
    if(level && amount!==undefined) result[level]=Number(amount.replaceAll(',','')) || null;
  }
  if(Object.keys(result).length!==8) throw Error('טבלת הפרסים חסרה');
  return result;
}

module.exports={CSV_URL,LOTTO_URL,DATA_PATH,ERA_START,sha,validateDraws,parseCSV,parseNextDraw,atomicWrite,loadDataset,refreshDataset,currentDataset,parsePrizes};
