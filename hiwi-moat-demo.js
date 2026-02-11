const fallbackReport = {
  deterministicProvider: {
    kpis: { orchestrator: { count: 2, success: 2, failure: 0, avgDurationMs: 60 } },
    totalCost: 0.024,
  },
  fastProvider: {
    kpis: { orchestrator: { count: 25, success: 24, failure: 1, avgDurationMs: 90 } },
    totalCost: 0.98,
  },
  slowProvider: {
    kpis: { orchestrator: { count: 25, success: 18, failure: 7, avgDurationMs: 420 } },
    totalCost: 0.98,
  },
};

const fallbackRuns = [
  {
    label: "Context A (ID + wallet)",
    provider: "deterministic",
    success: true,
    capabilities: { payment: "wallet_payment", notification: "email_notification" },
    timestamp: new Date().toISOString(),
  },
  {
    label: "Context B (US + card)",
    provider: "deterministic",
    success: true,
    capabilities: { payment: "stripe_payment", notification: "email_notification" },
    timestamp: new Date().toISOString(),
  },
];

const fallbackReplay = {
  nodes: [
    { id: "intent.fulfillOrder", label: "fulfillOrder", x: 40, y: 140, group: "intent", info: "Intent: Global Fulfillment" },
    { id: "policy.risk", label: "RiskPolicy", x: 220, y: 40, group: "policy", info: "Blocks high-risk orders" },
    { id: "policy.sla", label: "SlaPolicy", x: 220, y: 140, group: "policy", info: "Reroutes to fast logistics" },
    { id: "vertical.payment", label: "payment", x: 420, y: 40, group: "vertical", info: "Select payment provider" },
    { id: "vertical.notification", label: "notification", x: 420, y: 140, group: "vertical", info: "Send notifications" },
    { id: "cap.stripe", label: "stripe_payment", x: 650, y: 40, group: "capability", info: "Stripe • card payments" },
    { id: "cap.email", label: "email_notification", x: 650, y: 140, group: "capability", info: "SendGrid • email" },
    { id: "outcome.success", label: "success", x: 860, y: 100, group: "outcome", info: "Order fulfilled" },
  ],
  edges: [
    { id: "e.intent.risk", from: "intent.fulfillOrder", to: "policy.risk" },
    { id: "e.intent.sla", from: "intent.fulfillOrder", to: "policy.sla" },
    { id: "e.sla.payment", from: "policy.sla", to: "vertical.payment" },
    { id: "e.sla.notification", from: "policy.sla", to: "vertical.notification" },
    { id: "e.payment.stripe", from: "vertical.payment", to: "cap.stripe" },
    { id: "e.notification.email", from: "vertical.notification", to: "cap.email" },
    { id: "e.done.success", from: "cap.email", to: "outcome.success" },
  ],
  steps: [
    { label: "Intent received", nodes: ["intent.fulfillOrder"], edges: [], event: "intent.start" },
    { label: "Policy check", nodes: ["policy.risk"], edges: ["e.intent.risk"], event: "policy.check" },
    {
      label: "Select payment + notification",
      nodes: ["cap.stripe", "cap.email"],
      edges: ["e.payment.stripe", "e.notification.email"],
      event: "capability.selected",
    },
    { label: "Completed", nodes: ["outcome.success"], edges: ["e.done.success"], event: "intent.end" },
  ],
};

const $ = (sel) => document.querySelector(sel);
const statusBadge = $("#statusBadge");

async function loadJson(path, fallback) {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed ${path}`);
    return { data: await res.json(), ok: true };
  } catch (err) {
    return { data: fallback, ok: false };
  }
}

function buildSyntheticEdges(replay) {
  const nodes = replay?.nodes || [];
  const edges = replay?.edges || [];
  if (!nodes.length || !edges.length) return [];

  const successNodeId =
    nodes.find((n) => n.group === "outcome" && n.label?.toLowerCase().includes("success"))?.id ||
    nodes.find((n) => n.label?.toLowerCase?.().includes("success"))?.id ||
    "outcome.success";

  const executedCapabilityIds = new Set();
  (replay?.steps || []).forEach((step) => {
    (step.nodes || []).forEach((nodeId) => executedCapabilityIds.add(nodeId));
  });

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const synthetic = [];

  executedCapabilityIds.forEach((nodeId) => {
    const node = nodeById.get(nodeId);
    if (!node || node.group !== "capability") return;
    const edgeId = `e.synthetic.${nodeId}.success`;
    const exists = edges.some(
      (edge) => (edge.id || `edge-${edge.from}-${edge.to}`) === edgeId || (edge.from === nodeId && edge.to === successNodeId)
    );
    if (!exists) synthetic.push({ id: edgeId, from: nodeId, to: successNodeId, synthetic: true });
  });

  return synthetic;
}

async function postScenarioRun(scenarioId) {
  const apiBase = window.location.hostname.includes("hiwidigi.com")
    ? "https://api.hiwidigi.com"
    : "http://localhost:5174";
  const res = await fetch(`${apiBase}/run-intent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenarioId }),
  });
  if (!res.ok) throw new Error(`run-intent failed: ${res.status}`);
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return null;
  return res.json();
}

function pct(num) {
  return `${(num * 100).toFixed(1)}%`;
}

function formatMs(value) {
  return `${Math.round(value)} ms`;
}

function setText(selector, value) {
  const el = $(selector);
  if (el) el.textContent = value;
}

function renderKpis(report, runs) {
  const fast = report.fastProvider?.kpis?.orchestrator || {};
  const slow = report.slowProvider?.kpis?.orchestrator || {};

  const fastSuccessRate = fast.count ? fast.success / fast.count : 0;
  const slowSuccessRate = slow.count ? slow.success / slow.count : 0;
  const recent = Array.isArray(runs) ? runs.slice(-12) : [];
  const recentSuccess = recent.length ? recent.filter((r) => r.success).length / recent.length : 0;
  const providers = new Set(
    (runs || [])
      .map((r) => r?.capabilities?.payment)
      .filter(Boolean)
  );

  setText('[data-kpi="normalSuccess"]', pct(fastSuccessRate));
  setText('[data-kpi="strictSuccess"]', pct(slowSuccessRate));
  setText('[data-kpi="runReliability"]', pct(recentSuccess));
  setText('[data-kpi="providerFlex"]', `${providers.size || 1} providers`);

  const barFast = $("#barFast");
  const barSlow = $("#barSlow");
  const max = Math.max(fast.avgDurationMs || 1, slow.avgDurationMs || 1);
  if (barFast) barFast.style.width = `${Math.max(12, (fast.avgDurationMs / max) * 100)}%`;
  if (barSlow) barSlow.style.width = `${Math.max(12, (slow.avgDurationMs / max) * 100)}%`;

  setText("#barFastLabel", formatMs(fast.avgDurationMs || 0));
  setText("#barSlowLabel", formatMs(slow.avgDurationMs || 0));

  const contextA = runs.find((r) => r.label.includes("Context A"));
  const contextB = runs.find((r) => r.label.includes("Context B"));
  if (contextA) {
    setText(
      "#contextA",
      `${contextA.label} → ${contextA.capabilities.payment} + ${contextA.capabilities.notification}`
    );
  }
  if (contextB) {
    setText(
      "#contextB",
      `${contextB.label} → ${contextB.capabilities.payment} + ${contextB.capabilities.notification}`
    );
  }
}

