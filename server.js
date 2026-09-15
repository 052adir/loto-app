'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {currentDataset,loadDataset}=require('./official-data');
const {getRecommendation,performanceReport}=require('./tracking');
const {loadPublished,publishedRecommendation}=require('./published-state');
const {generateRecommendations,formatWhatsAppMessage}=require('./analyze');
const VERSION=require('./package.json').version;
const {compareRecommendation}=require('./odds');
const API_HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript','.json':'application/json','.svg':'image/svg+xml'};
function createServer({
  snapshotMode=(process.env.RENDER==='true'||process.env.LOTTO_READONLY_SNAPSHOT==='1')&&!process.env.LOTTO_STATE_DIR,
  dataset=snapshotMode?loadDataset:currentDataset,
  recommend=snapshotMode?publishedRecommendation:getRecommendation,
  report=snapshotMode?(data=>loadPublished(data).performance):performanceReport
}={}) {
  return http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/api/version' && req.method==='GET') {res.writeHead(200,API_HEADERS);res.end(JSON.stringify({version:VERSION}));return;}
    if(url.pathname.startsWith('/api/')) {
      if(req.method!=='GET'){res.writeHead(405,API_HEADERS);res.end(JSON.stringify({error:'Method not allowed'}));return;}
      try {
        const data=await dataset();
        let result;
        if(url.pathname==='/api/analyze') {
          const rec=recommend(data);
          result={version:VERSION,...(rec||{}),odds:compareRecommendation(rec),analysis:rec?.analysis||generateRecommendations(structuredClone(data.draws)).analysis,performance:await report(data),dataUpdatedAt:data.fetchedAt,source:data.source,available:!!rec,storageMode:snapshotMode?'published-snapshot':'persistent-local',notice:rec?'ההמלצה נשמרה לבדיקה על הנייר. רענון אינו משנה את הטורים.':'אין כרגע המלצה שמורה להגרלה פתוחה. ממתינים לעדכון הבא.'};
        } else if(url.pathname==='/api/recommend') {
          const rec=recommend(data);
          if(!rec){res.writeHead(409,API_HEADERS);res.end(JSON.stringify({error:'אין כרגע הגרלה פתוחה ומאומתת'}));return;}
          result={...rec,message:formatWhatsAppMessage(rec)};
        } else if(url.pathname==='/api/performance') result=await report(data);
        else if(url.pathname==='/api/draws') result=data.draws.slice(0,Math.max(1,Math.min(200,parseInt(url.searchParams.get('limit'),10)||20)));
        else {res.writeHead(404,API_HEADERS);res.end(JSON.stringify({error:'Not found'}));return;}
        res.writeHead(200,API_HEADERS);res.end(JSON.stringify(result));
      } catch(e){res.writeHead(503,API_HEADERS);res.end(JSON.stringify({error:e.message}));}
      return;
    }
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(!['index.html','sw.js','manifest.json','icons/icon-192.svg','icons/icon-512.svg'].includes(name)){res.writeHead(404);res.end('Not found');return;}
    try {
      const body=fs.readFileSync(path.join(__dirname,'public',name));
      res.writeHead(200,{'Content-Type':MIME[path.extname(name)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(body);
    } catch{res.writeHead(404);res.end('Not found');}
  });
}
if(require.main===module) {
  const port=Number(process.env.PORT)||3000;
  createServer().listen(port,()=>console.log(`Lotto paper tracking: http://localhost:${port}`));
}
module.exports={createServer};
