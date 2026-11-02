'use strict';
(() => {
 const byId=id=>document.getElementById(id);
 const setText=(id,text)=>{const el=byId(id);if(el)el.textContent=text;};
 const scenarioData={
 water:{type:'POSIBLE EMERGENCIA · SOLO EJEMPLO',title:'Fuga de agua reportada',text:'El residente informa una filtración activa y el área afectada.',steps:['Instrucciones de seguridad para el residente','Ruta de escalamiento al propietario','Ruta de contacto de mantenimiento']},
 heat:{type:'SOLICITUD URGENTE · SOLO EJEMPLO',title:'Problema de calefacción reportado',text:'El residente informa la falta de calefacción, la ubicación de la unidad y las circunstancias inmediatas.',steps:['Evaluación de seguridad del residente','Escalamiento a la administración','Contacto de mantenimiento aprobado']},
 routine:{type:'SOLICITUD NO URGENTE · SOLO EJEMPLO',title:'Reparación habitual solicitada',text:'El residente informa un problema de mantenimiento no urgente.',steps:['El residente recibe orientación inicial','Cola de revisión del equipo de propiedad','Solicitud de programación de mantenimiento']}
 };
 const journeys={
 emergency:{title:'Coordinación de emergencias',description:'Un residente informa una posible emergencia. El asistente sigue las pautas aprobadas, registra el contexto y solicita el escalamiento autorizado.',steps:['Identificar seguridad y urgencia','Registrar datos de la propiedad y del incidente','Enviar notificaciones a contactos autorizados','Verificar la entrega o informar incertidumbre']},
 leasing:{title:'Un proceso de arrendamiento más receptivo',description:'Un posible residente solicita información sobre una propiedad. El asistente usa información verificada y registra la solicitud para el siguiente paso.',steps:['Comprender la consulta de arrendamiento','Presentar datos verificados de la propiedad','Registrar una solicitud de visita','Esperar confirmación del horario']},
 maintenance:{title:'Recepción estructurada de mantenimiento',description:'Un residente describe una necesidad habitual de mantenimiento y recibe instrucciones claras sobre los próximos pasos.',steps:['Identificar la ubicación y el problema','Recopilar los datos de acceso disponibles','Enviar una solicitud de mantenimiento','Confirmar solo un resultado verificado']},
 resident:{title:'Continuidad del servicio a residentes',description:'Un residente hace una pregunta habitual sobre la propiedad. El asistente sigue las políticas aprobadas y escala cuando es necesario.',steps:['Identificar la necesidad del residente','Consultar las pautas aprobadas de la propiedad','Responder dentro del alcance autorizado','Derivar excepciones a un profesional de la propiedad']}
 };
 const benefits={
 response:['Atención a residentes','Ofrezca una primera respuesta aprobada y consistente cuando el personal esté ocupado o no disponible.'],
 continuity:['Continuidad operativa','Mantenga flujos definidos de recepción y enrutamiento durante el horario laboral, las tardes y los fines de semana.'],
 clarity:['Transferencias coordinadas','Ayude a que la persona adecuada reciba el contexto, distinguiendo entre el envío y la confirmación de entrega.'],
 staff:['Mejor uso del tiempo del personal','Permita que la tecnología apoye interacciones habituales para que el equipo atienda situaciones excepcionales.']
 };
 const solutions={
 resident:['SERVICE SYSTEM / RESIDENT ENGAGEMENT','Cada interacción con un residente merece un siguiente paso claro.','Ofrezca respuestas útiles y basadas en políticas para consultas habituales y derive necesidades complejas al equipo adecuado.','Respuestas aprobadas · Escalamiento definido · Supervisión humana'],
 leasing:['SERVICE SYSTEM / LEASING ASSISTANCE','Cada posible residente es una oportunidad para responder.','Explique datos verificados, conozca los intereses del prospecto y registre solicitudes de visita sin prometer disponibilidad no confirmada.','Información verificada · Registro de prospectos · Solicitudes de visita'],
 maintenance:['SERVICE SYSTEM / MAINTENANCE','Convierta la descripción de un problema en una solicitud útil.','Registre el problema, la ubicación, el impacto y el contexto para el personal y sistemas autorizados.','Información estructurada · Confirmación verificada de la orden'],
 emergency:['SERVICE SYSTEM / EMERGENCY COORDINATION','Cuando algo falla, todos reciben información.','Siga las pautas de seguridad y coordine las notificaciones a residentes, propietarios y mantenimiento, verificando por separado entrega y acuse de recibo.','Solicitud · Envío de notificación · Comprobante de entrega · Acuse de recibo'],
 oversight:['SERVICE SYSTEM / MANAGEMENT CONTROL','Mantenga informado y al mando a su equipo de propiedad.','Defina respuestas aprobadas, políticas de escalamiento, permisos y requisitos de revisión humana para cada propiedad y cartera.','Reglas por propiedad · Supervisión responsable · Resultados verificados']
 };
 function drawScenario(key){
 const d=scenarioData[key]; if(!d)return;
 setText('scenario-type',d.type);setText('scenario-title',d.title);setText('scenario-text',d.text);
 const list=byId('route-list');if(!list)return;list.replaceChildren();
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
 const stepTabs=[...document.querySelectorAll('[data-step]')];
 const showStep=t=>{stepTabs.forEach(x=>{const on=x===t;x.setAttribute('aria-selected',String(on));x.tabIndex=on?0:-1;const pn=byId(x.getAttribute('aria-controls'));if(pn)pn.hidden=!on;});};
 stepTabs.forEach((t,i)=>{t.addEventListener('click',()=>showStep(t));t.addEventListener('keydown',e=>{const d=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;if(!d)return;e.preventDefault();const n=stepTabs[(i+d+stepTabs.length)%stepTabs.length];showStep(n);n.focus();});});
 const menu=document.querySelector('.menu-toggle'),nav=byId('main-nav');
 menu?.addEventListener('click',()=>{const expanded=menu.getAttribute('aria-expanded')==='true';menu.setAttribute('aria-expanded',String(!expanded));nav.classList.toggle('open',!expanded);});
 nav?.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{menu?.setAttribute('aria-expanded','false');nav.classList.remove('open');}));
 drawScenario('water');drawJourney('emergency');drawSolution('resident');
 document.querySelector('[data-benefit="response"]')?.classList.add('active');
})();