function renderTimeline(runs) {
  const target = $("#timeline");
  if (!target) return;
  const items = runs.slice(-10).reverse();
  const providerLabel = {
    fast: "optimized path",
    slow: "constraint-heavy path",
    deterministic: "deterministic path",
  };
  const normalizeLabel = (value = "") =>
    value
      .replace(/\bFast\b/gi, "Optimized")
      .replace(/\bSlow\b/gi, "Constraint-heavy");
  target.innerHTML = items
    .map(
      (r) => `
      <div class="timeline__item">
        ${normalizeLabel(r.label || "Run")} • ${providerLabel[r.provider] || r.provider || "path"} • ${r.success ? "success" : "fail"}
        <span>${r.capabilities.payment || "none"} → ${r.capabilities.notification || "none"}</span>
      </div>
    `
    )
    .join("");
}

async function renderGraph(runs, replay) {
  const svg = $("#flowGraph");
  if (!svg) return;
  const NODE_WIDTH = 238;
  const NODE_HEIGHT = 108;

  const truncate = (text, max = 44) => {
    if (!text) return "";
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };

  const textWidth = (text, min = 62, max = 140) =>
    Math.max(min, Math.min(max, Math.round((text || "").length * 6.8 + 20)));

  const nodeKindLabel = (group = "") => {
    const map = {
      intent: "INTENT",
      policy: "POLICY",
      vertical: "COMPONENT",
      capability: "CAPABILITY",
      outcome: "OUTCOME",
    };
    return map[group] || "NODE";
  };

  const nodeMeta = (node) => {
    const info = (node.info || "").trim();
    if (node.group === "capability") {
      const provider = info.includes("•") ? info.split("•")[0].trim() : "";
      return truncate(provider ? `Loaded from ${provider}` : `Loaded from ${node.id}`, 38);
    }
    if (node.group === "policy") return truncate(`Policy from ${node.id}`, 38);
    if (node.group === "vertical") return truncate(`Context component: ${node.label}`, 38);
    if (node.group === "intent") return truncate(`Recipe source: ${node.id}`, 38);
    if (node.group === "outcome") return truncate(info || `Outcome: ${node.label}`, 38);
    return truncate(info || `Source: ${node.id}`, 38);
  };

  const nodeSourceChip = (node) => {
    const info = (node.info || "").trim();
    if (node.group === "capability") {
      const provider = info.includes("•") ? info.split("•")[0].trim() : "";
      return provider ? `${provider} source` : "Capability source";
    }
    if (node.group === "policy") return "Policy guard";
    if (node.group === "vertical") return "ECS component";
    if (node.group === "intent") return "Intent recipe";
    if (node.group === "outcome") return "Execution result";
    return "Runtime source";
  };

  const baseNodes = replay?.nodes?.length
    ? replay.nodes
    : [
        { id: "intent", label: "checkout", x: 40, y: 140, accent: true },
        { id: "payment", label: "payment", x: 300, y: 80 },
        { id: "notification", label: "notification", x: 300, y: 210 },
        { id: "capPayment", label: "stripe_payment", x: 560, y: 80 },
        { id: "capNotify", label: "email_notification", x: 560, y: 210 },
        { id: "provider", label: "provider swap", x: 800, y: 140, warn: true },
      ];

  const edges = replay?.edges?.length
    ? replay.edges
    : [
        { id: "e.intent.payment", from: "intent", to: "payment" },
        { id: "e.intent.notification", from: "intent", to: "notification" },
        { id: "e.payment.cap", from: "payment", to: "capPayment" },
        { id: "e.notification.cap", from: "notification", to: "capNotify" },
        { id: "e.cap.provider", from: "capPayment", to: "provider" },
        { id: "e.cap.provider2", from: "capNotify", to: "provider" },
      ];
  const syntheticEdges = buildSyntheticEdges(replay);
  const allEdges = edges.concat(syntheticEdges);

  const spread = replay?.layoutScale || (baseNodes.length > 12 ? 1.15 : 1);
  let nodeData = baseNodes.map((node) => ({
    ...node,
    x: Math.round((node.x || 0) * spread),
    y: Math.round((node.y || 0) * spread),
  }));

  const autoLayout = replay?.layoutMode === "lane" || (replay?.autoLayout !== false && nodeData.length > 10);
  if (autoLayout) {
    const lanes = new Map();
    nodeData.forEach((node) => {
      const key = node.group || "other";
      if (!lanes.has(key)) lanes.set(key, []);
      lanes.get(key).push(node);
    });
    const order = replay?.laneOrder || ["intent", "policy", "vertical", "capability", "outcome", "other"];
    const laneKeys = order.filter((key) => lanes.has(key)).concat(
      [...lanes.keys()].filter((key) => !order.includes(key))
    );
    const laneGapX = 300;
    const laneStartX = 40;
    const laneStartY = 20;
    const laneGapY = 130;
    const laneSort = {
      intent: ["intent.fulfillOrder"],
      policy: ["policy.risk", "policy.sla"],
      vertical: [
        "vertical.payment",
        "vertical.inventory",
        "vertical.compliance",
        "vertical.notification",
        "vertical.logistics",
        "vertical.crm",
        "vertical.datastore",
      ],
      capability: [
        "cap.stripe",
        "cap.wallet",
        "cap.vat",
        "cap.ppn",
        "cap.email",
        "cap.fedex",
        "cap.local",
        "cap.crm.sf",
        "cap.crm.hs",
        "cap.db.firestore",
        "cap.db.postgres",
      ],
      outcome: ["outcome.block", "outcome.success"],
    };
    const layout = [];
    laneKeys.forEach((laneKey, laneIndex) => {
      const nodes = lanes.get(laneKey) || [];
      const sortOrder = laneSort[laneKey];
      if (sortOrder) {
        nodes.sort((a, b) => sortOrder.indexOf(a.id) - sortOrder.indexOf(b.id));
      } else {
        nodes.sort((a, b) => (a.y || 0) - (b.y || 0));
      }
      nodes.forEach((node, idx) => {
        layout.push({
          ...node,
          x: laneStartX + laneIndex * laneGapX,
          y: laneStartY + idx * laneGapY,
        });
      });
    });
    nodeData = layout;
  }
  let elkLayout = null;
  if (window.ELK && replay?.layoutMode !== "manual") {
    try {
      const elk = new window.ELK();
      elkLayout = await elk.layout({
        id: "root",
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": "RIGHT",
          "elk.spacing.nodeNode": "60",
          "elk.layered.spacing.nodeNodeBetweenLayers": "90",
          "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
          "elk.edgeRouting": "ORTHOGONAL",
        },
        children: nodeData.map((node) => ({
          id: node.id,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
        })),
        edges: edges.map((edge) => ({
          id: edge.id || `edge-${edge.from}-${edge.to}`,
          sources: [edge.from],
          targets: [edge.to],
        })),
      });
    } catch (err) {
      elkLayout = null;
    }
  }
  if (elkLayout?.children?.length) {
    const byId = new Map(elkLayout.children.map((n) => [n.id, n]));
    nodeData = nodeData.map((node) => {
      const layoutNode = byId.get(node.id);
      return layoutNode
        ? {
            ...node,
            x: layoutNode.x ?? node.x,
            y: layoutNode.y ?? node.y,
          }
        : node;
    });
  }

  svg.innerHTML = "";

  let minNodeX = Infinity;
  let minNodeY = Infinity;
  let maxNodeX = 0;
  let maxNodeY = 0;
  nodeData.forEach((node) => {
    minNodeX = Math.min(minNodeX, node.x);
    minNodeY = Math.min(minNodeY, node.y);
    maxNodeX = Math.max(maxNodeX, node.x + NODE_WIDTH);
    maxNodeY = Math.max(maxNodeY, node.y + NODE_HEIGHT);
  });
  const padX = 130;
  const padY = 90;
  const minX = minNodeX - padX;
  const minY = minNodeY - padY;
  const width = Math.max(760, maxNodeX - minNodeX + padX * 2);
  const height = Math.max(520, maxNodeY - minNodeY + padY * 2);
  svg.setAttribute("viewBox", `${minX} ${minY} ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  const edgeSections = new Map();
  if (elkLayout?.edges?.length) {
    elkLayout.edges.forEach((edge) => {
      if (edge.sections && edge.sections.length) {
        edgeSections.set(edge.id, edge.sections[0]);
      }
    });
  }

  allEdges.forEach((edge) => {
    const from = nodeData.find((n) => n.id === edge.from);
    const to = nodeData.find((n) => n.id === edge.to);
    if (!from || !to) return;
    const edgeId = edge.id || `edge-${edge.from}-${edge.to}`;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const section = edgeSections.get(edgeId);
    if (section) {
      const points = [section.startPoint, ...(section.bendPoints || []), section.endPoint];
      const d = points
        .map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.y}`)
        .join(" ");
      path.setAttribute("d", d);
    } else {
      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2;
      path.setAttribute(
        "d",
        `M ${from.x + NODE_WIDTH} ${from.y + NODE_HEIGHT / 2} Q ${midX} ${midY}, ${to.x} ${to.y + NODE_HEIGHT / 2}`
      );
    }
    path.setAttribute("class", `edge${edge.synthetic ? " edge--synthetic" : ""}`);
    path.setAttribute("data-edge-id", edgeId);
    svg.appendChild(path);
  });

  nodeData.forEach((node) => {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", node.x);
    rect.setAttribute("y", node.y);
    rect.setAttribute("rx", "16");
    rect.setAttribute("ry", "16");
    rect.setAttribute("width", String(NODE_WIDTH));
    rect.setAttribute("height", String(NODE_HEIGHT));
    const typeClass = node.group ? ` node--${node.group}` : "";
    rect.setAttribute(
      "class",
      `node${typeClass}${node.accent ? " node--accent" : ""}${node.warn ? " node--warn" : ""}`
    );
    rect.setAttribute("data-node-id", node.id);
    if (node.info) rect.setAttribute("data-node-info", node.info);
    else if (node.label) rect.setAttribute("data-node-info", node.label);
    if (node.group) rect.setAttribute("data-node-group", node.group);
    if (node.provider) rect.setAttribute("data-node-provider", node.provider);
    if (node.verbs) rect.setAttribute("data-node-verbs", (node.verbs || []).join(", "));
    if (node.constraints) rect.setAttribute("data-node-constraints", (node.constraints || []).length.toString());
    const badge = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    badge.setAttribute("x", String(node.x + 12));
    badge.setAttribute("y", String(node.y + 10));
    badge.setAttribute("rx", "10");
    badge.setAttribute("ry", "10");
    badge.setAttribute("width", "96");
    badge.setAttribute("height", "20");
    badge.setAttribute("class", `node-kind node-kind--${node.group || "other"}`);

    const badgeText = document.createElementNS("http://www.w3.org/2000/svg", "text");
    badgeText.setAttribute("x", String(node.x + 22));
    badgeText.setAttribute("y", String(node.y + 24));
    badgeText.setAttribute("class", "node-kind__label");
    badgeText.textContent = nodeKindLabel(node.group);

    const chipText = nodeSourceChip(node);
    const chip = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    chip.setAttribute("x", String(node.x + NODE_WIDTH - textWidth(chipText) - 14));
    chip.setAttribute("y", String(node.y + NODE_HEIGHT - 28));
    chip.setAttribute("rx", "10");
    chip.setAttribute("ry", "10");
    chip.setAttribute("width", String(textWidth(chipText)));
    chip.setAttribute("height", "18");
    chip.setAttribute("class", "node-source");

    const chipLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    chipLabel.setAttribute("x", String(node.x + NODE_WIDTH - textWidth(chipText) - 4));
    chipLabel.setAttribute("y", String(node.y + NODE_HEIGHT - 15));
    chipLabel.setAttribute("class", "node-source__label");
    chipLabel.textContent = chipText;

    const title = document.createElementNS("http://www.w3.org/2000/svg", "text");
    title.setAttribute("x", String(node.x + 14));
    title.setAttribute("y", String(node.y + 52));
    title.setAttribute("class", "node-label node-title");
    title.setAttribute("data-node-id", node.id);
    title.textContent = truncate(node.label || node.id, 30);

    const meta = document.createElementNS("http://www.w3.org/2000/svg", "text");
    meta.setAttribute("x", String(node.x + 14));
    meta.setAttribute("y", String(node.y + 74));
    meta.setAttribute("class", "node-meta");
    meta.textContent = nodeMeta(node);
    const idText = document.createElementNS("http://www.w3.org/2000/svg", "text");
    idText.setAttribute("x", String(node.x + 14));
    idText.setAttribute("y", String(node.y + NODE_HEIGHT - 14));
    idText.setAttribute("class", "node-id");
    idText.textContent = truncate(node.id, 24);
    g.appendChild(rect);
    g.appendChild(badge);
    g.appendChild(badgeText);
    g.appendChild(title);
    g.appendChild(meta);
    g.appendChild(chip);
    g.appendChild(chipLabel);
    g.appendChild(idText);
    svg.appendChild(g);
  });

}

