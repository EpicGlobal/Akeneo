require('./lib/bootstrap-env');

const http = require('http');

const { createAmazonClient } = require('./lib/amazon-client');
const {
  amazonCredentialStatus,
  createTenantConfig,
  findMarketplace,
  findTenant,
  getTenantAdminSettings,
  getTenantAmazonConfig,
  listMarketplaces,
  listTenants,
  updateTenantAdminSettings,
} = require('./lib/config-loader');
const { createListingWriterClient } = require('./lib/epic-ai-client');
const { evaluateWorkflow } = require('./lib/engine');
const { notFound, readJsonBody, sendJson } = require('./lib/http');
const { applyAutoApprovedChanges } = require('./lib/proposal-engine');
const {
  createJob,
  createRun,
  ensureSchema,
  getAlert,
  getCatalogProduct,
  getJob,
  getProposal,
  getRun,
  getState,
  listCatalogProducts,
  listAlerts,
  listJobs,
  listNotifications,
  listProposals,
  listRuns,
  listSnapshots,
  setState,
  updateAlert,
  updateProposal,
  upsertCatalogProduct,
} = require('./lib/store');

const port = Number(process.env.MARKETPLACE_ORCHESTRATOR_PORT || 8090);
const publicBaseUrl = String(process.env.MARKETPLACE_ORCHESTRATOR_PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');
const publicBasePath = (() => {
  try {
    const pathname = new URL(publicBaseUrl).pathname.replace(/\/+$/, '');
    return '/' === pathname ? '' : pathname;
  } catch (error) {
    return '';
  }
})();

function withPublicBasePath(pathname) {
  const normalizedPath = String(pathname || '').startsWith('/') ? String(pathname || '') : `/${String(pathname || '')}`;
  return `${publicBasePath}${normalizedPath}`;
}

function sendHtml(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(body);
}

function tenantSummary(tenant) {
  const listingWriterClient = createListingWriterClient(tenant.code);

  return {
    code: tenant.code,
    label: tenant.label,
    marketplaces: (tenant.marketplaces || []).map((marketplace) => ({
      code: marketplace.code,
      label: marketplace.label,
      channel: marketplace.channel,
      locale: marketplace.locale,
      market: marketplace.market,
    })),
    amazon: tenant.amazon ? {
      enabled: tenant.amazon.enabled !== false,
      mode: tenant.amazon.mode || 'mock',
      sellerId: tenant.amazon.sellerId || null,
      pilotFamilyCodes: tenant.amazon.pilotFamilyCodes || [],
      brandSources: (tenant.amazon.brandSources || []).map((source) => ({
        code: source.code,
        label: source.label,
        marketplaceCode: source.marketplaceCode || null,
        sku: source.sku || null,
      })),
      credentialStatus: amazonCredentialStatus(tenant.amazon),
    } : null,
    ai: tenant.ai?.listingWriter ? {
      enabled: tenant.ai.listingWriter.enabled !== false,
      providerIds: tenant.ai.listingWriter.providerIds || [],
      readiness: listingWriterClient.readiness(),
    } : null,
  };
}

function statusCounts(records, field) {
  return records.reduce((summary, record) => {
    const key = record[field] || 'unknown';
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});
}

async function buildDashboardSummary(tenantCode = null) {
  const [runs, jobs, alerts, proposals, notifications, snapshots] = await Promise.all([
    listRuns({ tenantCode: tenantCode || undefined }),
    listJobs({ tenantCode: tenantCode || undefined }),
    listAlerts({ tenantCode: tenantCode || undefined }),
    listProposals({ tenantCode: tenantCode || undefined }),
    listNotifications({ tenantCode: tenantCode || undefined }),
    listSnapshots({ tenantCode: tenantCode || undefined }),
  ]);

  const activeAlerts = alerts.filter((alert) => !['acknowledged', 'resolved'].includes(alert.status));
  const tenants = [];

  for (const tenant of listTenants().filter((tenant) => !tenantCode || tenant.code === tenantCode)) {
      const tenantJobs = jobs.filter((job) => job.tenantCode === tenant.code);
      const tenantRuns = runs.filter((run) => run.tenantCode === tenant.code);
      const tenantAlerts = alerts.filter((alert) => alert.tenantCode === tenant.code);
      const tenantProposals = proposals.filter((proposal) => proposal.tenantCode === tenant.code);
      const tenantSnapshots = snapshots.filter((snapshot) => snapshot.tenantCode === tenant.code);
      const tenantNotifications = notifications.filter((notification) => notification.tenantCode === tenant.code);
      const tenantCatalogRecords = await listCatalogProducts(tenant.code);
      const tenantCatalogProducts = tenantCatalogRecords.length;
      const tenantReadiness = readinessSummary(tenantCatalogRecords);
      const tenantListingHealth = listingHealthSummary(
        tenantSnapshots.filter((snapshot) => snapshot.type === 'amazon_listing_status')
      );
      const tenantAccountHealth = accountHealthSummary(
        tenantSnapshots.filter((snapshot) => snapshot.type === 'amazon_account_health')
      );
      const adminSettings = getTenantAdminSettings(tenant.code);

      tenants.push({
        ...tenantSummary(tenant),
        admin: adminSettings,
        queue: statusCounts(tenantJobs, 'status'),
        runs: statusCounts(tenantRuns, 'status'),
        alerts: {
          total: tenantAlerts.length,
          active: tenantAlerts.filter((alert) => !['acknowledged', 'resolved'].includes(alert.status)).length,
          bySeverity: statusCounts(tenantAlerts, 'severity'),
        },
        proposals: statusCounts(tenantProposals, 'status'),
        notifications: tenantNotifications.length,
        snapshots: tenantSnapshots.length,
        catalogProducts: tenantCatalogProducts,
        publishReadiness: tenantReadiness,
        listingHealth: tenantListingHealth,
        accountHealth: tenantAccountHealth,
        marketplaces: (tenant.marketplaces || []).map((marketplace) => {
          const marketplaceJobs = tenantJobs.filter((job) => job.marketplaceCode === marketplace.code);
          const marketplaceRuns = tenantRuns.filter((run) => run.marketplaceCode === marketplace.code);
          const marketplaceAlerts = tenantAlerts.filter((alert) => alert.marketplaceCode === marketplace.code);
          const marketplaceProposals = tenantProposals.filter((proposal) => proposal.marketplaceCode === marketplace.code);
          const marketplaceListingHealth = listingHealthSummary(
            tenantSnapshots.filter((snapshot) => snapshot.type === 'amazon_listing_status' && snapshot.marketplaceCode === marketplace.code)
          );
          const marketplaceReadiness = readinessSummary(
            tenantCatalogRecords.filter((record) => (record.marketplaceCodes || []).includes(marketplace.code))
          );

          return {
            code: marketplace.code,
            label: marketplace.label,
            channel: marketplace.channel,
            queue: statusCounts(marketplaceJobs, 'status'),
            runs: statusCounts(marketplaceRuns, 'status'),
            alerts: {
              total: marketplaceAlerts.length,
              active: marketplaceAlerts.filter((alert) => !['acknowledged', 'resolved'].includes(alert.status)).length,
              bySeverity: statusCounts(marketplaceAlerts, 'severity'),
            },
            proposals: statusCounts(marketplaceProposals, 'status'),
            publishReadiness: marketplaceReadiness,
            listingHealth: marketplaceListingHealth,
          };
        }),
      });
  }

  return {
    generatedAt: new Date().toISOString(),
    store: 'mysql',
    totals: {
      tenants: tenants.length,
      queuedJobs: jobs.filter((job) => job.status === 'queued').length,
      processingJobs: jobs.filter((job) => job.status === 'processing').length,
      failedJobs: jobs.filter((job) => job.status === 'failed').length,
      activeAlerts: activeAlerts.length,
      openProposals: proposals.filter((proposal) => proposal.status === 'open').length,
      notifications: notifications.length,
      snapshots: snapshots.length,
      runs: runs.length,
      catalogProducts: tenants.reduce((total, tenant) => total + Number(tenant.catalogProducts || 0), 0),
      readyCatalogProducts: tenants.reduce((total, tenant) => total + Number(tenant.publishReadiness?.ready || 0), 0),
      blockedCatalogProducts: tenants.reduce((total, tenant) => total + Number(tenant.publishReadiness?.blocked || 0), 0),
    },
    tenants,
    recent: {
      jobs: jobs.slice(0, 10),
      alerts: alerts.slice(0, 10),
      runs: runs.slice(0, 10),
      proposals: proposals.slice(0, 10),
    },
  };
}

function renderDashboardPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Operator Marketplace Dashboard</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; background: #f4f7fb; color: #1f3043; }
    .wrap { max-width: 1280px; margin: 0 auto; padding: 24px; }
    h1, h2, h3 { margin: 0; }
    .hero { display: grid; gap: 8px; margin-bottom: 20px; }
    .muted { color: #62748a; font-size: 14px; }
    .stats, .tenant-grid, .market-grid, .recent-grid { display: grid; gap: 14px; }
    .stats { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); margin-bottom: 20px; }
    .tenant-grid, .recent-grid { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
    .market-grid { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .card { background: #fff; border: 1px solid #dce4ee; border-radius: 18px; padding: 18px; box-shadow: 0 10px 24px rgba(33, 53, 71, 0.06); }
    .stat { font-size: 28px; font-weight: 700; margin-top: 8px; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .pill { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px; background: #e8eef6; font-size: 12px; font-weight: 700; color: #304d68; }
    .pill.warn { background: #fff0db; color: #8a5200; }
    .pill.bad { background: #fde9e7; color: #a02a27; }
    .pill.good { background: #def4e7; color: #0c6a3a; }
    .list { margin: 12px 0 0; padding: 0; list-style: none; display: grid; gap: 10px; }
    .list li { padding: 12px; border: 1px solid #e6ebf2; border-radius: 12px; background: #fbfcfe; }
    code { font-family: Consolas, monospace; font-size: 12px; }
    .empty { color: #708299; font-size: 14px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <h1>Operator Marketplace Operations</h1>
      <div class="muted">Queue depth, Amazon readiness, pilot-family cutover, alerts, and recent runs.</div>
    </div>
    <div id="app" class="empty">Loading dashboard...</div>
  </div>
  <script>
    function pill(label, kind) {
      return '<span class="pill ' + (kind || '') + '">' + label + '</span>';
    }

    function renderCounts(title, counts) {
      const entries = Object.entries(counts || {});
      if (!entries.length) {
        return '<div class="muted">' + title + ': none</div>';
      }

      return '<div class="meta">' + entries.map(([key, value]) => pill(title + ' ' + key + ': ' + value)).join('') + '</div>';
    }

    function renderRecent(items, title, mapper) {
      if (!items.length) {
        return '<div class="card"><h3>' + title + '</h3><div class="empty">No recent records.</div></div>';
      }

      return '<div class="card"><h3>' + title + '</h3><ul class="list">' +
        items.map(mapper).join('') + '</ul></div>';
    }

    fetch('${withPublicBasePath('/v1/dashboard')}')
      .then((response) => response.json())
      .then((data) => {
        const totals = data.totals || {};
        const app = document.getElementById('app');
        app.innerHTML =
          '<div class="stats">' +
            '<div class="card"><div class="muted">Queued jobs</div><div class="stat">' + (totals.queuedJobs || 0) + '</div></div>' +
            '<div class="card"><div class="muted">Processing jobs</div><div class="stat">' + (totals.processingJobs || 0) + '</div></div>' +
            '<div class="card"><div class="muted">Failed jobs</div><div class="stat">' + (totals.failedJobs || 0) + '</div></div>' +
            '<div class="card"><div class="muted">Active alerts</div><div class="stat">' + (totals.activeAlerts || 0) + '</div></div>' +
            '<div class="card"><div class="muted">Open proposals</div><div class="stat">' + (totals.openProposals || 0) + '</div></div>' +
            '<div class="card"><div class="muted">Notifications</div><div class="stat">' + (totals.notifications || 0) + '</div></div>' +
          '</div>' +
          '<div class="tenant-grid">' +
            (data.tenants || []).map((tenant) => {
              const amazon = tenant.amazon || null;
              return '<div class="card">' +
                '<h2>' + tenant.label + '</h2>' +
                '<div class="muted"><code>' + tenant.code + '</code></div>' +
                '<div class="meta">' +
                  (amazon ? pill('Amazon ' + (amazon.mode || 'mock'), amazon.mode === 'live' ? 'good' : 'warn') : '') +
                  (amazon && amazon.pilotFamilyCodes && amazon.pilotFamilyCodes.length ? pill('Pilot families: ' + amazon.pilotFamilyCodes.join(', '), 'warn') : '') +
                  pill('Alerts: ' + ((tenant.alerts || {}).active || 0), ((tenant.alerts || {}).active || 0) ? 'bad' : 'good') +
                '</div>' +
                renderCounts('Queue', tenant.queue) +
                renderCounts('Runs', tenant.runs) +
                renderCounts('Proposals', tenant.proposals) +
                '<div class="market-grid" style="margin-top:14px;">' +
                  (tenant.marketplaces || []).map((marketplace) =>
                    '<div class="card">' +
                      '<h3>' + marketplace.label + '</h3>' +
                      '<div class="muted">' + marketplace.channel + '</div>' +
                      renderCounts('Queue', marketplace.queue) +
                      renderCounts('Runs', marketplace.runs) +
                      '<div class="meta">' +
                        pill('Alerts: ' + ((marketplace.alerts || {}).active || 0), ((marketplace.alerts || {}).active || 0) ? 'bad' : 'good') +
                      '</div>' +
                    '</div>'
                  ).join('') +
                '</div>' +
              '</div>';
            }).join('') +
          '</div>' +
          '<div class="recent-grid" style="margin-top:20px;">' +
            renderRecent(data.recent?.jobs || [], 'Recent jobs', (job) =>
              '<li><strong>' + job.type + '</strong><div class="muted">' + (job.marketplaceCode || 'global') + ' • ' + job.status + '</div></li>'
            ) +
            renderRecent(data.recent?.alerts || [], 'Recent alerts', (alert) =>
              '<li><strong>' + alert.title + '</strong><div class="muted">' + alert.severity + ' • ' + alert.status + '</div></li>'
            ) +
            renderRecent(data.recent?.runs || [], 'Recent runs', (run) =>
              '<li><strong>' + (run.marketplaceCode || 'unknown') + '</strong><div class="muted">' + run.status + ' • ' + (run.product?.identifier || 'unknown SKU') + '</div></li>'
            ) +
            renderRecent(data.recent?.proposals || [], 'Recent proposals', (proposal) =>
              '<li><strong>' + proposal.sku + '</strong><div class="muted">' + proposal.field + ' • ' + proposal.status + '</div></li>'
            ) +
          '</div>';
      })
      .catch((error) => {
        document.getElementById('app').textContent = error.message || 'Failed to load dashboard.';
      });
  </script>
</body>
</html>`;
}

function resolveWorkflow(tenantCode, marketplaceCode, response) {
  const tenant = findTenant(tenantCode);
  if (!tenant) {
    sendJson(response, 404, { error: `Unknown tenant "${tenantCode}".` });
    return null;
  }

  const marketplace = findMarketplace(tenantCode, marketplaceCode);
  if (!marketplace) {
    sendJson(response, 404, { error: `Unknown marketplace "${marketplaceCode}" for tenant "${tenantCode}".` });
    return null;
  }

  return { tenant, marketplace };
}

async function queueJob(response, payload) {
  const job = await createJob(payload);
  sendJson(response, 202, job);
}

async function persistCatalogProduct(tenantCode, marketplaceCode, payload) {
  const product = payload.product || {};
  const sku = product.identifier || payload.sku || null;
  if (!sku) {
    return null;
  }

  return upsertCatalogProduct({
    tenantCode,
    marketplaceCode,
    sku,
    product,
  });
}

function requestBodySku(payload) {
  return payload?.sku || payload?.product?.identifier || null;
}

function defaultOnboardingState(tenantCode) {
  return {
    tenantCode,
    status: 'in_progress',
    currentStep: 'workspace',
    completedSteps: [],
    notes: '',
    updatedAt: new Date().toISOString(),
  };
}

function onboardingStateKey(tenantCode) {
  return `tenant_onboarding::${tenantCode}`;
}

function applyProposalToProduct(product, proposal) {
  const nextProduct = JSON.parse(JSON.stringify(product || {}));
  nextProduct.attributes = nextProduct.attributes || {};

  if ('title' === proposal.field) {
    nextProduct.attributes.marketplace_title = proposal.proposedValue;
    return nextProduct;
  }

  if ('description' === proposal.field) {
    nextProduct.attributes.description = proposal.proposedValue;
    return nextProduct;
  }

  nextProduct.attributes[proposal.field] = proposal.proposedValue;

  return nextProduct;
}

function readinessSummary(catalogRecords) {
  let ready = 0;
  let blocked = 0;
  let unknown = 0;
  let completenessTotal = 0;
  let completenessCount = 0;

  for (const record of catalogRecords) {
    const governance = record.product?.governance || {};
    if (governance.publishStatus === 'ready') {
      ready += 1;
    } else if (governance.publishStatus === 'blocked') {
      blocked += 1;
    } else {
      unknown += 1;
    }

    const completeness = Number(governance.completenessScore);
    if (Number.isFinite(completeness)) {
      completenessTotal += completeness;
      completenessCount += 1;
    }
  }

  return {
    ready,
    blocked,
    unknown,
    averageCompleteness: completenessCount > 0 ? Number((completenessTotal / completenessCount).toFixed(2)) : 0,
  };
}

function summarizeListingIssues(statusPayload) {
  return statusPayload?.issues
    || statusPayload?.payload?.issues
    || [];
}

function listingIsHealthy(statusPayload) {
  const statuses = statusPayload?.summaries?.[0]?.status || [];
  return statuses.includes('BUYABLE') && statuses.includes('DISCOVERABLE');
}

function listingHealthSummary(snapshots) {
  let healthy = 0;
  let unhealthy = 0;
  let unknown = 0;

  for (const snapshot of snapshots) {
    const issues = summarizeListingIssues(snapshot.payload || {});
    if (!snapshot.payload) {
      unknown += 1;
      continue;
    }

    if (listingIsHealthy(snapshot.payload) && issues.length === 0) {
      healthy += 1;
      continue;
    }

    unhealthy += 1;
  }

  return {
    healthy,
    unhealthy,
    unknown,
  };
}

function accountHealthSummary(snapshots) {
  const latest = snapshots[0]?.payload || null;
  const suspendedMarketplaces = (latest?.marketplaces?.payload || [])
    .filter((entry) => entry?.participation?.hasSuspendedListings)
    .length;

  return {
    hasSnapshot: Boolean(latest),
    suspendedMarketplaces,
    reportId: latest?.report?.reportId || null,
  };
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (request.method === 'GET' && url.pathname === '/health') {
    const [alerts, queuedJobs, openProposals] = await Promise.all([
      listAlerts({}),
      listJobs({ status: 'queued' }),
      listProposals({ status: 'open' }),
    ]);
    const activeAlerts = alerts.filter((alert) => !['acknowledged', 'resolved'].includes(alert.status)).length;

    sendJson(response, 200, {
      status: 'ok',
      service: 'marketplace-orchestrator',
      store: 'mysql',
      queuedJobs: queuedJobs.length,
      openAlerts: activeAlerts,
      openProposals: openProposals.length,
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/dashboard') {
    sendHtml(response, 200, renderDashboardPage());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/v1/dashboard') {
    sendJson(response, 200, await buildDashboardSummary(url.searchParams.get('tenant') || null));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/v1/reports/overview') {
    sendJson(response, 200, await buildDashboardSummary(url.searchParams.get('tenant') || null));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/v1/tenants') {
    sendJson(response, 200, {
      tenants: listTenants().map(tenantSummary),
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/tenants') {
    const payload = await readJsonBody(request);
    const tenant = createTenantConfig(payload);
    sendJson(response, 201, tenantSummary(tenant));
    return;
  }

  if (request.method === 'GET' && parts.length === 4 && parts[0] === 'v1' && parts[1] === 'tenants' && parts[3] === 'marketplaces') {
    const tenant = findTenant(parts[2]);
    if (!tenant) {
      sendJson(response, 404, { error: `Unknown tenant "${parts[2]}".` });
      return;
    }

    sendJson(response, 200, tenantSummary(tenant));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/v1/runs') {
    sendJson(response, 200, {
      runs: await listRuns({
        tenantCode: url.searchParams.get('tenant') || undefined,
        marketplaceCode: url.searchParams.get('marketplace') || undefined,
        status: url.searchParams.get('status') || undefined,
      }),
    });
    return;
  }

  if (request.method === 'GET' && parts.length === 3 && parts[0] === 'v1' && parts[1] === 'runs') {
    const run = await getRun(parts[2]);
    if (!run) {
      sendJson(response, 404, { error: `Unknown run "${parts[2]}".` });
      return;
    }

    sendJson(response, 200, run);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/v1/jobs') {
    sendJson(response, 200, {
      jobs: await listJobs({
        tenantCode: url.searchParams.get('tenant') || undefined,
        marketplaceCode: url.searchParams.get('marketplace') || undefined,
        status: url.searchParams.get('status') || undefined,
        type: url.searchParams.get('type') || undefined,
      }),
    });
    return;
  }

  if (request.method === 'GET' && parts.length === 3 && parts[0] === 'v1' && parts[1] === 'jobs') {
    const job = await getJob(parts[2]);
    if (!job) {
      sendJson(response, 404, { error: `Unknown job "${parts[2]}".` });
      return;
    }

    sendJson(response, 200, job);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/v1/alerts') {
    sendJson(response, 200, {
      alerts: await listAlerts({
        tenantCode: url.searchParams.get('tenant') || undefined,
        marketplaceCode: url.searchParams.get('marketplace') || undefined,
        status: url.searchParams.get('status') || undefined,
      }),
    });
    return;
  }

  if (request.method === 'POST' && parts.length === 4 && parts[0] === 'v1' && parts[1] === 'alerts') {
    const alert = await getAlert(parts[2]);
    if (!alert) {
      sendJson(response, 404, { error: `Unknown alert "${parts[2]}".` });
      return;
    }

    const action = parts[3];
    if (!['acknowledge', 'resolve'].includes(action)) {
      sendJson(response, 404, { error: `Unsupported alert action "${action}".` });
      return;
    }

    const updated = await updateAlert(parts[2], (current) => ({
      ...current,
      status: action === 'acknowledge' ? 'acknowledged' : 'resolved',
      acknowledgedAt: action === 'acknowledge' ? new Date().toISOString() : current.acknowledgedAt,
    }));

    sendJson(response, 200, updated);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/v1/proposals') {
    sendJson(response, 200, {
      proposals: await listProposals({
        tenantCode: url.searchParams.get('tenant') || undefined,
        marketplaceCode: url.searchParams.get('marketplace') || undefined,
        sku: url.searchParams.get('sku') || undefined,
        status: url.searchParams.get('status') || undefined,
      }),
    });
    return;
  }

  if (request.method === 'GET' && parts.length === 3 && parts[0] === 'v1' && parts[1] === 'proposals') {
    const proposal = await getProposal(parts[2]);
    if (!proposal) {
      sendJson(response, 404, { error: `Unknown proposal "${parts[2]}".` });
      return;
    }

    sendJson(response, 200, proposal);
    return;
  }

  if (request.method === 'POST' && parts.length === 4 && parts[0] === 'v1' && parts[1] === 'proposals') {
    const proposal = await getProposal(parts[2]);
    if (!proposal) {
      sendJson(response, 404, { error: `Unknown proposal "${parts[2]}".` });
      return;
    }

    const action = parts[3];
    if (!['approve', 'reject', 'apply'].includes(action)) {
      sendJson(response, 404, { error: `Unsupported proposal action "${action}".` });
      return;
    }

    if (action === 'approve') {
      sendJson(response, 200, await updateProposal(parts[2], (current) => ({
        ...current,
        status: 'approved',
      })));
      return;
    }

    if (action === 'reject') {
      sendJson(response, 200, await updateProposal(parts[2], (current) => ({
        ...current,
        status: 'rejected',
      })));
      return;
    }

    const catalogRecord = await getCatalogProduct(proposal.tenantCode, proposal.sku);
    if (!catalogRecord) {
      sendJson(response, 404, { error: `No catalog product exists for SKU "${proposal.sku}".` });
      return;
    }

    const nextProduct = applyProposalToProduct(catalogRecord.product, proposal);
    await upsertCatalogProduct({
      tenantCode: proposal.tenantCode,
      sku: proposal.sku,
      marketplaceCode: proposal.marketplaceCode,
      product: nextProduct,
    });

    const updated = await updateProposal(parts[2], (current) => ({
      ...current,
      status: 'applied',
      appliedAt: new Date().toISOString(),
    }));

    if (proposal.marketplaceCode) {
      await createJob({
        type: 'amazon_validation_preview',
        tenantCode: proposal.tenantCode,
        marketplaceCode: proposal.marketplaceCode,
        payload: {
          sku: proposal.sku,
        },
        dedupeKey: `${proposal.tenantCode}:${proposal.marketplaceCode}:${proposal.sku}:amazon_validation_preview`,
      });
    }

    sendJson(response, 200, {
      proposal: updated,
      catalogProduct: await getCatalogProduct(proposal.tenantCode, proposal.sku),
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/v1/notifications') {
    sendJson(response, 200, {
      notifications: await listNotifications({
        tenantCode: url.searchParams.get('tenant') || undefined,
        marketplaceCode: url.searchParams.get('marketplace') || undefined,
      }),
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/v1/review/inbox') {
    const tenantCode = url.searchParams.get('tenant') || undefined;
    const marketplaceCode = url.searchParams.get('marketplace') || undefined;
    const sku = url.searchParams.get('sku') || undefined;
    const [alerts, proposals, failedJobs] = await Promise.all([
      listAlerts({
        tenantCode,
        marketplaceCode,
      }),
      listProposals({
        tenantCode,
        marketplaceCode,
        sku,
      }),
      listJobs({
        tenantCode,
        marketplaceCode,
        status: 'failed',
      }),
    ]);

    sendJson(response, 200, {
      alerts: alerts.filter((alert) => !['acknowledged', 'resolved'].includes(alert.status)),
      proposals: proposals.filter((proposal) => ['open', 'approved'].includes(proposal.status)),
      failedJobs,
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/v1/snapshots') {
    sendJson(response, 200, {
      snapshots: await listSnapshots({
        tenantCode: url.searchParams.get('tenant') || undefined,
        marketplaceCode: url.searchParams.get('marketplace') || undefined,
        type: url.searchParams.get('type') || undefined,
      }),
    });
    return;
  }

  if (request.method === 'GET' && parts.length === 5 && parts[0] === 'v1' && parts[1] === 'catalog' && parts[3] === 'products') {
    const catalogProduct = await getCatalogProduct(parts[2], parts[4]);
    if (!catalogProduct) {
      sendJson(response, 404, { error: `Unknown catalog product "${parts[4]}" for tenant "${parts[2]}".` });
      return;
    }

    sendJson(response, 200, catalogProduct);
    return;
  }

  if (request.method === 'POST'
    && parts.length === 6
    && parts[0] === 'v1'
    && parts[1] === 'tenants'
    && parts[3] === 'workflows') {
    const tenantCode = parts[2];
    const marketplaceCode = parts[4];
    const action = parts[5];
    const workflow = resolveWorkflow(tenantCode, marketplaceCode, response);
    if (!workflow) {
      return;
    }

    const payload = await readJsonBody(request);
    const evaluation = evaluateWorkflow(workflow.tenant, workflow.marketplace, payload);
    await persistCatalogProduct(tenantCode, marketplaceCode, payload);

    if (action === 'preview') {
      sendJson(response, 200, evaluation);
      return;
    }

    if (action === 'runs') {
      const run = await createRun({
        tenantCode,
        marketplaceCode,
        product: payload.product || {},
        trigger: {
          type: 'manual',
          requestedAt: new Date().toISOString(),
        },
        evaluation,
        payload,
      });

      sendJson(response, 202, run);
      return;
    }
  }

  if (request.method === 'POST' && url.pathname === '/v1/events/product-changed') {
    const payload = await readJsonBody(request);
    const tenantCode = payload.tenantCode || 'default';
    const tenant = findTenant(tenantCode);
    if (!tenant) {
      sendJson(response, 404, { error: `Unknown tenant "${tenantCode}".` });
      return;
    }

    const sku = requestBodySku(payload);
    const requestedMarketplaces = Array.isArray(payload.marketplaces) && payload.marketplaces.length > 0
      ? payload.marketplaces
      : listMarketplaces(tenantCode).map((marketplace) => marketplace.code);

    const queued = [];

    for (const marketplaceCode of requestedMarketplaces) {
      const marketplace = findMarketplace(tenantCode, marketplaceCode);
      if (!marketplace) {
        queued.push({
          marketplaceCode,
          error: `Unknown marketplace "${marketplaceCode}".`,
        });
        continue;
      }

      await persistCatalogProduct(tenantCode, marketplaceCode, payload);

      const evaluation = evaluateWorkflow(tenant, marketplace, payload);
      const run = await createRun({
        tenantCode,
        marketplaceCode,
        product: payload.product || {},
        trigger: {
          type: 'product.changed',
          requestedAt: new Date().toISOString(),
        },
        evaluation,
        payload,
      });

      if (marketplace.channel === 'amazon' && sku) {
        await createJob({
          type: 'amazon_validation_preview',
          tenantCode,
          marketplaceCode,
          payload: {
            sku,
          },
          dedupeKey: `${tenantCode}:${marketplaceCode}:${sku}:amazon_validation_preview`,
        });

        for (const source of ((getTenantAmazonConfig(tenantCode)?.brandSources || [])
          .filter((item) => (!item.marketplaceCode || item.marketplaceCode === marketplaceCode) && item.sku === sku))) {
          await createJob({
            type: 'brand_source_watch',
            tenantCode,
            marketplaceCode,
            payload: {
              sourceCode: source.code,
            },
            dedupeKey: `${tenantCode}:${source.code}:brand_source_watch`,
          });
        }

        await createJob({
          type: 'ai_proposal_generation',
          tenantCode,
          marketplaceCode,
          payload: {
            sku,
          },
          dedupeKey: `${tenantCode}:${marketplaceCode}:${sku}:ai_proposal_generation`,
        });
      }

      queued.push({
        marketplaceCode,
        runId: run.id,
        status: run.status,
      });
    }

    sendJson(response, 202, {
      tenantCode,
      queued,
    });
    return;
  }

  if (request.method === 'POST' && parts.length === 4 && parts[0] === 'v1' && parts[1] === 'tenants' && parts[3] === 'amazon') {
    const tenantCode = parts[2];
    if (!findTenant(tenantCode)) {
      sendJson(response, 404, { error: `Unknown tenant "${tenantCode}".` });
      return;
    }

    await queueJob(response, {
      type: 'amazon_notification_bootstrap',
      tenantCode,
      payload: {},
    });
    return;
  }

  if (request.method === 'GET' && parts.length === 4 && parts[0] === 'v1' && parts[1] === 'tenants' && parts[3] === 'admin-settings') {
    const tenantCode = parts[2];
    const settings = getTenantAdminSettings(tenantCode);
    if (!settings) {
      sendJson(response, 404, { error: `Unknown tenant "${tenantCode}".` });
      return;
    }

    sendJson(response, 200, settings);
    return;
  }

  if (request.method === 'PUT' && parts.length === 4 && parts[0] === 'v1' && parts[1] === 'tenants' && parts[3] === 'admin-settings') {
    const tenantCode = parts[2];
    const settings = updateTenantAdminSettings(tenantCode, await readJsonBody(request));
    if (!settings) {
      sendJson(response, 404, { error: `Unknown tenant "${tenantCode}".` });
      return;
    }

    sendJson(response, 200, settings);
    return;
  }

  if (request.method === 'GET' && parts.length === 4 && parts[0] === 'v1' && parts[1] === 'tenants' && parts[3] === 'onboarding') {
    const tenantCode = parts[2];
    if (!findTenant(tenantCode)) {
      sendJson(response, 404, { error: `Unknown tenant "${tenantCode}".` });
      return;
    }

    const state = await getState(onboardingStateKey(tenantCode));
    sendJson(response, 200, state?.value || defaultOnboardingState(tenantCode));
    return;
  }

  if (request.method === 'PUT' && parts.length === 4 && parts[0] === 'v1' && parts[1] === 'tenants' && parts[3] === 'onboarding') {
    const tenantCode = parts[2];
    if (!findTenant(tenantCode)) {
      sendJson(response, 404, { error: `Unknown tenant "${tenantCode}".` });
      return;
    }

    const payload = await readJsonBody(request);
    const current = (await getState(onboardingStateKey(tenantCode)))?.value || defaultOnboardingState(tenantCode);
    const next = {
      ...current,
      ...payload,
      tenantCode,
      completedSteps: Array.isArray(payload.completedSteps) ? [...new Set(payload.completedSteps.map((step) => String(step).trim()).filter(Boolean))] : current.completedSteps,
      updatedAt: new Date().toISOString(),
    };

    await setState(onboardingStateKey(tenantCode), next);
    sendJson(response, 200, next);
    return;
  }

  if (request.method === 'POST'
    && parts.length === 7
    && parts[0] === 'v1'
    && parts[1] === 'tenants'
    && parts[3] === 'marketplaces') {
    const tenantCode = parts[2];
    const marketplaceCode = parts[4];
    const action = parts[6];
    const marketplace = findMarketplace(tenantCode, marketplaceCode);
    if (!marketplace) {
      sendJson(response, 404, { error: `Unknown marketplace "${marketplaceCode}" for tenant "${tenantCode}".` });
      return;
    }

    const payload = await readJsonBody(request);
    const sku = requestBodySku(payload);
    if (payload.product) {
      await persistCatalogProduct(tenantCode, marketplaceCode, payload);
    }

    if (parts[5] === 'amazon') {
      if (action === 'schema-sync') {
        await queueJob(response, {
          type: 'amazon_schema_watch',
          tenantCode,
          marketplaceCode,
          payload: {},
        });
        return;
      }

      if (action === 'brand-watch') {
        await queueJob(response, {
          type: 'brand_source_watch',
          tenantCode,
          marketplaceCode,
          payload: {
            sourceCode: payload.sourceCode,
          },
        });
        return;
      }

      if (action === 'account-health') {
        await queueJob(response, {
          type: 'amazon_account_health_watch',
          tenantCode,
          marketplaceCode,
          payload: {},
        });
        return;
      }

      if (action === 'validate') {
        await queueJob(response, {
          type: 'amazon_validation_preview',
          tenantCode,
          marketplaceCode,
          payload: {
            sku,
            submissionMode: payload.submissionMode,
          },
        });
        return;
      }

      if (action === 'publish') {
        await queueJob(response, {
          type: 'amazon_publish_execution',
          tenantCode,
          marketplaceCode,
          payload: {
            sku,
            autoApprovedOnly: payload.autoApprovedOnly !== false,
            submissionMode: payload.submissionMode,
          },
        });
        return;
      }
    }
  }

  if (request.method === 'POST' && url.pathname === '/v1/amazon/notifications/ingest') {
    const payload = await readJsonBody(request);
    const tenantCode = payload.tenantCode || 'default';
    const marketplaceCode = payload.marketplaceCode || null;
    if (!findTenant(tenantCode)) {
      sendJson(response, 404, { error: `Unknown tenant "${tenantCode}".` });
      return;
    }

    await queueJob(response, {
      type: 'amazon_notification_event',
      tenantCode,
      marketplaceCode,
      payload,
    });
    return;
  }

  if (request.method === 'GET' && parts.length === 4 && parts[0] === 'v1' && parts[1] === 'tenants' && parts[3] === 'amazon-config') {
    const tenantCode = parts[2];
    const tenant = findTenant(tenantCode);
    if (!tenant || !tenant.amazon) {
      sendJson(response, 404, { error: `Unknown Amazon configuration for tenant "${tenantCode}".` });
      return;
    }

    const client = createAmazonClient(tenantCode, null);
    sendJson(response, 200, {
      tenantCode,
      live: client.isLive(),
      notifications: client.trackedNotificationTypes(),
      credentials: amazonCredentialStatus(tenant.amazon),
    });
    return;
  }

  if (request.method === 'GET' && parts.length === 4 && parts[0] === 'v1' && parts[1] === 'tenants' && parts[3] === 'listing-writer-config') {
    const tenantCode = parts[2];
    const tenant = findTenant(tenantCode);
    if (!tenant) {
      sendJson(response, 404, { error: `Unknown tenant "${tenantCode}".` });
      return;
    }

    const client = createListingWriterClient(tenantCode);
    sendJson(response, 200, {
      tenantCode,
      readiness: client.readiness(),
    });
    return;
  }

  notFound(response);
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    sendJson(response, 500, { error: error.message || 'Unexpected error.' });
  });
});

async function start() {
  await ensureSchema();
  server.listen(port, () => {
    console.log(`Marketplace orchestrator listening on ${port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
