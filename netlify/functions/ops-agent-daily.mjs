// NOT SCHEDULED. The daily run was stopped on 2026-11-06 (owner: it used up ElevenLabs credits).
// Agent scripts still run on demand from /admin/testing. To restore the daily 13:25 UTC run,
// add a config export with schedule '25 13 * * *' at the end of this file.
// When scheduled, it ran this site's enabled agent (ElevenLabs) scripts; ops-alert-daily
// settles open runs at 14:05 UTC (the testing panel also settles them whenever it polls).
import { listScripts, startAgentRuns, siteProduct } from './lib/ops-core.mjs';

export default async () => {
  const product = siteProduct();
  const scripts = (await listScripts()).filter((s) => s.product === product && s.layer === 'agent' && s.enabled !== false);
  const r = await startAgentRuns(scripts, 'daily');
  console.log('[ops-agent-daily]', JSON.stringify({ product, started: r.started.length, skipped: r.skipped.length, errors: r.errors }));
};
