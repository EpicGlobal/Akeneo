import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(currentFile);
const repoRoot = path.dirname(scriptsDir);
const auditHarnessRoot = path.resolve(repoRoot, "..", "Audit Harness");

const { runAudit } = await import(pathToFileURL(path.join(auditHarnessRoot, "src", "audit-core.mjs")).href);
const {
  buildAiHandoff,
  buildIssueExport,
  buildIssueExportCsv,
  buildReportMarkdown,
  buildReviewPrompt,
  renderReportHtml,
  syncReportsIndex,
} = await import(pathToFileURL(path.join(auditHarnessRoot, "src", "reporting.mjs")).href);

const defaultConfigPaths = [
  path.join(auditHarnessRoot, "configs", "operator-akeneo-dev.json"),
  path.join(auditHarnessRoot, "configs", "operator-akeneo-product-edit-dev.json"),
];

const shellHeavyScreens = new Set([
  "dashboard-home",
  "connect-data-flows",
  "settings-home",
  "system-home",
]);

const denseExpertSurfaceScreens = new Set([
  "products-grid",
  "imports-home",
  "exports-home",
  "product-edit-attributes",
  "product-edit-dam",
]);

const shellSamplePatterns = [
  /^button\.BrandGuideButton\b/i,
  /^a#pim-menu-/i,
  /^a#akeneo-data-quality-insights-menu-/i,
];

function toPosixPath(value = "") {
  return String(value || "").replace(/\\/g, "/");
}

function parseArgs(argv = []) {
  const parsed = {
    configPaths: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    if (arg === "--config") {
      const nextArg = argv[index + 1] || "";
      if (nextArg) {
        parsed.configPaths.push(nextArg);
      }
      index += 1;
      continue;
    }

    if (!arg.startsWith("-")) {
      parsed.configPaths.push(arg);
    }
  }

  return parsed;
}

