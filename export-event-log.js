const fs = require("fs");
const path = require("path");

function loadEventLog(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const groups = Array.isArray(parsed) ? { default: parsed } : parsed;
  const events = [];

  for (const [group, list] of Object.entries(groups)) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const event = entry.event || {};
      const data = event.data || {};
      const timestamp = entry.timestamp || data.timestamp;
      events.push({
        group,
        timestamp,
        type: event.type || data.type || "unknown",
        runId: data.runId,
        traceId: data.traceId,
        success: typeof data.success === "boolean" ? data.success : undefined,
        provider: data.provider,
      });
    }
  }

  return events.filter((e) => e.timestamp);
}

function groupByCase(events) {
  const cases = new Map();
  for (const e of events) {
    const caseId = e.runId || e.traceId || "unknown";
    if (!cases.has(caseId)) cases.set(caseId, []);
    cases.get(caseId).push(e);
  }
  for (const list of cases.values()) {
    list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
  return cases;
}

function toCsv(events) {
  const header = [
    "case_id",
    "activity",
    "timestamp",
    "group",
    "success",
    "provider",
    "run_id",
    "trace_id",
  ];
  const rows = [header.join(",")];
  for (const e of events) {
    rows.push(
      [
        e.runId || e.traceId || "unknown",
        e.type,
        e.timestamp,
        e.group,
        typeof e.success === "boolean" ? String(e.success) : "",
        e.provider || "",
        e.runId || "",
        e.traceId || "",
      ]
        .map(escapeCsv)
        .join(",")
    );
  }
  return rows.join("\n");
}

function escapeCsv(value) {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toXes(cases) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8" ?>');
  lines.push(
    '<log xes.version="1.0" xes.features="nested-attributes" openxes.version="1.0RC7" xmlns="http://www.xes-standard.org/">'
  );
  lines.push('  <extension name="Concept" prefix="concept" uri="http://www.xes-standard.org/concept.xesext"/>');
  lines.push('  <extension name="Time" prefix="time" uri="http://www.xes-standard.org/time.xesext"/>');

  for (const [caseId, events] of cases.entries()) {
    lines.push("  <trace>");
    lines.push(`    <string key="concept:name" value="${escapeXml(caseId)}"/>`);
    for (const e of events) {
      lines.push("    <event>");
      lines.push(`      <string key="concept:name" value="${escapeXml(e.type)}"/>`);
      lines.push(`      <date key="time:timestamp" value="${escapeXml(e.timestamp)}"/>`);
      if (e.group) {
        lines.push(`      <string key="group" value="${escapeXml(e.group)}"/>`);
      }
      if (typeof e.success === "boolean") {
        lines.push(`      <string key="success" value="${e.success}"/>`);
      }
      if (e.provider) {
        lines.push(`      <string key="provider" value="${escapeXml(e.provider)}"/>`);
      }
      if (e.runId) {
        lines.push(`      <string key="runId" value="${escapeXml(e.runId)}"/>`);
      }
      if (e.traceId) {
        lines.push(`      <string key="traceId" value="${escapeXml(e.traceId)}"/>`);
      }
      lines.push("    </event>");
    }
    lines.push("  </trace>");
  }

  lines.push("</log>");
  return lines.join("\n");
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function main() {
  const input = process.argv[2] || "hiwios_ts/examples/demo/hiwi_event_log.json";
  const outputBase = process.argv[3] || "hiwios_ts/examples/demo/hiwi_event_log";

  const events = loadEventLog(input);
  if (!events.length) {
    console.error("No events found. Check input:", input);
    process.exit(1);
  }

  const cases = groupByCase(events);
  const csv = toCsv(events);
  const xes = toXes(cases);

  fs.writeFileSync(`${outputBase}.csv`, csv, "utf8");
  fs.writeFileSync(`${outputBase}.xes`, xes, "utf8");

  console.log(`Wrote ${events.length} events to ${outputBase}.csv`);
  console.log(`Wrote ${cases.size} cases to ${outputBase}.xes`);
}

main();