async function bootstrap() {
  if (statusBadge) {
    statusBadge.textContent = "loading…";
    statusBadge.classList.remove("hero__status--ok", "hero__status--warn");
  }

  const [reportRes, runsRes, detailRes, eventLogRes, replayRes] = await Promise.all([
    loadJson("./hiwi_demo_report.json", fallbackReport),
    loadJson("./hiwi_demo_runs.json", fallbackRuns),
    loadJson("./hiwi_demo_detail.json", { recipe: {}, policies: [], capabilities: [], decisionTrace: [] }),
    loadJson("./hiwi_event_log.json", { deterministic: [], fast: [], slow: [] }),
    loadJson("./hiwi_demo_replay.json", fallbackReplay),
  ]);

  const report = reportRes.data;
  const runs = runsRes.data;
  const detail = detailRes.data;
  const eventLog = eventLogRes.data;
  const replay = replayRes.data;

  renderKpis(report, runs);
  renderTimeline(runs);
  await renderGraph(runs, replay);
  renderDetails(detail);
  renderEventLog(eventLog);
  setupReplay(replay);

  if (statusBadge) {
    const allOk = reportRes.ok && runsRes.ok && detailRes.ok && eventLogRes.ok && replayRes.ok;
    statusBadge.textContent = allOk ? "live data loaded" : "using fallback data";
    statusBadge.classList.add(allOk ? "hero__status--ok" : "hero__status--warn");
  }
}

