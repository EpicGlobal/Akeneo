require('./lib/bootstrap-env');

const http = require('http');

const { createAmazonClient } = require('./lib/amazon-client');
const { amazonCredentialStatus, findMarketplace, findTenant, getTenantAmazonConfig, listMarketplaces, listTenants } = require('./lib/config-loader');
const { createListingWriterClient } = require('./lib/epic-ai-client');
const { evaluateWorkflow } = require('./lib/engine');
const { notFound, readJsonBody, sendJson } = require('./lib/http');
const {
  createJob,
  createRun,
  ensureSchema,
  getCatalogProduct,
  getJob,
  getRun,
  listAlerts,
  listJobs,
  listNotifications,
  listProposals,
  listRuns,
  listSnapshots,
  upsertCatalogProduct,
} = require('./lib/store');

const port = Number(process.env.MARKETPLACE_ORCHESTRATOR_PORT || 8090);

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

  if (request.method === 'GET' && url.pathname === '/v1/tenants') {
    sendJson(response, 200, {
      tenants: listTenants().map(tenantSummary),
    });
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

  if (request.method === 'GET' && url.pathname === '/v1/notifications') {
    sendJson(response, 200, {
      notifications: await listNotifications({
        tenantCode: url.searchParams.get('tenant') || undefined,
        marketplaceCode: url.searchParams.get('marketplace') || undefined,
      }),
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
