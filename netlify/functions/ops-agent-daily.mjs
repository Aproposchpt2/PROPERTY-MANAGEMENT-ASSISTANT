// Scheduled daily: runs every enabled agent (ElevenLabs) script. 13:25 UTC, just
// after the backend run at 13:17 on the specialist site. Starting tests takes a
// few seconds; ElevenLabs finishes them on its side and ops-alert-daily settles
// the results at 14:05 UTC (the admin panel also settles them whenever it polls).
import { listScripts, startAgentRuns } from './lib/ops-core.mjs';

export default async () => {
  const scripts = (await listScripts()).filter((s) => s.layer === 'agent' && s.enabled !== false);
  const r = await startAgentRuns(scripts, 'daily');
  console.log('[ops-agent-daily]', JSON.stringify({ started: r.started.length, skipped: r.skipped.length, errors: r.errors }));
};

export const config = { schedule: '25 13 * * *' };
