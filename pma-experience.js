'use strict';
(() => {
 const byId=id=>document.getElementById(id);
 const setText=(id,text)=>{const el=byId(id);if(el)el.textContent=text;};
 const scenarioData={
 water:{type:'POTENTIAL EMERGENCY · EXAMPLE ONLY',title:'Water leak reported',text:'Resident describes active water intrusion and affected area.',steps:['Resident safety instructions','Property owner escalation pathway','Maintenance contact pathway']},
 heat:{type:'URGENT SERVICE REQUEST · EXAMPLE ONLY',title:'Heating concern reported',text:'Resident describes heating loss, unit location and immediate circumstances.',steps:['Resident safety assessment','Property management escalation','Approved maintenance contact']},
 routine:{type:'NON-EMERGENCY REQUEST · EXAMPLE ONLY',title:'Routine repair requested',text:'Resident reports a non-urgent maintenance concern.',steps:['Resident receives intake guidance','Property team review queue','Maintenance scheduling request']}
 };
 const journeys={
 emergency:{title:'Emergency coordination',description:'A resident reports a potential emergency. The assistant follows approved safety guidance, captures relevant context and requests authorized escalation.',steps:['Identify safety and urgency','Capture property and incident details','Submit notifications to authorized contacts','Verify delivery or report uncertainty']},
 leasing:{title:'A more responsive leasing journey',description:'A prospective resident requests information about a property. The assistant uses approved, verified information and collects the next-step request.',steps:['Understand the leasing inquiry','Present verified property details','Capture a showing request','Wait for scheduling confirmation']},
 maintenance:{title:'Structured maintenance intake',description:'A resident describes a routine maintenance concern and receives clear next-step guidance.',steps:['Identify location and issue','Collect available access details','Submit a maintenance request','Confirm only an authoritative result']},
 resident:{title:'Resident service continuity',description:'A resident asks a common property question. The assistant follows approved policy and escalates when needed.',steps:['Identify the resident need','Consult approved property guidance','Answer within authorized scope','Refer exceptions to a property professional']}
 };
 const benefits={
 response:['Resident responsiveness','Offer a consistent, approved first response when property personnel are busy or unavailable.'],
 continuity:['Operating continuity','Maintain clearly defined intake and routing workflows across office hours, evenings and weekends.'],
 clarity:['Coordinated handoffs','Help the right person receive the context needed to assess an issue, while keeping submission and delivery confirmations distinct.'],
 staff:['Better use of staff time','Let technology support structured routine interactions so property teams can focus on people and exceptional circumstances.']
 };
 const solutions={
 resident:['SERVICE SYSTEM / RESIDENT ENGAGEMENT','Every resident interaction deserves a clear next step.','Provide helpful, policy-grounded responses to routine resident questions while directing complex needs to the appropriate team.','Approved responses · Defined escalation · Human oversight'],
 leasing:['SERVICE SYSTEM / LEASING ASSISTANCE','Every prospective resident is an opportunity to respond.','Explain verified listing details, gather the prospect\'s interests and submit showing requests without promising unconfirmed availability or tours.','Verified information · Prospect capture · Request-only scheduling'],
 maintenance:['SERVICE SYSTEM / MAINTENANCE','Turn issue descriptions into actionable intake.','Capture the maintenance issue, location, reported impact and supporting context for authorized staff and systems.','Structured information · Authoritative work-order readback'],
 emergency:['SERVICE SYSTEM / EMERGENCY COORDINATION','When Something Goes Wrong, Everyone Knows.','Follow configured safety guidance and coordinate the proposed resident, owner and maintenance notification pathways, with independent delivery and acknowledgment checks.','Request · Notification submission · Delivery proof · Acknowledgment'],
 oversight:['SERVICE SYSTEM / MANAGEMENT CONTROL','Keep your property team informed and in command.','Define approved answers, escalation policies, service permissions and human review requirements for each property and portfolio.','Property-specific rules · Responsible oversight · Verified outcomes']
 };
 function drawScenario(key){
 const d=scenarioData[key]; if(!d)return;
 setText('scenario-type',d.type);setText('scenario-title',d.title);setText('scenario-text',d.text);
 const list=byId('route-list');list.replaceChildren();
 d.steps.forEach((s,i)=>{const row=document.createElement('div');row.className='route';row.style.animationDelay=(i*90)+'ms';const no=document.createElement('b');no.textContent='0'+(i+1);const t=document.createElement('span');t.textContent=s;const arrow=document.createElement('span');arrow.textContent='↗';row.append(no,t,arrow);list.append(row);});
 document.querySelectorAll('[data-scenario]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.scenario===key)));
 }
 function drawJourney(key){
 const d=journeys[key];if(!d)return;setText('journey-title',d.title);setText('journey-description',d.description);
 const host=byId('journey-steps');if(!host)return;host.replaceChildren();
 d.steps.forEach((s,i)=>{const row=document.createElement('div');row.className='journey-step';row.style.animationDelay=(i*100)+'ms';const n=document.createElement('b');n.textContent='0'+(i+1);const t=document.createElement('span');t.textContent=s;const a=document.createElement('span');a.textContent='↗';row.append(n,t,a);host.append(row);});
 document.querySelectorAll('[data-journey]').forEach(b=>b.classList.toggle('active',b.dataset.journey===key));
 }
 function drawSolution(key){
 const d=solutions[key];if(!d)return;
 ['solution-kicker','solution-title','solution-copy','solution-proof'].forEach((id,i)=>setText(id,d[i]));
 document.querySelectorAll('[data-solution]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.solution===key)));
 }
 document.querySelectorAll('[data-scenario]').forEach(b=>b.addEventListener('click',()=>drawScenario(b.dataset.scenario)));
 document.querySelectorAll('[data-journey]').forEach(b=>b.addEventListener('click',()=>drawJourney(b.dataset.journey)));
 document.querySelectorAll('[data-solution]').forEach(b=>b.addEventListener('click',()=>drawSolution(b.dataset.solution)));
 document.querySelectorAll('[data-benefit]').forEach(b=>b.addEventListener('click',()=>{
 const d=benefits[b.dataset.benefit];if(!d)return;setText('benefit-title',d[0]);setText('benefit-description',d[1]);
 document.querySelectorAll('[data-benefit]').forEach(x=>x.classList.toggle('active',x===b));
 }));
 const menu=document.querySelector('.menu-toggle'),nav=byId('main-nav');
 menu?.addEventListener('click',()=>{const expanded=menu.getAttribute('aria-expanded')==='true';menu.setAttribute('aria-expanded',String(!expanded));nav.classList.toggle('open',!expanded);});
 nav?.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{menu?.setAttribute('aria-expanded','false');nav.classList.remove('open');}));
 drawScenario('water');drawJourney('emergency');drawSolution('resident');
 document.querySelector('[data-benefit="response"]')?.classList.add('active');
})();