document.getElementById("ctaReload")?.addEventListener("click", bootstrap);
document.getElementById("ctaCopy")?.addEventListener("click", async () => {
  const report = await loadJson("./hiwi_demo_report.json", fallbackReport);
  const text = JSON.stringify(report, null, 2);
  await navigator.clipboard.writeText(text);
});

bootstrap();
initMiniDemos();
initChapters();
initEcsVisual();
initSignalCounters();
initPinSections();

function setupReplay(replay) {
  const status = document.getElementById("replayStatus");
  const stepsEl = document.getElementById("replaySteps");
  const scenariosEl = document.getElementById("replayScenarios");
  const canvas = document.querySelector(".graph__canvas");
  const flowGraph = document.getElementById("flowGraph");
  const followToggle = document.getElementById("followCameraToggle");
  const minimapHost = document.getElementById("graphMinimap");
  const scenarioContexts = document.getElementById("scenarioContexts");
  const scenarioProviders = document.getElementById("scenarioProviders");
  const scenarioOutput = document.getElementById("scenarioOutput");

  if (window.__hiwiReplayCleanup) window.__hiwiReplayCleanup();
  const cleanupFns = [];
  const bind = (el, event, handler) => {
    if (!el) return;
    el.addEventListener(event, handler);
    cleanupFns.push(() => el.removeEventListener(event, handler));
  };

  if (!replay || !replay.steps || replay.steps.length === 0) {
    if (status) status.textContent = "no replay data";
    return;
  }

  let timer = null;
  let idx = 0;
  let currentScenarioId = null;
  let currentStepNodes = [];
  const revealedNodes = new Set();
  const revealedEdges = new Set();
  let autoRunTimer = null;
  let followMode = true;
  let baseView = null;
  let currentView = null;
  let cameraAnim = null;
  let minimapModel = null;
  let nodeLayout = new Map();

  if (canvas) canvas.classList.remove("replay");

  const scenarios = Array.isArray(replay.scenarios) && replay.scenarios.length
    ? replay.scenarios
    : [{ id: "default", label: "All steps", steps: replay.steps }];
  const syntheticEdges = buildSyntheticEdges(replay);

  const parseViewBox = (value) => {
    const parts = String(value || "")
      .trim()
      .split(/\s+/)
      .map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
    return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
  };

  const setViewBox = (box) => {
    if (!flowGraph || !box) return;
    flowGraph.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
    currentView = { ...box };
  };

  const animateViewTo = (target, duration = 520) => {
    if (!flowGraph || !target) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = currentView || parseViewBox(flowGraph.getAttribute("viewBox")) || target;
    if (reduceMotion) {
      setViewBox(target);
      return;
    }
    if (cameraAnim) cancelAnimationFrame(cameraAnim);
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setViewBox({
        x: from.x + (target.x - from.x) * eased,
        y: from.y + (target.y - from.y) * eased,
        width: from.width + (target.width - from.width) * eased,
        height: from.height + (target.height - from.height) * eased,
      });
      if (t < 1) cameraAnim = requestAnimationFrame(tick);
      else cameraAnim = null;
    };
    cameraAnim = requestAnimationFrame(tick);
  };

  const buildMiniMap = () => {
    if (!minimapHost || !flowGraph || !nodeLayout.size) return;
    const allNodes = [...nodeLayout.values()];
    const minX = Math.min(...allNodes.map((n) => n.x));
    const minY = Math.min(...allNodes.map((n) => n.y));
    const maxX = Math.max(...allNodes.map((n) => n.x + n.width));
    const maxY = Math.max(...allNodes.map((n) => n.y + n.height));
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const scaleX = 160 / spanX;
    const scaleY = 92 / spanY;
    const scale = Math.min(scaleX, scaleY);
    const offsetX = (160 - spanX * scale) / 2;
    const offsetY = (92 - spanY * scale) / 2;

    minimapHost.innerHTML = "";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "graph__mini-svg");
    svg.setAttribute("viewBox", "0 0 160 92");
    const nodesById = new Map();

    allNodes.forEach((node) => {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("class", "graph__mini-node");
      rect.setAttribute("rx", "2");
      rect.setAttribute("ry", "2");
      rect.setAttribute("x", String(offsetX + (node.x - minX) * scale));
      rect.setAttribute("y", String(offsetY + (node.y - minY) * scale));
      rect.setAttribute("width", String(Math.max(2, node.width * scale)));
      rect.setAttribute("height", String(Math.max(2, node.height * scale)));
      svg.appendChild(rect);
      nodesById.set(node.id, rect);
    });

    const viewport = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    viewport.setAttribute("class", "graph__mini-viewport");
    viewport.setAttribute("rx", "3");
    viewport.setAttribute("ry", "3");
    svg.appendChild(viewport);
    minimapHost.appendChild(svg);

    minimapModel = { nodesById, viewport, minX, minY, maxX, maxY, scale, offsetX, offsetY };
  };

  const updateMiniMap = (activeIds = [], view = currentView || baseView) => {
    if (!minimapModel) return;
    minimapModel.nodesById.forEach((el, id) => {
      el.classList.toggle("is-active", activeIds.includes(id));
    });
    if (!view) return;
    const vx = minimapModel.offsetX + (view.x - minimapModel.minX) * minimapModel.scale;
    const vy = minimapModel.offsetY + (view.y - minimapModel.minY) * minimapModel.scale;
    const vw = view.width * minimapModel.scale;
    const vh = view.height * minimapModel.scale;
    minimapModel.viewport.setAttribute("x", String(vx));
    minimapModel.viewport.setAttribute("y", String(vy));
    minimapModel.viewport.setAttribute("width", String(Math.max(8, vw)));
    minimapModel.viewport.setAttribute("height", String(Math.max(8, vh)));
  };

  const updateFollowToggle = () => {
    if (!followToggle) return;
    followToggle.classList.toggle("graph__follow--active", followMode);
    followToggle.setAttribute("aria-pressed", followMode ? "true" : "false");
    followToggle.textContent = followMode ? "Follow mode" : "Overview mode";
  };

  const updateGuidedCamera = (activeNodeIds = []) => {
    if (!flowGraph) return;
    if (!baseView) {
      baseView = parseViewBox(flowGraph.getAttribute("viewBox"));
      currentView = baseView ? { ...baseView } : null;
    }
    if (!baseView) return;
    if (!followMode || activeNodeIds.length === 0) {
      animateViewTo(baseView, 560);
      updateMiniMap(activeNodeIds, baseView);
      return;
    }
    const focusedNodes = activeNodeIds
      .map((id) => nodeLayout.get(id))
      .filter(Boolean);
    if (!focusedNodes.length) {
      updateMiniMap(activeNodeIds, currentView || baseView);
      return;
    }
    const minX = Math.min(...focusedNodes.map((n) => n.x));
    const minY = Math.min(...focusedNodes.map((n) => n.y));
    const maxX = Math.max(...focusedNodes.map((n) => n.x + n.width));
    const maxY = Math.max(...focusedNodes.map((n) => n.y + n.height));
    const padX = 220;
    const padY = 140;
    const target = {
      x: minX - padX,
      y: minY - padY,
      width: Math.max(baseView.width * 0.42, maxX - minX + padX * 2),
      height: Math.max(baseView.height * 0.46, maxY - minY + padY * 2),
    };
    target.width = Math.min(baseView.width, target.width);
    target.height = Math.min(baseView.height, target.height);
    const maxOffsetX = baseView.x + baseView.width - target.width;
    const maxOffsetY = baseView.y + baseView.height - target.height;
    target.x = Math.max(baseView.x, Math.min(target.x, maxOffsetX));
    target.y = Math.max(baseView.y, Math.min(target.y, maxOffsetY));
    animateViewTo(target, 560);
    updateMiniMap(activeNodeIds, target);
  };

  const edgeMap = new Map(
    [...(replay.edges || []), ...syntheticEdges].map((edge) => {
      const edgeId = edge.id || `edge-${edge.from}-${edge.to}`;
      return [edgeId, edge];
    })
  );
  const nodeMap = new Map((replay.nodes || []).map((n) => [n.id, n]));
  const rootId =
    (replay.nodes || []).find((n) => n.group === "intent")?.id ||
    (replay.nodes || []).reduce((best, node) => (best && best.x <= node.x ? best : node), null)?.id;
  const parentEdgeForNode = new Map();
  (replay.edges || []).forEach((edge) => {
    const edgeId = edge.id || `edge-${edge.from}-${edge.to}`;
    const fromNode = nodeMap.get(edge.from);
    const existing = parentEdgeForNode.get(edge.to);
    if (!existing) {
      parentEdgeForNode.set(edge.to, edgeId);
      return;
    }
    const existingEdge = edgeMap.get(existing);
    const existingFrom = existingEdge ? nodeMap.get(existingEdge.from) : null;
    const fromX = fromNode?.x ?? 0;
    const existingX = existingFrom?.x ?? 0;
    if (fromX < existingX) parentEdgeForNode.set(edge.to, edgeId);
  });

  const buildFlowSteps = (rawSteps) => {
    const steps = rawSteps || [];
    const nodeById = new Map((replay.nodes || []).map((n) => [n.id, n]));
    const activeNodes = new Set();
    const activeEdges = new Set();
    steps.forEach((step) => {
      (step.nodes || []).forEach((id) => activeNodes.add(id));
      (step.edges || []).forEach((edgeId) => activeEdges.add(edgeId));
    });

    const edges = [...activeEdges].map((edgeId) => edgeMap.get(edgeId)).filter(Boolean);
    if (!edges.length) return steps;

    const incoming = new Map();
    edges.forEach((edge) => {
      if (!incoming.has(edge.to)) incoming.set(edge.to, []);
      incoming.get(edge.to).push(edge.from);
    });

    const rootCandidates = (replay.nodes || []).filter((n) => n.group === "intent").map((n) => n.id);
    const root = rootCandidates[0] || edges[0].from;

    const revealed = new Set([root]);
    const sequence = [];
    const remainingEdges = new Set(edges.map((e) => e.id || `edge-${e.from}-${e.to}`));

    const edgeById = new Map(edges.map((e) => [e.id || `edge-${e.from}-${e.to}`, e]));

    const pickNext = () => {
      const candidates = [];
      remainingEdges.forEach((edgeId) => {
        const edge = edgeById.get(edgeId);
        if (edge && revealed.has(edge.from) && !revealed.has(edge.to)) {
          const toNode = nodeById.get(edge.to);
          candidates.push({
            edgeId,
            edge,
            x: toNode?.x ?? 0,
            y: toNode?.y ?? 0,
          });
        }
      });
      candidates.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
      return candidates[0];
    };

    let next;
    while ((next = pickNext())) {
      remainingEdges.delete(next.edgeId);
      revealed.add(next.edge.to);
      sequence.push({
        label: "flow.step",
        nodes: [next.edge.from, next.edge.to],
        edges: [next.edgeId],
        event: "flow.step",
      });
    }

    if (!sequence.length) return steps;
    return sequence;
  };

  const getSteps = () => {
    const scenario = scenarios.find((s) => s.id === currentScenarioId) || scenarios[0];
    const raw = scenario.steps || replay.steps || [];
    return raw;
  };

  const renderScenarioChips = () => {
    if (!scenariosEl) return;
    scenariosEl.innerHTML = scenarios
      .map(
        (s) =>
          `<button class="graph__chip${s.id === currentScenarioId ? " graph__chip--active" : ""}" data-scenario="${s.id}">${s.label}</button>`
      )
      .join("");
    scenariosEl.querySelectorAll("[data-scenario]").forEach((btn) => {
      bind(btn, "click", () => {
        const id = btn.getAttribute("data-scenario");
        currentScenarioId = id;
        renderScenarioChips();
        restartLoop();
      });
    });
  };

  let activeScenarioId = null;
  const runScenario = (scenarioId) => {
    if (!scenarioId) {
      idx = 0;
      restartLoop();
      return;
    }
    if (status) status.textContent = "running…";
    postScenarioRun(scenarioId)
      .then(() => {
        idx = 0;
        if (typeof bootstrap === "function") bootstrap();
      })
      .catch(() => {
        idx = 0;
        restartLoop();
      });
  };

  const queueScenarioRun = (scenarioId) => {
    if (autoRunTimer) clearTimeout(autoRunTimer);
    autoRunTimer = window.setTimeout(() => runScenario(scenarioId), 320);
  };

  const renderSwitches = () => {
    if (!replay.scenarioGroups) return;
    const groups = replay.scenarioGroups;
    const buildButtons = (target, items) => {
      if (!target || !items) return;
      target.innerHTML = items
        .map(
          (item, index) =>
            `<button class="graph__chip${index === 0 ? " graph__chip--active" : ""}" data-switch="${item.id}">${item.label}</button>`
        )
        .join("");
      const setOutput = (item, shouldRun = false) => {
        if (!scenarioOutput) return;
        activeScenarioId = item.id;
        scenarioOutput.textContent = [
          `Context: ${item.context || "n/a"}`,
          `Policies: ${item.policies || "n/a"}`,
          `Compliance: ${item.compliance || "n/a"}`,
          `Payment: ${item.payment || "n/a"}`,
          `Datastore: ${item.datastore || "n/a"}`,
        ].join("\n");
        if (item.replayScenarioId) {
          currentScenarioId = item.replayScenarioId;
          renderScenarioChips();
          idx = 0;
          document.querySelectorAll("[data-node-id]").forEach((n) => n.classList.remove("node--revealed"));
          document.querySelectorAll("[data-edge-id]").forEach((e) => e.classList.remove("edge--revealed"));
          document.querySelectorAll(".node-label").forEach((l) => l.classList.remove("node-label--revealed"));
          revealedNodes.clear();
          revealedEdges.clear();
          dimAll();
          applyStep(0);
          if (status) status.textContent = "ready";
        }
        if (shouldRun) queueScenarioRun(item.id);
      };
      const first = items[0];
      if (first) setOutput(first, false);
      target.querySelectorAll("[data-switch]").forEach((btn) => {
        bind(btn, "click", () => {
          target.querySelectorAll(".graph__chip").forEach((chip) => chip.classList.remove("graph__chip--active"));
          btn.classList.add("graph__chip--active");
          const id = btn.getAttribute("data-switch");
          const item = items.find((it) => it.id === id);
          if (item) setOutput(item, true);
        });
      });
    };
    buildButtons(scenarioContexts, groups.contexts);
    buildButtons(scenarioProviders, groups.providers);
  };

  const revealAll = () => {
    document.querySelectorAll("[data-node-id]").forEach((n) => n.classList.add("node--revealed"));
    document.querySelectorAll("[data-edge-id]").forEach((e) => e.classList.add("edge--revealed"));
    document.querySelectorAll(".node-label").forEach((l) => l.classList.add("node-label--revealed"));
  };

  const dimAll = () => {
    document.querySelectorAll("[data-node-id]").forEach((n) => n.classList.add("node--dim"));
    document.querySelectorAll("[data-edge-id]").forEach((e) => e.classList.add("edge--dim"));
    document.querySelectorAll(".node-label").forEach((l) => l.classList.add("node-label--dim"));
  };

  const clearDim = (ids, edgeIds) => {
    ids.forEach((id) => {
      document.querySelectorAll(`[data-node-id="${id}"]`).forEach((n) => n.classList.remove("node--dim"));
      document.querySelectorAll(`text[data-node-id="${id}"]`).forEach((l) => l.classList.remove("node-label--dim"));
    });
    edgeIds.forEach((edgeId) => {
      const edge = document.querySelector(`[data-edge-id="${edgeId}"]`);
      if (edge) edge.classList.remove("edge--dim");
    });
  };

  const clearActive = () => {
    document.querySelectorAll(".node--active").forEach((n) => {
      n.classList.remove("node--active");
      n.classList.add("node--past");
    });
    document.querySelectorAll(".edge--active").forEach((e) => {
      e.classList.remove("edge--active");
      e.classList.add("edge--past");
    });
    document.querySelectorAll(".node-label").forEach((l) => l.classList.remove("node-label--revealed"));
    stepsEl?.querySelectorAll(".graph__step").forEach((s) => s.classList.remove("graph__step--active"));
  };

  const renderSteps = () => {
    if (!stepsEl) return;
    const steps = getSteps();
    stepsEl.innerHTML = steps
      .map((step, i) => `<div class="graph__step" data-step="${i}">${step.label}</div>`)
      .join("");
  };

  const applyStep = (stepIndex) => {
    const steps = getSteps();
    const step = steps[stepIndex];
    if (!step) return;
    clearActive();
    const stepNodes = new Set(step.nodes || []);
    const stepEdges = step.edges || [];
    stepEdges.forEach((edgeId) => {
      const edge = edgeMap.get(edgeId);
      if (edge) {
        stepNodes.add(edge.from);
        stepNodes.add(edge.to);
      }
    });
    const includePathTo = (nodeId) => {
      let current = nodeId;
      const visited = new Set();
      while (current && current !== rootId && !visited.has(current)) {
        visited.add(current);
        const parentEdgeId = parentEdgeForNode.get(current);
        if (!parentEdgeId) break;
        const parentEdge = edgeMap.get(parentEdgeId);
        if (!parentEdge) break;
        revealedEdges.add(parentEdgeId);
        revealedNodes.add(parentEdge.from);
        revealedNodes.add(parentEdge.to);
        current = parentEdge.from;
      }
      if (rootId) revealedNodes.add(rootId);
    };

    stepNodes.forEach((id) => {
      revealedNodes.add(id);
      includePathTo(id);
    });
    stepEdges.forEach((id) => {
      revealedEdges.add(id);
      const edge = edgeMap.get(id);
      if (edge) {
        includePathTo(edge.from);
        includePathTo(edge.to);
      }
    });
    syntheticEdges.forEach((edge) => {
      if (revealedNodes.has(edge.from) || revealedNodes.has(edge.to)) {
        revealedEdges.add(edge.id);
      }
    });
    dimAll();
    clearDim(revealedNodes, revealedEdges);
    [...stepNodes].forEach((id) => {
      const nodes = document.querySelectorAll(`[data-node-id="${id}"]`);
      nodes.forEach((node) => {
        node.classList.add("node--revealed");
        node.classList.add("node--active");
        node.classList.remove("node--past");
      });
      const label = document.querySelectorAll(`text[data-node-id="${id}"]`);
      label.forEach((l) => l.classList.add("node-label--revealed"));
    });
    stepEdges.forEach((edgeId) => {
      const edge = document.querySelector(`[data-edge-id="${edgeId}"]`);
      if (edge) {
        edge.classList.add("edge--revealed");
        edge.classList.add("edge--active");
        edge.classList.remove("edge--past");
      }
    });
    const stepEl = stepsEl?.querySelector(`[data-step="${stepIndex}"]`);
    if (stepEl) stepEl.classList.add("graph__step--active");
    currentStepNodes = [...stepNodes];
    updateGuidedCamera(currentStepNodes);
    if (status) status.textContent = `${stepIndex + 1}/${steps.length} • ${step.event || "step"}`;
  };

  const resetReplayVisuals = () => {
    document.querySelectorAll(".node--past").forEach((n) => n.classList.remove("node--past"));
    document.querySelectorAll(".edge--past").forEach((e) => e.classList.remove("edge--past"));
    document.querySelectorAll("[data-node-id]").forEach((n) => n.classList.remove("node--revealed"));
    document.querySelectorAll("[data-edge-id]").forEach((e) => e.classList.remove("edge--revealed"));
    document.querySelectorAll(".node-label").forEach((l) => l.classList.remove("node-label--revealed"));
    revealedNodes.clear();
    revealedEdges.clear();
  };

  const clearTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const tick = () => {
    const steps = getSteps();
    if (!steps.length) return;
    if (idx >= steps.length) idx = 0;
    if (status) status.textContent = "auto replay";
    if (canvas) canvas.classList.add("replay");
    if (idx === 0) {
      resetReplayVisuals();
    }
    applyStep(idx);
    idx += 1;
    if (idx >= steps.length) {
      revealAll();
      if (status) status.textContent = "looping…";
      idx = 0;
      timer = setTimeout(() => {
        timer = null;
        tick();
      }, 1100);
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      tick();
    }, 900);
  };

  const startLoop = () => {
    if (timer) return;
    tick();
  };

  const restartLoop = () => {
    clearTimer();
    idx = 0;
    resetReplayVisuals();
    dimAll();
    applyStep(0);
    idx = 1;
    startLoop();
  };

  renderSteps();
  if (status) status.textContent = "auto replay";
  dimAll();
  nodeLayout = new Map(
    Array.from(flowGraph?.querySelectorAll("rect[data-node-id]") || []).map((el) => [
      el.getAttribute("data-node-id"),
      {
        id: el.getAttribute("data-node-id"),
        x: Number(el.getAttribute("x")) || 0,
        y: Number(el.getAttribute("y")) || 0,
        width: Number(el.getAttribute("width")) || 238,
        height: Number(el.getAttribute("height")) || 108,
      },
    ])
  );
  buildMiniMap();
  updateFollowToggle();
  bind(followToggle, "click", () => {
    followMode = !followMode;
    updateFollowToggle();
    updateGuidedCamera(currentStepNodes);
  });
  currentScenarioId = scenarios[0]?.id || "default";
  renderScenarioChips();
  renderSwitches();
  startLoop();

  window.__hiwiReplayCleanup = () => {
    clearTimer();
    if (cameraAnim) cancelAnimationFrame(cameraAnim);
    if (autoRunTimer) clearTimeout(autoRunTimer);
    cleanupFns.forEach((fn) => fn());
  };
}

