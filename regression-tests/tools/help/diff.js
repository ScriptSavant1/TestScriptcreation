const a=require('./baseline.json'),b=require('./next.json');
// word-level diff per section (LCS on words)
function wdiff(x,y){const A=x.split(' '),B=y.split(' ');const n=A.length,m=B.length;const L=Array.from({length:n+1},()=>new Uint16Array(m+1));
for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)L[i][j]=A[i]===B[j]?L[i+1][j+1]+1:Math.max(L[i+1][j],L[i][j+1]);
const out=[];let i=0,j=0,del=[],ins=[];const flush=()=>{if(del.length||ins.length)out.push('  - '+del.join(' ')+'\n  + '+ins.join(' '));del=[];ins=[];};
while(i<n&&j<m){if(A[i]===B[j]){flush();i++;j++;}else if(L[i+1][j]>=L[i][j+1])del.push(A[i++]);else ins.push(B[j++]);}
while(i<n)del.push(A[i++]);while(j<m)ins.push(B[j++]);flush();return out;}
let total=0;
for(const s of a.sections){const t=b.sections.find(x=>x.id===s.id);if(!t){console.log('MISSING SECTION',s.id);total++;continue;}
 for(const k of ['title','sub']) if(s[k]!==t[k]){console.log(s.id,k,'changed:',s[k],'->',t[k]);total++;}
 const d=wdiff(s.text,t.text);if(d.length){console.log('\n'+s.id+':');d.forEach(x=>console.log(x));total+=d.length;}
 if(JSON.stringify(s.links)!==JSON.stringify(t.links)){console.log(s.id,'links differ');total++;}
 if(JSON.stringify(s.jumps)!==JSON.stringify(t.jumps)){console.log(s.id,'in-text jump links differ');total++;}}
console.log('\nchanges:',total,'| page intro same:',a.pageText===b.pageText,'| jumps landing correctly before:',a.jumps.filter(j=>j.open&&j.topVisible).length+'/13','after:',b.jumps.filter(j=>j.open&&j.topVisible).length+'/13','| page errors:',b.errors.length);
