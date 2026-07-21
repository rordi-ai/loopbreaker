export function renderApp(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Loopbreaker</title>
  <style>
    :root { color-scheme: dark; --ink:#eef0ea; --muted:#a3aa9e; --line:#343a34; --panel:#171b18; --green:#84d69a; --red:#ff8b7d; --amber:#f2c66d; --blue:#7ec8e3; }
    * { box-sizing:border-box } body { margin:0; background:#0d100e; color:var(--ink); font:15px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; }
    main { max-width:1180px; margin:auto; padding:32px 20px 72px; } h1,h2,h3,p { margin-top:0 } h1 { font-size:28px; letter-spacing:-1px; margin-bottom:4px; }
    .eyebrow,.muted { color:var(--muted) } .top { display:flex; justify-content:space-between; gap:24px; align-items:flex-start; margin-bottom:24px; }
    select,button { font:inherit; color:var(--ink); background:#222722; border:1px solid #464d46; border-radius:7px; padding:9px 11px; }
    button { cursor:pointer } button:hover { border-color:var(--blue) } .decision { border:1px solid var(--line); background:var(--panel); border-radius:12px; padding:20px; display:grid; grid-template-columns:1fr auto; gap:16px; margin-bottom:18px; }
    .badge { align-self:start; border:1px solid currentColor; border-radius:99px; padding:6px 10px; font-weight:700; text-transform:uppercase; }
    .hold { color:var(--red) } .ship { color:var(--green) } .ship_with_debt { color:var(--amber) }
    .grid { display:grid; grid-template-columns:1.2fr .8fr; gap:18px; } section { border:1px solid var(--line); background:var(--panel); border-radius:12px; padding:18px; }
    .node { position:relative; border:1px solid var(--line); border-radius:9px; padding:13px; margin-top:10px; background:#111512; }
    .node::before { content:""; position:absolute; left:-19px; top:22px; width:18px; border-top:1px solid var(--line); }
    .row { display:flex; align-items:center; justify-content:space-between; gap:12px; } .tiny { font-size:12px; color:var(--muted) }
    .status { font-size:12px; text-transform:uppercase; } .verified { color:var(--green) } .pending,.failed { color:var(--red) } .waived { color:var(--amber) }
    .timeline { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-top:18px; } .pass { min-height:130px; } .pass.empty { border-style:dashed; color:var(--muted); }
    .evidence { border-left:3px solid var(--blue) } .finding { border-left:3px solid var(--red) } .actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:14px; }
    #notice { min-height:22px; color:var(--blue); margin-top:10px; } @media(max-width:760px){.grid,.timeline,.decision{grid-template-columns:1fr}.top{display:block}select{width:100%;margin-top:12px}}
  </style>
</head>
<body><main>
  <div class="top"><div><div class="eyebrow">LOCAL REVIEW GRAPH</div><h1>Loopbreaker</h1><p class="muted">Stop reviewing when review converges. Ship only when the behavior contract permits it.</p></div><select id="issues" aria-label="Issue"></select></div>
  <div id="app"><p>Loading…</p></div>
</main>
<script>
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let active;
async function json(url, options) { const response = await fetch(url, options); const body = await response.json(); if (!response.ok) throw new Error(body.error?.message || 'Request failed'); return body; }
async function loadIssues() { const issues = await json('/api/issues'); const select=document.querySelector('#issues'); select.innerHTML=issues.map(i=>'<option value="'+esc(i.id)+'">'+esc(i.id)+' — '+esc(i.title)+'</option>').join(''); if(issues[0]) { active=issues[0].id; select.value=active; await load(); } }
async function load() { const s=await json('/api/issues/'+encodeURIComponent(active)+'/substrate'); render(s); }
function render(s) {
 const reviewLabel=s.review.complete?'review complete':'next: '+s.review.next_action.replaceAll('_',' ');
 const behaviors=s.behaviors.map(b=>'<div class="node"><div class="row"><strong>'+esc(b.id)+'</strong><span class="status '+b.status+'">'+esc(b.status)+(b.enforced?' · enforced':' · advisory')+'</span></div><div>'+esc(b.title)+'</div><div class="tiny"><b>WHEN</b> '+esc(b.trigger)+'</div><div class="tiny"><b>EXPECT</b> '+esc(b.expected)+'</div><div class="tiny"><b>PROVE</b> '+esc(b.verify)+'</div><div class="tiny">evidence: '+(b.evidence_ids.length?b.evidence_ids.map(esc).join(', '):'none')+(b.waiver_id?' · waiver: '+esc(b.waiver_id):'')+'</div></div>').join('');
 const evidence=s.evidence.map(e=>'<div class="node evidence"><div class="row"><strong>'+esc(e.id)+'</strong><span class="tiny">'+esc(e.tier)+' / '+esc(e.verdict)+'</span></div><div>'+esc(e.summary)+'</div><div class="tiny">'+esc(e.behavior_id||'issue-level')+'</div></div>').join('')||'<p class="muted">No evidence recorded.</p>';
 const findings=s.findings.map(f=>'<div class="node finding"><div class="row"><strong>'+esc(f.severity)+' · '+esc(f.id)+'</strong><span class="tiny">'+esc(f.status)+'</span></div><div>'+esc(f.title)+'</div><div class="tiny">smallest fix: '+esc(f.smallest_fix||'not recorded')+'</div></div>').join('')||'<p class="muted">No findings.</p>';
 const passes=[1,2,3].map(n=>{ const p=s.review_passes.find(x=>x.pass_number===n); return p?'<div class="node pass"><div class="row"><strong>PASS '+n+'</strong><span class="status '+(p.verdict==='pass'?'verified':'failed')+'">'+esc(p.verdict)+'</span></div><div class="tiny">'+esc(p.kind.replaceAll('_',' '))+(p.legacy_pass_count?' · compresses '+p.legacy_pass_count+' legacy passes':'')+'</div><p>'+esc(p.summary)+'</p></div>':'<div class="node pass empty"><strong>PASS '+n+'</strong><p>'+['comprehensive','repair verification','decision only'][n-1]+'</p></div>'; }).join('');
 const actions=[]; if(s.review.next_pass===2) actions.push('<button data-action="pass2">Record repair pass</button>'); if(s.review.next_pass===3) actions.push('<button data-action="pass3">Record decision pass</button>'); if(s.shipping.unresolved_behavior_ids.length) { actions.push('<button data-action="prove">Add wired proof</button>'); actions.push('<button data-action="waive">Accept named debt</button>'); }
 document.querySelector('#app').innerHTML='<div class="decision"><div><div class="eyebrow">'+esc(s.issue.id)+' · '+esc(reviewLabel)+'</div><h2>'+esc(s.issue.title)+'</h2><p>'+esc(s.shipping.reason)+'</p><div class="actions">'+actions.join('')+'</div><div id="notice"></div></div><div class="badge '+s.shipping.disposition+'">'+esc(s.shipping.disposition.replaceAll('_',' '))+'</div></div><div class="grid"><section><h2>Frozen acceptance contract</h2><p class="muted">Behavior children are the boundary. Enforced unless explicitly advisory.</p>'+behaviors+'</section><section><h2>Attributable proof</h2>'+evidence+'<h2 style="margin-top:20px">Findings</h2>'+findings+'</section></div><section style="margin-top:18px"><div class="row"><h2>Bounded review</h2><span class="tiny">automatic pass 4: false</span></div><div class="timeline">'+passes+'</div></section>';
 document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>act(button.dataset.action)));
}
async function act(action) { const notice=document.querySelector('#notice'); notice.textContent='Applying…'; try { await json('/api/issues/'+encodeURIComponent(active)+'/actions/'+action,{method:'POST'}); await load(); } catch(error) { notice.textContent=error.message; } }
document.querySelector('#issues').addEventListener('change',event=>{active=event.target.value;load()}); loadIssues().catch(error=>document.querySelector('#app').textContent=error.message);
</script></body></html>`;
}