function renderDetails(detail) {
  const recipeTarget = $("#recipeBlock");
  const policyTarget = $("#policyBlock");
  const capTarget = $("#capabilityList");
  const decisionTarget = $("#decisionTrace");

  if (recipeTarget) {
    const recipes = Array.isArray(detail.recipes) && detail.recipes.length
      ? detail.recipes
      : detail.recipe
        ? [detail.recipe]
        : [];
    recipeTarget.innerHTML =
      recipes.length === 0
        ? `<div class="detail__item">No recipes loaded.</div>`
        : recipes
            .map(
              (recipe) => `
        <div class="detail__item">
          <strong>${recipe.name || recipe.intentName || "Recipe"}</strong>
          <div class="detail__meta">${recipe.description || "Intent recipe"}</div>
          <div class="detail__meta">Required: ${(recipe.requiredVerticals || []).join(", ")}</div>
          <div class="detail__meta">Order: ${recipe.executionOrder || "sequential"}</div>
        </div>
      `
            )
            .join("");
  }

  if (policyTarget) {
    const policies = detail.policies || [];
    policyTarget.innerHTML =
      policies.length === 0
        ? `<div class="detail__item">No policies registered.</div>`
        : policies
            .map(
              (p) => `<div class="detail__item"><code>${p.name}</code> • ${p.type}<div class="detail__meta">${p.description || ""}</div></div>`
            )
            .join("");
  }

  if (capTarget) {
    const caps = detail.capabilities || [];
    capTarget.innerHTML = caps
      .map(
        (cap) => `
        <div class="detail__item">
          <strong>${cap.id}</strong>
          <div class="detail__meta">${cap.name}</div>
          <div class="detail__meta">Vertical: ${cap.vertical} • Provider: ${cap.provider}</div>
          <div class="detail__meta">Verbs: ${(cap.verbs || []).join(", ")}</div>
          <div class="detail__meta">Constraints: ${(cap.constraints || [])
            .map((c) => `${c.key} ${c.op} ${c.value ?? (c.values || "").toString()}`)
            .join("; ")}</div>
        </div>
      `
      )
      .join("");
  }

  if (decisionTarget) {
    const traces = detail.decisionTrace || [];
    decisionTarget.innerHTML = traces
      .map((trace) => {
        const context = trace.context?.core || {};
        const evaluations = trace.evaluations || [];
        return `
          <details class="decision__block" open>
            <summary>
              <span class="decision__title">${trace.label}</span>
              <span class="decision__meta">${Object.keys(context).length ? "context attached" : "context empty"}</span>
              <span class="decision__hint">expand</span>
            </summary>
            <pre class="decision__context">${JSON.stringify(context, null, 2)}</pre>
            <div class="decision__rows">
              ${evaluations
                .map(
                  (ev) => `
                  <div class="decision__row">
                    <div class="decision__cap">${ev.capabilityId}</div>
                    <div class="decision__rules">
                      ${(ev.results || [])
                        .map(
                          (r) =>
                            `${r.predicate.key} ${r.predicate.op} ${JSON.stringify(r.predicate.value)} → ${r.result}`
                        )
                        .join(" · ")}
                    </div>
                  </div>
                `
                )
                .join("")}
            </div>
          </details>
        `;
      })
      .join("");
  }
}

