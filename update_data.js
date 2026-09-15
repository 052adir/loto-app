'use strict';
const {refreshDataset} = require('./official-data');
async function update() {
  const data=await refreshDataset();
  console.log(`Validated ${data.draws.length} official draws; latest #${data.draws[0]._id} (${data.draws[0].date}).`);
  const {getRecommendation, performanceReport}=require('./tracking');
  if(data.nextDraw) {
    const rec=getRecommendation(data);
    console.log(`Paper recommendation saved for #${rec.record.target.id}; no ticket purchased.`);
  } else console.log('No verified open draw; no recommendation generated.');
  const report=await performanceReport(data);
  require('./published-state').publishState(data,report);
  console.log(JSON.stringify(report.summary,null,2));
  return data;
}
if(require.main===module) update().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={update};
