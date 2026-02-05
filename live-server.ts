import { createServer } from 'http';
import { readFileSync, existsSync, writeFileSync, statSync } from 'fs';
import { resolve, extname, join } from 'path';
import { runScenario } from './live-runner';

const root = resolve(process.cwd(), 'hiwios_ts/examples/demo');
const port = Number(process.env.HIWI_DEMO_PORT || 5173);

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function send(res: any, status: number, body: string | Buffer, type = 'text/plain') {
  res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function serveFile(res: any, filePath: string) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    send(res, 404, 'Not found');
    return;
  }
  const ext = extname(filePath);
  const type = contentTypes[ext] || 'application/octet-stream';
  send(res, 200, readFileSync(filePath), type);
}

createServer(async (req, res) => {
  if (!req.url) return send(res, 400, 'Bad request');

  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (req.method === 'POST' && req.url.startsWith('/run-intent')) {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const payload = body ? JSON.parse(body) : {};
        const scenarioId = payload.scenarioId || 'context-us';
        const result = await runScenario(scenarioId);

        // Update live replay file so the UI can reload data
        const replayPath = join(root, 'hiwi_demo_replay.json');
        if (existsSync(replayPath)) {
          const replay = JSON.parse(readFileSync(replayPath, 'utf8'));
          replay.steps = buildStepsFromSelections(result.selections);
          replay.scenarios = replay.scenarios || [];
          const liveScenario = { id: 'live', label: 'Live run', steps: replay.steps };
          const filtered = replay.scenarios.filter((s: any) => s.id !== 'live');
          replay.scenarios = [liveScenario, ...filtered];
          writeFileSync(replayPath, JSON.stringify(replay, null, 2), 'utf8');
        }

        send(res, 200, JSON.stringify({ ok: true, result }), 'application/json; charset=utf-8');
      } catch (err: any) {
        send(res, 500, JSON.stringify({ ok: false, error: err?.message || 'error' }), 'application/json');
      }
    });
    return;
  }

  const safeUrl = req.url.split('?')[0];
  const filePath = safeUrl === '/' ? join(root, 'hiwi-moat-demo-yc.html') : join(root, safeUrl);
  serveFile(res, filePath);
}).listen(port, () => {
  console.log(`Hiwi demo server running on http://localhost:${port}`);
});

function buildStepsFromSelections(selections: Record<string, string | null>) {
  const nodeMap: Record<string, string> = {
    stripe_payment: 'cap.stripe',
    wallet_payment: 'cap.wallet',
    eu_vat_compliance: 'cap.vat',
    indonesian_ppn: 'cap.ppn',
    email_notification: 'cap.email',
    logistics_fedex_pref: 'cap.fedex',
    logistics_dhl: 'cap.fedex',
    logistics_local: 'cap.local',
    crm_salesforce: 'cap.crm.sf',
    crm_hubspot: 'cap.crm.hs',
    inventory_realtime: 'vertical.inventory',
    datastore_firestore: 'cap.db.firestore',
    datastore_postgres: 'cap.db.postgres',
  };

  const edgeMap: Record<string, string> = {
    stripe_payment: 'e.payment.stripe',
    wallet_payment: 'e.payment.wallet',
    eu_vat_compliance: 'e.compliance.vat',
    indonesian_ppn: 'e.compliance.ppn',
    email_notification: 'e.notification.email',
    logistics_fedex_pref: 'e.logistics.fedex',
    logistics_dhl: 'e.logistics.fedex',
    logistics_local: 'e.logistics.local',
    crm_salesforce: 'e.crm.sf',
    crm_hubspot: 'e.crm.hs',
    datastore_firestore: 'e.datastore.firestore',
    datastore_postgres: 'e.datastore.postgres',
  };

  const selectedCaps = Object.values(selections).filter(Boolean) as string[];
  const nodes = selectedCaps.map((id) => nodeMap[id]).filter(Boolean);
  const edges = selectedCaps.map((id) => edgeMap[id]).filter(Boolean);

  return [
    { label: 'Intent received: fulfillOrder', nodes: ['intent.fulfillOrder'], edges: [], event: 'intent.start' },
    { label: 'Policy check: RiskPolicy (OK)', nodes: ['policy.risk'], edges: ['e.intent.risk'], event: 'policy.check' },
    {
      label: 'Select capabilities',
      nodes,
      edges,
      event: 'capability.selected',
    },
    {
      label: 'Execute all capabilities',
      nodes,
      edges: ['e.done.success'],
      event: 'capability.executed',
    },
    { label: 'Intent completed', nodes: ['outcome.success'], edges: ['e.done.success'], event: 'intent.end' },
  ];
}