function renderEventLog(eventLog) {
  const target = $("#eventLogStream");
  if (!target) return;
  let all = [
    ...(eventLog.deterministic || []),
    ...(eventLog.fast || []),
    ...(eventLog.slow || []),
  ];

  if (!all.length) {
    all = fallbackRuns.map((run, idx) => ({
      timestamp: run.timestamp,
      event: { type: `intent.end (${run.provider})`, data: run },
      id: `fallback_${idx}`,
    }));
  }

  all = all.slice(0, 60);

  target.innerHTML = "";
  all.forEach((entry, idx) => {
    const item = document.createElement("details");
    const eventType = entry?.event?.type || "event";
    const success =
      eventType.includes("success") ||
      eventType.includes("created") ||
      eventType.includes("added");
    const failed =
      eventType.includes("fail") ||
      eventType.includes("error") ||
      eventType.includes("rollback");
    item.className = `eventlog__item ${success ? "eventlog__item--success" : failed ? "eventlog__item--fail" : ""}`;
    item.style.animationDelay = `${idx * 40}ms`;
    const summary = document.createElement("summary");
    const time = document.createElement("span");
    time.className = "eventlog__time";
    time.textContent = entry.timestamp;
    const type = document.createElement("span");
    type.className = "eventlog__type";
    type.textContent = eventType;
    const cta = document.createElement("span");
    cta.className = "eventlog__cta";
    cta.textContent = "expand";
    summary.appendChild(time);
    summary.appendChild(type);
    summary.appendChild(cta);
    const pre = document.createElement("pre");
    pre.className = "eventlog__payload";
    pre.textContent = JSON.stringify(entry, null, 2);
    item.appendChild(summary);
    item.appendChild(pre);
    target.appendChild(item);
  });
}

