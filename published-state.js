'use strict';
// Render can serve the durable snapshot committed by the existing local updater.
// No cloud-side random generation or reliance on Render's ephemeral disk.
const fs=require('node:fs');
const path=require('node:path');
const {atomicWrite,sha}=require('./official-data');
const {stateDir,readRecord,validateRecord}=require('./tracking');
const FILE=path.join(__dirname,'published-state.json');

function publishState(data,performance,{dir=stateDir(),file=FILE}={}) {
  const folder=path.join(dir,'recommendations');
  const records=fs.existsSync(folder)?fs.readdirSync(folder).filter(f=>/^\d+\.json$/.test(f)).map(f=>readRecord(path.join(folder,f))).sort((a,b)=>a.target.id-b.target.id):[];
  const payload={schemaVersion:1,publishedAt:new Date().toISOString(),drawsHash:data.drawsHash,records,performance};
  atomicWrite(file,{...payload,checksum:sha(JSON.stringify(payload))});
}
function loadPublished(data,file=FILE) {
  const value=JSON.parse(fs.readFileSync(file,'utf8'));
  const {checksum,...payload}=value;
  if(payload.schemaVersion!==1||payload.drawsHash!==data.drawsHash||checksum!==sha(JSON.stringify(payload))) throw Error('צילום המעקב אינו תואם לתוצאות; נדרש פרסום מחדש מהמחשב');
  payload.records.forEach(validateRecord);
  return payload;
}
function publishedRecommendation(data,{file=FILE,now=new Date()}={}) {
  const state=loadPublished(data,file),target=data.nextDraw;
  if(!target||Date.parse(target.cutoffAt)<=now.getTime())return null;
  const record=state.records.find(r=>r.target.id===target.id);
  if(!record || record.target.date!==target.date)return null;
  return {record,line1:record.strategy[0],line2:record.strategy[1],analysis:record.analysis,target,createdAt:record.createdAt,mode:'paper'};
}
module.exports={publishState,loadPublished,publishedRecommendation};
