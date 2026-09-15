'use strict';
// Exact counts for two tickets under the fair 6/37 + 1/7 draw model.
function choose(n,k){if(k<0||k>n)return 0;let v=1;for(let i=1;i<=k;i++)v=v*(n-i+1)/i;return Math.round(v);}
const TOTAL=choose(37,6)*7;
function layout(overlap,sameStrong) {
  const favorable=Array(8).fill(0);
  const rank=(hits,strong)=>hits<3?0:2*(hits-3)+1+Number(strong);
  for(let common=0;common<=overlap;common++)for(let a=0;a<=6-overlap;a++)for(let b=0;b<=6-overlap;b++){
    const weight=choose(overlap,common)*choose(6-overlap,a)*choose(6-overlap,b)*choose(25+overlap,6-common-a-b);
    if(!weight)continue;
    for(let strong=1;strong<=7;strong++){
      const best=Math.max(rank(common+a,strong===1),rank(common+b,strong===(sameStrong?1:2)));
      for(let i=0;i<best;i++)favorable[i]+=weight;
    }
  }
  return {overlap,sameStrong,favorable,probabilities:favorable.map(n=>n/TOTAL)};
}
const layouts=[];
for(let k=0;k<=6;k++)for(const same of [false,true])if(k!==6||!same)layouts.push(layout(k,same));
function compareRecommendation(rec) {
  const overlap=rec?rec.line1.numbers.filter(n=>rec.line2.numbers.includes(n)).length:null;
  const sameStrong=rec?rec.line1.strong===rec.line2.strong:null;
  return {totalOutcomes:TOTAL,layouts,best:layouts[0],current:rec?layouts.find(r=>r.overlap===overlap&&r.sameStrong===sameStrong):null,newPolicyActive:rec?.record.algorithmVersion==='paper-disjoint-v2'};
}
module.exports={choose,TOTAL,layouts,compareRecommendation};