function initMiniDemos() {
  const journeySections = [
    document.getElementById("experience"),
    document.getElementById("experience-clarity"),
  ].filter(Boolean);
  if (journeySections.length === 0) return;

  let freedomTimer = null;
  let traceTimer = null;
  let graphTimer = null;

  const switchEl = document.getElementById("miniSwitchFreedom");
  const resultEl = document.getElementById("miniFreedomResult");
  const pathEl = document.getElementById("miniFreedomPath");

  const freedomOptions = [
    { id: "us", result: "Stripe · FedEx · Firestore", path: ["payment", "logistics", "datastore"], scenarioId: "provider-stripe-firestore" },
    { id: "id", result: "Xendit · Local · Firestore", path: ["payment", "logistics", "datastore"], scenarioId: "provider-wallet-firestore" },
    { id: "de", result: "Stripe · DHL · Postgres", path: ["payment", "logistics", "datastore"], scenarioId: "provider-stripe-postgres" },
  ];

  let freedomIndex = 0;

  const setFreedom = (id) => {
    const option = freedomOptions.find((o) => o.id === id) || freedomOptions[0];
    if (!option) return;
    freedomIndex = freedomOptions.indexOf(option);
    if (switchEl) {
      switchEl.querySelectorAll(".mini-pill").forEach((pill) => pill.classList.remove("is-active"));
      const active = switchEl.querySelector(`[data-option="${option.id}"]`);
      if (active) active.classList.add("is-active");
    }
    if (resultEl) resultEl.textContent = option.result;
    if (pathEl) {
      pathEl.innerHTML = option.path.map((item) => `<span>${item}</span>`).join("");
    }
    runMiniScenario(option);
  };

  const metaEl = document.getElementById("miniFreedomMeta");
  const runMiniScenario = (option) => {
    if (!option?.scenarioId) return;
    if (metaEl) metaEl.textContent = "Running…";
    postScenarioRun(option.scenarioId)
      .then((payload) => {
        const selection = payload?.selection || payload?.result?.selection || payload?.data?.selection;
        if (selection && resultEl) {
          const payment = selection.payment?.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) || selection.payment || "payment";
          const logistics = selection.logistics?.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) || selection.logistics || "logistics";
          const datastore = selection.datastore?.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) || selection.datastore || "datastore";
          resultEl.textContent = `${payment} · ${logistics} · ${datastore}`;
        }
        if (metaEl) metaEl.textContent = "Last run: just now";
      })
      .catch(() => {
        if (metaEl) metaEl.textContent = "Last run: cached";
      });
  };

  const startFreedom = () => {
    if (freedomTimer) return;
    setFreedom(freedomOptions[freedomIndex]?.id);
    freedomTimer = window.setInterval(() => {
      freedomIndex = (freedomIndex + 1) % freedomOptions.length;
      setFreedom(freedomOptions[freedomIndex]?.id);
    }, 3200);
  };

  const stopFreedom = () => {
    if (freedomTimer) {
      clearInterval(freedomTimer);
      freedomTimer = null;
    }
  };

  switchEl?.querySelectorAll(".mini-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-option");
      if (id) setFreedom(id);
    });
  });

  const traceLines = Array.from(document.querySelectorAll("#miniTrace .trace-line"));
  let traceIndex = 0;

  const applyTrace = () => {
    traceLines.forEach((line, idx) => {
      line.classList.toggle("is-active", idx === traceIndex);
    });
  };

  const startTrace = () => {
    if (traceTimer || traceLines.length === 0) return;
    applyTrace();
    traceTimer = window.setInterval(() => {
      traceIndex = (traceIndex + 1) % traceLines.length;
      applyTrace();
    }, 1000);
  };

  const stopTrace = () => {
    if (traceTimer) {
      clearInterval(traceTimer);
      traceTimer = null;
    }
  };

  const graphEl = document.getElementById("miniGraph");
  const graphNodes = graphEl ? Array.from(graphEl.querySelectorAll(".mini-node")) : [];
  const graphLabels = graphEl ? Array.from(graphEl.querySelectorAll(".mini-label")) : [];
  const graphEdges = graphEl ? Array.from(graphEl.querySelectorAll(".mini-edge")) : [];

  const graphSteps = [
    { nodes: ["intent"], edges: [] },
    { nodes: ["intent", "pay"], edges: [0] },
    { nodes: ["intent", "notify"], edges: [1] },
    { nodes: ["pay", "notify"], edges: [0, 1] },
    { nodes: ["done"], edges: [2, 3] },
  ];

  let graphIndex = 0;

  const applyGraph = () => {
    const step = graphSteps[graphIndex];
    graphNodes.forEach((node) => {
      const id = node.getAttribute("data-node");
      node.classList.toggle("is-active", step.nodes.includes(id));
    });
    graphLabels.forEach((label) => {
      const id = label.getAttribute("data-node");
      label.classList.toggle("is-active", step.nodes.includes(id));
    });
    graphEdges.forEach((edge, idx) => {
      edge.classList.toggle("is-active", step.edges.includes(idx));
    });
  };

  const startGraph = () => {
    if (graphTimer || graphNodes.length === 0) return;
    applyGraph();
    graphTimer = window.setInterval(() => {
      graphIndex = (graphIndex + 1) % graphSteps.length;
      applyGraph();
    }, 1100);
  };

  const stopGraph = () => {
    if (graphTimer) {
      clearInterval(graphTimer);
      graphTimer = null;
    }
  };

  const startAll = () => {
    journeySections.forEach((section) => section.classList.add("is-live"));
    startFreedom();
    startTrace();
    startGraph();
  };

  const stopAll = () => {
    journeySections.forEach((section) => section.classList.remove("is-live"));
    stopFreedom();
    stopTrace();
    stopGraph();
  };

  const visible = new Set();
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      });
      if (visible.size > 0) startAll();
      else stopAll();
    },
    { threshold: 0.35 }
  );

  journeySections.forEach((section) => observer.observe(section));

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    stopAll();
    journeySections.forEach((section) => section.classList.add("is-live"));
    setFreedom(freedomOptions[0].id);
    applyTrace();
    applyGraph();
  }
}

