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

  setText('[data-kpi="fastSuccess"]', pct(fastSuccessRate));
  setText('[data-kpi="slowSuccess"]', pct(slowSuccessRate));
  setText('[data-kpi="fastDuration"]', formatMs(fast.avgDurationMs || 0));
  setText('[data-kpi="slowDuration"]', formatMs(slow.avgDurationMs || 0));
  setText('[data-kpi="fastCost"]', `$${(report.fastProvider?.totalCost || 0).toFixed(3)}`);
  setText('[data-kpi="slowCost"]', `$${(report.slowProvider?.totalCost || 0).toFixed(3)}`);

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
  target.innerHTML = items
    .map(
      (r) => `
      <div class="timeline__item">
        ${r.label} • ${r.provider} • ${r.success ? "success" : "fail"}
        <span>${r.capabilities.payment || "none"} → ${r.capabilities.notification || "none"}</span>
      </div>
    `
    )
    .join("");
}

function renderGraph(runs, replay) {
  const svg = $("#flowGraph");
  if (!svg) return;

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
    const laneGapY = 120;
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

  svg.innerHTML = "";

  let maxX = 0;
  let maxY = 0;
  nodeData.forEach((node) => {
    maxX = Math.max(maxX, node.x + 200);
    maxY = Math.max(maxY, node.y + 120);
  });
  svg.setAttribute("viewBox", `0 0 ${Math.max(980, maxX)} ${Math.max(680, maxY)}`);

  edges.forEach((edge) => {
    const from = nodeData.find((n) => n.id === edge.from);
    const to = nodeData.find((n) => n.id === edge.to);
    if (!from || !to) return;
    const edgeId = edge.id || `edge-${edge.from}-${edge.to}`;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const midX = (from.x + to.x) / 2;
    path.setAttribute(
      "d",
      `M ${from.x + 160} ${from.y + 20} C ${midX} ${from.y + 20}, ${midX} ${to.y + 20}, ${to.x} ${to.y + 20}`
    );
    path.setAttribute("class", "edge");
    path.setAttribute("data-edge-id", edgeId);
    svg.appendChild(path);
  });

  nodeData.forEach((node) => {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", node.x);
    rect.setAttribute("y", node.y);
    rect.setAttribute("rx", "14");
    rect.setAttribute("ry", "14");
    rect.setAttribute("width", "160");
    rect.setAttribute("height", "40");
    rect.setAttribute("class", `node${node.accent ? " node--accent" : ""}${node.warn ? " node--warn" : ""}`);
    rect.setAttribute("data-node-id", node.id);
    if (node.info) rect.setAttribute("data-node-info", node.info);
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", node.x + 12);
    text.setAttribute("y", node.y + 26);
    text.setAttribute("fill", "#f5f6fb");
    text.setAttribute("font-family", "IBM Plex Mono, monospace");
    text.setAttribute("font-size", "12");
    text.setAttribute("class", "node-label");
    text.setAttribute("data-node-id", node.id);
    text.textContent = node.label;
    g.appendChild(rect);
    g.appendChild(text);
    svg.appendChild(g);
  });

  enablePanZoom(svg);
  enableTooltip(svg);
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
  renderGraph(runs, replay);
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

function setupReplay(replay) {
  const playBtn = document.getElementById("replayPlay");
  const pauseBtn = document.getElementById("replayPause");
  const status = document.getElementById("replayStatus");
  const stepsEl = document.getElementById("replaySteps");
  const scenariosEl = document.getElementById("replayScenarios");
  const canvas = document.querySelector(".graph__canvas");
  const scenarioContexts = document.getElementById("scenarioContexts");
  const scenarioProviders = document.getElementById("scenarioProviders");
  const scenarioOutput = document.getElementById("scenarioOutput");
  const scenarioRun = document.getElementById("scenarioRun");

  if (!replay || !replay.steps || replay.steps.length === 0) {
    if (status) status.textContent = "no replay data";
    return;
  }

  let timer = null;
  let idx = 0;
  let currentScenarioId = null;

  if (canvas) canvas.classList.remove("replay");

  const scenarios = Array.isArray(replay.scenarios) && replay.scenarios.length
    ? replay.scenarios
    : [{ id: "default", label: "All steps", steps: replay.steps }];

  const getSteps = () => {
    const scenario = scenarios.find((s) => s.id === currentScenarioId) || scenarios[0];
    return scenario.steps || replay.steps;
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
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-scenario");
        currentScenarioId = id;
        renderScenarioChips();
        idx = 0;
        applyStep(0);
        if (status) status.textContent = "ready";
      });
    });
  };

  let activeScenarioId = null;
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
      const setOutput = (item) => {
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
          applyStep(0);
          if (status) status.textContent = "ready";
        }
      };
      const first = items[0];
      if (first) setOutput(first);
      target.querySelectorAll("[data-switch]").forEach((btn) => {
        btn.addEventListener("click", () => {
          target.querySelectorAll(".graph__chip").forEach((chip) => chip.classList.remove("graph__chip--active"));
          btn.classList.add("graph__chip--active");
          const id = btn.getAttribute("data-switch");
          const item = items.find((it) => it.id === id);
          if (item) setOutput(item);
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
    step.nodes?.forEach((id) => {
      const nodes = document.querySelectorAll(`[data-node-id="${id}"]`);
      nodes.forEach((node) => {
        node.classList.add("node--revealed");
        node.classList.add("node--active");
        node.classList.remove("node--past");
      });
      const label = document.querySelectorAll(`text[data-node-id="${id}"]`);
      label.forEach((l) => l.classList.add("node-label--revealed"));
    });
    step.edges?.forEach((edgeId) => {
      const edge = document.querySelector(`[data-edge-id="${edgeId}"]`);
      if (edge) {
        edge.classList.add("edge--revealed");
        edge.classList.add("edge--active");
        edge.classList.remove("edge--past");
      }
    });
    const stepEl = stepsEl?.querySelector(`[data-step="${stepIndex}"]`);
    if (stepEl) stepEl.classList.add("graph__step--active");
    if (status) status.textContent = `${stepIndex + 1}/${steps.length} • ${step.event || "step"}`;
  };

  const play = () => {
    const steps = getSteps();
    if (timer) return;
    if (idx >= steps.length) idx = 0;
    if (status) status.textContent = "playing…";
    if (canvas) canvas.classList.add("replay");
    if (idx === 0) {
      document.querySelectorAll(".node--past").forEach((n) => n.classList.remove("node--past"));
      document.querySelectorAll(".edge--past").forEach((e) => e.classList.remove("edge--past"));
      document.querySelectorAll("[data-node-id]").forEach((n) => n.classList.remove("node--revealed"));
      document.querySelectorAll("[data-edge-id]").forEach((e) => e.classList.remove("edge--revealed"));
      document.querySelectorAll(".node-label").forEach((l) => l.classList.remove("node-label--revealed"));
    }
    applyStep(idx);
    idx += 1;
    timer = setInterval(() => {
      applyStep(idx);
      idx += 1;
      if (idx >= steps.length) {
        clearInterval(timer);
        timer = null;
        revealAll();
        if (status) status.textContent = "completed";
      }
    }, 900);
  };

  const pause = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
      if (status) status.textContent = "paused";
    }
  };

  renderSteps();
  applyStep(0);
  if (status) status.textContent = "ready";
  revealAll();
  currentScenarioId = scenarios[0]?.id || "default";
  renderScenarioChips();
  renderSwitches();

  scenarioRun?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!activeScenarioId) {
      idx = 0;
      play();
      return;
    }
    if (status) status.textContent = "running…";
    const apiBase = window.location.hostname.includes("hiwidigi.com")
      ? "https://api.hiwidigi.com"
      : "http://localhost:5174";
    fetch(`${apiBase}/run-intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenarioId: activeScenarioId }),
    })
      .then((res) => res.json())
      .then(() => {
        idx = 0;
        if (typeof bootstrap === "function") {
          bootstrap();
        }
      })
      .catch(() => {
        idx = 0;
        play();
      });
  });

  playBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    play();
  });
  pauseBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    pause();
  });
}

function enablePanZoom(svg) {
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let viewBox = svg.viewBox.baseVal;

  const onDown = (evt) => {
    isDragging = true;
    svg.style.cursor = "grabbing";
    startX = evt.clientX;
    startY = evt.clientY;
  };

  const onMove = (evt) => {
    if (!isDragging) return;
    const dx = (evt.clientX - startX) * 1.2;
    const dy = (evt.clientY - startY) * 1.2;
    viewBox.x -= dx;
    viewBox.y -= dy;
    startX = evt.clientX;
    startY = evt.clientY;
  };

  const onUp = () => {
    isDragging = false;
    svg.style.cursor = "grab";
  };

  svg.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);

  svg.addEventListener("wheel", (evt) => {
    evt.preventDefault();
    const scale = evt.deltaY > 0 ? 1.1 : 0.9;
    viewBox.width *= scale;
    viewBox.height *= scale;
  });
}

function enableTooltip(svg) {
  const tooltip = document.getElementById("graphTooltip");
  if (!tooltip) return;

  svg.addEventListener("mousemove", (evt) => {
    const target = evt.target;
    if (!(target instanceof SVGElement)) return;
    const info = target.getAttribute("data-node-info");
    if (!info) {
      tooltip.classList.remove("graph__tooltip--show");
      return;
    }
    tooltip.textContent = info;
    tooltip.style.left = `${evt.offsetX + 16}px`;
    tooltip.style.top = `${evt.offsetY + 16}px`;
    tooltip.classList.add("graph__tooltip--show");
  });

  svg.addEventListener("mouseleave", () => {
    tooltip.classList.remove("graph__tooltip--show");
  });
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
      .map(
        (trace) => `
        <div class="decision__block">
          <strong>${trace.label}</strong>
          <div class="detail__meta">Context: ${JSON.stringify(trace.context.core || {})}</div>
          ${trace.evaluations
            .map(
              (ev) => `
              <div class="decision__row">
                <span>${ev.capabilityId}</span> →
                ${ev.results
                  .map((r) => `${r.predicate.key} ${r.predicate.op} ${JSON.stringify(r.predicate.value)} = ${r.result}`)
                  .join(", ")}
              </div>
            `
            )
            .join("")}
        </div>
      `
      )
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

  all = all.slice(0, 40);

  target.innerHTML = "";
  all.forEach((entry, idx) => {
    const item = document.createElement("div");
    const success =
      entry?.event?.type?.includes("success") ||
      entry?.event?.type?.includes("created") ||
      entry?.event?.type?.includes("added");
    item.className = `eventlog__item ${success ? "eventlog__item--success" : "eventlog__item--fail"}`;
    item.style.animationDelay = `${idx * 80}ms`;
    item.textContent = `${entry.timestamp} • ${entry.event.type}`;
    target.appendChild(item);
  });
}