function resolveConfigPath(value = "") {
  if (!value) {
    return "";
  }

  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

function samplesLookLikePersistentShell(samples = []) {
  if (!Array.isArray(samples) || !samples.length) {
    return false;
  }

  return samples.every((sample) => shellSamplePatterns.some((pattern) => pattern.test(String(sample || "").trim())));
}

function shouldIgnoreIssue(issue = {}) {
  const screen = issue.screen || "";
  const checkId = issue.checkId || issue.type || "";

  if (issue.category !== "ui-heuristic" || issue.layer !== "deep") {
    return false;
  }

  if (denseExpertSurfaceScreens.has(screen) && (checkId === "action-focus" || checkId === "control-density")) {
    return true;
  }

  if (shellHeavyScreens.has(screen) && checkId === "action-focus" && samplesLookLikePersistentShell(issue.samples || [])) {
    return true;
  }

  return false;
}

function buildCheckFingerprint(screen = "", viewport = "", checkId = "") {
  return `heuristic|${screen}|${viewport}|${checkId}`;
}

function neutralizedSummary(screen = "", checkId = "") {
  if (denseExpertSurfaceScreens.has(screen)) {
    return "This surface is an expert data grid/editor, so Operator's shell-aware deep audit does not treat expected control density as a defect.";
  }

  if (checkId === "action-focus") {
    return "Persistent suite navigation is intentionally always visible on this surface, so shell-aware deep audit does not count it as page-level next-step noise.";
  }

  return "Shell-aware Operator audit marked this deep heuristic as expected for the suite chrome on this surface.";
}

function neutralizeHeuristicChecks(heuristics = {}, screen = "", viewport = "", ignoredFingerprints = new Set()) {
  if (!heuristics || !Array.isArray(heuristics.checks)) {
    return;
  }

  for (const check of heuristics.checks) {
    const fingerprint = buildCheckFingerprint(screen, viewport, check.id);
    if (!ignoredFingerprints.has(fingerprint)) {
      continue;
    }

    check.status = "pass";
    check.count = 0;
    check.samples = [];
    check.summary = neutralizedSummary(screen, check.id);
    check.details = "The app-specific Operator audit boundary excludes persistent Akeneo shell chrome and expected expert-surface density from deep heuristic failures.";
  }

  const failingChecks = heuristics.checks.filter((check) => check.status === "fail");
  heuristics.issueCount = failingChecks.length;
  heuristics.criticalCount = failingChecks.filter((check) => check.severity === "critical").length;
  heuristics.warningCount = failingChecks.filter((check) => check.severity === "warning").length;
  heuristics.coreIssueCount = failingChecks.filter((check) => check.layer === "core").length;
  heuristics.deepIssueCount = failingChecks.filter((check) => check.layer === "deep").length;
  heuristics.failingCheckIds = failingChecks.map((check) => check.id);
}

function recomputeViewportSummary(viewport = {}) {
  const screenshots = Array.isArray(viewport.screenshots) ? viewport.screenshots : [];
  const consoleIssues = Array.isArray(viewport.consoleIssues) ? viewport.consoleIssues.length : 0;
  const pageErrors = Array.isArray(viewport.pageErrors) ? viewport.pageErrors.length : 0;

  viewport.screenshotCount = screenshots.length;
  viewport.heuristicIssueCount = screenshots.reduce((sum, screenshot) => sum + Number(screenshot.heuristics?.issueCount || 0), 0);
  viewport.criticalHeuristicIssues = screenshots.reduce((sum, screenshot) => sum + Number(screenshot.heuristics?.criticalCount || 0), 0);
  viewport.warningHeuristicIssues = screenshots.reduce((sum, screenshot) => sum + Number(screenshot.heuristics?.warningCount || 0), 0);
  viewport.deepHeuristicIssues = screenshots.reduce((sum, screenshot) => sum + Number(screenshot.heuristics?.deepIssueCount || 0), 0);
  viewport.issueCount = consoleIssues + pageErrors + viewport.heuristicIssueCount;
}

function recomputeReportSummary(report = {}) {
  const viewports = Array.isArray(report.viewports) ? report.viewports : [];
  const healthChecks = Array.isArray(report.healthChecks) ? report.healthChecks : [];

  report.summary = {
    ...report.summary,
    healthChecksConfigured: healthChecks.length,
    healthCheckFailures: healthChecks.filter((check) => !check.ok).length,
    browserIssues: viewports.reduce((sum, viewport) => (
      sum
      + (Array.isArray(viewport.consoleIssues) ? viewport.consoleIssues.length : 0)
      + (Array.isArray(viewport.pageErrors) ? viewport.pageErrors.length : 0)
    ), 0),
    runNotes: viewports.reduce((sum, viewport) => sum + Number(viewport.noteCount || 0), 0),
    heuristicIssues: viewports.reduce((sum, viewport) => sum + Number(viewport.heuristicIssueCount || 0), 0),
    criticalHeuristicIssues: viewports.reduce((sum, viewport) => sum + Number(viewport.criticalHeuristicIssues || 0), 0),
    warningHeuristicIssues: viewports.reduce((sum, viewport) => sum + Number(viewport.warningHeuristicIssues || 0), 0),
    deepUiFindings: viewports.reduce((sum, viewport) => sum + Number(viewport.deepHeuristicIssues || 0), 0),
    screenshotCount: viewports.reduce((sum, viewport) => sum + Number(viewport.screenshotCount || 0), 0),
    viewportCount: viewports.length,
    authenticatedViewports: viewports.filter((viewport) => Boolean(viewport.authenticated)).length,
    screensConfigured: Array.isArray(report.screenGroups) ? report.screenGroups.length : 0,
    openIssues: 0,
  };

  report.summary.openIssues = report.summary.healthCheckFailures + report.summary.browserIssues + report.summary.heuristicIssues;
}

async function postProcessReport(reportDirectory = "") {
  const reportJsonPath = path.join(reportDirectory, "report.json");
  const report = JSON.parse(await fs.readFile(reportJsonPath, "utf8"));
  const currentIssues = Array.isArray(report.issues)
    ? report.issues
    : Array.isArray(report.issues?.items)
      ? report.issues.items
      : [];
  const ignoredIssues = currentIssues.filter(shouldIgnoreIssue);
  const ignoredFingerprints = new Set(ignoredIssues.map((issue) => issue.fingerprint));

  if (!ignoredFingerprints.size) {
    return {
      report,
      ignoredIssues: [],
    };
  }

  for (const viewport of report.viewports || []) {
    for (const screenshot of viewport.screenshots || []) {
      neutralizeHeuristicChecks(screenshot.heuristics, screenshot.screen, screenshot.viewport, ignoredFingerprints);
    }
    recomputeViewportSummary(viewport);
  }

  for (const group of report.screenGroups || []) {
    for (const variant of group.variants || []) {
      neutralizeHeuristicChecks(variant.heuristics, group.name, variant.viewport, ignoredFingerprints);
      variant.issueCount = Number(variant.heuristics?.issueCount || 0);
    }
    group.issueCount = (group.variants || []).reduce((sum, variant) => sum + Number(variant.issueCount || 0), 0);
  }

  report.comparison = null;
  report.execution = {
    ...report.execution,
    runnerLabel: "Operator Shell-Aware Deep Review",
    auditBoundary: {
      kind: "operator-shell-aware",
      ignoredIssueCount: ignoredIssues.length,
      ignoredFingerprints: ignoredIssues.map((issue) => issue.fingerprint),
    },
  };

  recomputeReportSummary(report);
  report.issues = buildIssueExport(report);
  const aiHandoff = buildAiHandoff(report);

  await fs.writeFile(path.join(reportDirectory, "report.md"), buildReportMarkdown(report));
  await fs.writeFile(path.join(reportDirectory, "review-prompt.md"), buildReviewPrompt(report));
  await fs.writeFile(path.join(reportDirectory, "report.html"), renderReportHtml(report));
  await fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(path.join(reportDirectory, "ai-handoff.json"), `${JSON.stringify(aiHandoff, null, 2)}\n`);
  await fs.writeFile(path.join(reportDirectory, "issues.json"), `${JSON.stringify(report.issues, null, 2)}\n`);
  await fs.writeFile(path.join(reportDirectory, "issues.csv"), buildIssueExportCsv(report.issues));
  await syncReportsIndex(path.join(auditHarnessRoot, "reports"));

  return {
    report,
    ignoredIssues,
  };
}

async function runShellAwareAudit(configPath = "") {
  console.log(`Running shell-aware deep audit for ${toPosixPath(path.relative(auditHarnessRoot, configPath))}`);

  const result = await runAudit({
    configPath,
    viewportPresetId: "config-default",
    reviewDepthId: "deep",
    env: {
      AUDIT_EMAIL: process.env.AUDIT_EMAIL,
      AUDIT_PASSWORD: process.env.AUDIT_PASSWORD,
    },
    onProgress(event) {
      if (!event?.message) {
        return;
      }
      console.log(`[${event.phase || "info"}] ${event.message}`);
    },
  });

  const postProcessed = await postProcessReport(result.reportDirectory);

  console.log(`Audit complete: ${result.reportDirectory}`);
  console.log(`Ignored shell-aware issues: ${postProcessed.ignoredIssues.length}`);
  console.log(`Heuristic findings after post-processing: ${postProcessed.report.summary.heuristicIssues}`);
  console.log(`HTML report: ${path.join(result.reportDirectory, "report.html")}`);
  console.log(`Issues JSON: ${path.join(result.reportDirectory, "issues.json")}`);

  return {
    reportDirectory: result.reportDirectory,
    report: postProcessed.report,
    ignoredIssues: postProcessed.ignoredIssues,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPaths = (args.configPaths.length ? args.configPaths : defaultConfigPaths).map(resolveConfigPath);

  if (!process.env.AUDIT_EMAIL || !process.env.AUDIT_PASSWORD) {
    throw new Error("AUDIT_EMAIL and AUDIT_PASSWORD must be set before running the shell-aware audit.");
  }

  const results = [];

  for (const configPath of configPaths) {
    results.push(await runShellAwareAudit(configPath));
  }

  console.log("");
  console.log("Shell-aware deep audit summary:");
  for (const result of results) {
    console.log(`- ${result.report.targetName}: ${result.report.summary.heuristicIssues} heuristic findings after filtering, ${result.ignoredIssues.length} ignored shell-aware deep issues.`);
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
