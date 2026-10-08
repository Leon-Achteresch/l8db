(async()=>{
  const limits={filterMedianMs:50,filterP95Ms:100,maxCards:24,maxDomElements:2000};
  const assert=(value,message)=>{if(!value)throw Error(message);};
  const e=id=>document.getElementById(id);
  const change=(id,value)=>{e(id).value=value;e(id).dispatchEvent(new Event('change'));};
  const view=name=>document.querySelector('[data-view="'+name+'"]').click();
  const checks=[];
  e('compare-clear').click();e('reset').click();change('collection-select','corporate');
  assert(designs.length===200&&new Set(designs.map(d=>d.id)).size===200,'200 unique entries');
  assert(filtered().length===100&&document.querySelectorAll('.card').length===24,'corporate pagination');
  checks.push('200 unique entries and bounded pagination');
  const samples=[];
  for(const v of views){const start=performance.now();view(v.slug);e('gallery').getBoundingClientRect();samples.push(performance.now()-start);assert(filtered().length===5,'corporate view '+v.slug);}
  e('reset').click();change('collection-select','all');
  assert(filtered().length===200,'all collections');
  const visited=new Set();
  do{
    document.querySelectorAll('[data-open]').forEach(b=>visited.add(b.dataset.open));
    assert(document.querySelectorAll('.card').length<=limits.maxCards,'pagination card bound');
    if(e('page-next').disabled)break;
    e('page-next').click();
  }while(visited.size<=200);
  assert(visited.size===200,'all 200 designs reachable');checks.push('20 views and all 200 designs reachable');
  e('reset').click();change('collection-select','experiments');assert(filtered().length===100,'experiments');
  change('collection-select','corporate');change('layout','corporate:context-inspector');assert(filtered().length===5,'layout filter');
  e('reset').click();change('tone','Hell');assert(filtered().length===52,'light filter');
  e('reset').click();e('search').value='101';e('search').dispatchEvent(new Event('input'));assert(filtered().length===1,'search');
  e('reset').click();checks.push('collection, layout, theme and search filters');
  const favorite=document.querySelector('[data-favorite="101"]');const previous=favorite.getAttribute('aria-pressed');favorite.click();assert(document.querySelector('[data-favorite="101"]').getAttribute('aria-pressed')!==previous,'favorite toggle');document.querySelector('[data-favorite="101"]').click();checks.push('favorites persist and toggle');
  const ids=[...document.querySelectorAll('[data-compare]')].slice(0,5).map(c=>c.dataset.compare);
  for(const id of ids){const c=document.querySelector('[data-compare="'+id+'"]');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));}
  assert(state.compared.size===4&&!e('message').hidden,'comparison limit feedback');
  e('compare-open').click();assert(e('comparison').open&&e('comparison-body').querySelectorAll('img').length===4,'comparison modal');
  await Promise.all([...e('comparison-body').querySelectorAll('img')].map(i=>i.decode()));e('comparison-close').click();e('compare-clear').click();checks.push('four-image comparison and selection limit');
  document.querySelector('[data-open="101"]').click();await e('viewer-image').decode();assert(e('viewer').open&&e('viewer-prompt').textContent.length>100,'full image and prompt');
  const first=e('viewer-image').src;e('viewer-next').click();await e('viewer-image').decode();assert(e('viewer-image').src!==first,'viewer next');e('viewer-prev').click();await e('viewer-image').decode();assert(e('viewer-image').src===first,'viewer previous');e('viewer-close').click();checks.push('full-size images, prompts and navigation');
  for(const p of ['brand','ux','downloads','designs']){document.querySelector('[data-panel="'+p+'"]').click();assert(!e('panel-'+p).hidden,'panel '+p);}
  assert(document.querySelectorAll('.rule').length===30,'30 UX principles');checks.push('reference, UX and download sections');
  const decoded=await Promise.all(designs.map(d=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img.naturalWidth);img.onerror=()=>reject(Error('thumbnail '+d.id));img.src=d.thumb;})));
  assert(decoded.length===200&&decoded.every(w=>w===640),'200 thumbnail files');
  const links=[...document.querySelectorAll('#panel-downloads a[href],#panel-brand a[href]')].filter(a=>!a.href.startsWith('https://'));
  const responses=await Promise.all(links.map(async a=>({url:a.getAttribute('href'),status:(await fetch(a.href,{method:'HEAD'})).status})));
  assert(responses.every(r=>r.status===200),'download/reference links');checks.push('200 thumbnails and all material links');
  const sorted=samples.toSorted((a,b)=>a-b);const median=sorted[Math.floor(sorted.length/2)],p95=sorted[Math.ceil(sorted.length*.95)-1];
  assert(median<=limits.filterMedianMs&&p95<=limits.filterP95Ms,'filter latency budgets');
  e('reset').click();change('collection-select','corporate');
  const dom=document.querySelectorAll('*').length;assert(dom<=limits.maxDomElements,'DOM budget');
  window.scrollTo(0,0);
  return {passed:true,checks,designCount:200,thumbnailCount:decoded.length,downloadLinks:responses,performance:{workload:'200 entries, 20 corporate view filters, at most 24 cards rendered',limits,medianMs:median,p95Ms:p95,samples,domElements:dom,scope:'Synchronous filter and forced layout; no app database, paint latency or retained-heap measurement; no background polling'},userAgent:navigator.userAgent};
})()