function initChapters() {
  const chapters = Array.from(document.querySelectorAll("[data-chapter]"));
  if (chapters.length === 0) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    chapters.forEach((section) => section.classList.add("is-live"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle("is-live", entry.isIntersecting);
      });
    },
    { threshold: 0.4 }
  );

  chapters.forEach((section) => observer.observe(section));

  const activateHashChapter = () => {
    const hash = window.location.hash;
    if (!hash) return;
    const target = document.querySelector(hash);
    if (!target) return;
    if (target.matches("[data-chapter]")) {
      target.classList.add("is-live");
    } else {
      target.closest("[data-chapter]")?.classList.add("is-live");
    }
  };

  activateHashChapter();
  window.addEventListener("hashchange", activateHashChapter);
}

function initEcsVisual() {
  const visual = document.getElementById("ecsVisual");
  if (!visual) return;

  const order = ["compliance", "payment", "risk"];
  let idx = 0;

  const setFocus = (target) => {
    visual.querySelectorAll("[data-component]").forEach((el) => {
      el.classList.toggle("is-focus", el.getAttribute("data-component") === target);
    });
    visual.querySelectorAll("[data-flow]").forEach((el) => {
      el.classList.toggle("is-focus", el.getAttribute("data-flow") === target);
    });
  };

  setFocus(order[idx]);

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  window.setInterval(() => {
    idx = (idx + 1) % order.length;
    setFocus(order[idx]);
  }, 1700);
}

function initSignalCounters() {
  const values = Array.from(document.querySelectorAll(".signal-card__value[data-count]"));
  if (values.length === 0) return;

  const animateValue = (el) => {
    const target = Number(el.getAttribute("data-count"));
    if (!Number.isFinite(target)) return;
    const suffix = el.getAttribute("data-suffix") || "";
    const duration = 1200;
    const start = performance.now();

    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const value = Math.round(target * eased);
      el.textContent = `${value}${suffix}`;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    values.forEach((el) => {
      const target = el.getAttribute("data-count");
      const suffix = el.getAttribute("data-suffix") || "";
      el.textContent = `${target}${suffix}`;
    });
    return;
  }

  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        animateValue(entry.target);
        obs.unobserve(entry.target);
      });
    },
    { threshold: 0.55 }
  );

  values.forEach((el) => observer.observe(el));
}

function initPinSections() {
  const sections = Array.from(document.querySelectorAll(".pin-section"));
  if (sections.length === 0) return;

  const setup = () => {
    sections.forEach((section) => {
      let shell = section.querySelector(":scope > .pin-shell");
      if (!shell) {
        shell = document.createElement("div");
        shell.className = "pin-shell";
        while (section.firstChild) {
          shell.appendChild(section.firstChild);
        }
        section.appendChild(shell);
      }

      section.classList.remove("pin-tall");

      const isNarrow = window.matchMedia("(max-width: 960px)").matches;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (isNarrow || reduceMotion) {
        section.classList.add("pin-tall");
        return;
      }

      const maxPinnedHeight = window.innerHeight * 0.86;
      const contentHeight = shell.scrollHeight;
      if (contentHeight > maxPinnedHeight) {
        section.classList.add("pin-tall");
      }
    });
  };

  setup();
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(setup, 120);
  });
}
