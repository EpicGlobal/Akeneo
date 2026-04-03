const { createAmazonClient } = require('./amazon-client');
const { dispatchAlert } = require('./alerting');
const { snapshotBrandSource } = require('./brand-source');
const { findMarketplace, findTenant, getTenantAmazonConfig } = require('./config-loader');
const { createListingWriterClient } = require('./epic-ai-client');
const { applyAutoApprovedChanges, compareBrandEvidence, compareGeneratedDraft } = require('./proposal-engine');
const {
  createAlert,
  createJob,
  createProposal,
  getCatalogProduct,
  getJob,
  getSnapshot,
  listCatalogProducts,
  listProposals,
  nowIso,
  recordNotification,
  saveSnapshot,
  updateJob,
  updateProposal,
  upsertCatalogProduct,
} = require('./store');
const { sha256 } = require('./util');

function notificationType(event) {
  return event.notificationType || event.NotificationType || event.type || null;
}

async function createAndDispatchAlert({ tenantCode, marketplaceCode, severity, title, message, source, payload }) {
  const alert = await createAlert({
    tenantCode,
    marketplaceCode,
    severity,
    title,
    message,
    source,
    payload,
  });

  const tenantConfig = findTenant(tenantCode);
  if (tenantConfig) {
    const amazonClient = tenantConfig.amazon ? createAmazonClient(tenantCode, marketplaceCode) : null;
    await dispatchAlert(alert, { tenantConfig, amazonClient });
  }

  return alert;
}

function inferSku(payload) {
  return payload?.sku
    || payload?.product?.identifier
    || payload?.sellerSku
    || payload?.listing?.sku
    || null;
}

function resolveMarketplaceCode(job, catalogRecord) {
  return job.marketplaceCode
    || catalogRecord?.marketplaceCode
    || (catalogRecord?.marketplaceCodes || [])[0]
    || null;
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

function currentDraftFromProduct(product = {}) {
  const attributes = product.attributes || {};

  return {
    title: attributes.marketplace_title || attributes.name || '',
    description: attributes.description || '',
    bullets: [1, 2, 3, 4, 5]
      .map((index) => attributes[`bullet_${index}`] || '')
      .filter(Boolean),
  };
}

function dedupeProposals(proposals) {
  const seen = new Set();

  return proposals.filter((proposal) => {
    const key = [
      proposal.marketplaceCode || '',
      proposal.sku || '',
      proposal.field || '',
      proposal.proposedValue || '',
    ].join('::');

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

async function processNotificationBootstrap(job) {
  const client = createAmazonClient(job.tenantCode, job.marketplaceCode || null);
  const result = await client.bootstrapNotifications();

  await saveSnapshot({
    type: 'amazon_notifications',
    tenantCode: job.tenantCode,
    marketplaceCode: job.marketplaceCode || null,
    key: 'subscriptions',
    payload: result,
    hash: sha256(JSON.stringify(result)),
    source: 'amazon_notification_bootstrap',
  });

  return result;
}

async function processSchemaWatch(job) {
  const marketplace = findMarketplace(job.tenantCode, job.marketplaceCode);
  if (!marketplace || marketplace.channel !== 'amazon') {
    return {
      skipped: true,
      reason: 'Marketplace is not configured for Amazon schema sync.',
    };
  }

  const client = createAmazonClient(job.tenantCode, marketplace.code);
  const productType = marketplace.amazon?.productType || 'PRODUCT';
  const schema = await client.syncProductType(productType, marketplace);
  const hash = sha256(JSON.stringify(schema));
  const existing = await getSnapshot('amazon_schema', job.tenantCode, `${marketplace.code}:${productType}`);
  const changed = !existing || existing.hash !== hash;

  await saveSnapshot({
    type: 'amazon_schema',
    tenantCode: job.tenantCode,
    marketplaceCode: marketplace.code,
    key: `${marketplace.code}:${productType}`,
    payload: schema,
    hash,
    source: 'amazon_schema_watch',
  });

  if (changed && existing) {
    await createAndDispatchAlert({
      tenantCode: job.tenantCode,
      marketplaceCode: marketplace.code,
      severity: 'warning',
      title: `Amazon schema changed for ${marketplace.label}`,
      message: `Amazon Product Type Definition changed for product type ${productType}. Review affected listings before the next publish.`,
      source: 'amazon_schema_watch',
      payload: {
        previousHash: existing.hash,
        currentHash: hash,
        productType,
      },
    });
  }

  return {
    productType,
    changed,
    schemaVersion: schema?.productTypeVersion?.version || null,
  };
}

async function processBrandSourceWatch(job) {
  const tenant = findTenant(job.tenantCode);
  const source = (tenant?.amazon?.brandSources || []).find((item) => item.code === job.payload.sourceCode);
  if (!source) {
    return {
      skipped: true,
      reason: `Unknown brand source "${job.payload.sourceCode}".`,
    };
  }

  const { snapshot, hash } = await snapshotBrandSource(source);
  const existing = await getSnapshot('brand_source', job.tenantCode, source.code);
  const changed = !existing || existing.hash !== hash;

  await saveSnapshot({
    type: 'brand_source',
    tenantCode: job.tenantCode,
    marketplaceCode: source.marketplaceCode || null,
    key: source.code,
    payload: snapshot,
    hash,
    source: 'brand_source_watch',
  });

  if (!changed) {
    return {
      sourceCode: source.code,
      changed: false,
    };
  }

  if (source.sku) {
    await createJob({
      type: 'ai_proposal_generation',
      tenantCode: job.tenantCode,
      marketplaceCode: source.marketplaceCode || null,
      payload: {
        sku: source.sku,
        sourceCode: source.code,
      },
      dedupeKey: `${job.tenantCode}:${source.marketplaceCode || 'global'}:${source.sku}:ai_proposal_generation`,
    });
  }

  return {
    sourceCode: source.code,
    changed: true,
  };
}

async function processListingHealthWatch(job) {
  const marketplace = findMarketplace(job.tenantCode, job.marketplaceCode);
  if (!marketplace || marketplace.channel !== 'amazon') {
    return {
      skipped: true,
      reason: 'Marketplace is not configured for Amazon health monitoring.',
    };
  }

  const client = createAmazonClient(job.tenantCode, marketplace.code);
  const products = (await listCatalogProducts(job.tenantCode))
    .filter((record) => !job.payload.sku || record.sku === job.payload.sku);

  const results = [];

  for (const record of products) {
    const status = await client.getListingStatus({ marketplace, sku: record.sku });
    await saveSnapshot({
      type: 'amazon_listing_status',
      tenantCode: job.tenantCode,
      marketplaceCode: marketplace.code,
      key: `${marketplace.code}:${record.sku}`,
      payload: status,
      hash: sha256(JSON.stringify(status)),
      source: 'amazon_listing_health_watch',
    });

    const issues = summarizeListingIssues(status);
    const healthy = listingIsHealthy(status) && issues.length === 0;
    if (!healthy) {
      await createAndDispatchAlert({
        tenantCode: job.tenantCode,
        marketplaceCode: marketplace.code,
        severity: 'critical',
        title: `Amazon listing issue for ${record.sku}`,
        message: `Listing ${record.sku} is not fully healthy on ${marketplace.label}. Review listing issues and buyability/discoverability status.`,
        source: 'amazon_listing_health_watch',
        payload: status,
      });

      await createJob({
        type: 'ai_proposal_generation',
        tenantCode: job.tenantCode,
        marketplaceCode: marketplace.code,
        payload: {
          sku: record.sku,
          sourceCode: null,
        },
        dedupeKey: `${job.tenantCode}:${marketplace.code}:${record.sku}:ai_proposal_generation`,
      });
    }

    results.push({
      sku: record.sku,
      healthy,
      issues: issues.length,
    });
  }

  return {
    checked: results.length,
    listings: results,
  };
}

async function processAccountHealthWatch(job) {
  const amazon = getTenantAmazonConfig(job.tenantCode);
  if (!amazon) {
    return {
      skipped: true,
      reason: 'Tenant has no Amazon configuration.',
    };
  }

  const client = createAmazonClient(job.tenantCode, null);
  const report = await client.requestSellerPerformanceReport();
  const reportDetails = await client.getSellerPerformanceReport(report.reportId);
  const marketplaces = await client.getMarketplaceParticipations();

  const result = {
    report,
    reportDetails,
    marketplaces,
  };

  await saveSnapshot({
    type: 'amazon_account_health',
    tenantCode: job.tenantCode,
    marketplaceCode: null,
    key: 'account-health',
    payload: result,
    hash: sha256(JSON.stringify(result)),
    source: 'amazon_account_health_watch',
  });

  const suspendedListings = (marketplaces?.payload || [])
    .filter((entry) => entry?.participation?.hasSuspendedListings);

  if (suspendedListings.length > 0) {
    await createAndDispatchAlert({
      tenantCode: job.tenantCode,
      marketplaceCode: null,
      severity: 'critical',
      title: 'Amazon marketplace participation issue detected',
      message: 'Amazon reported suspended listings or marketplace participation problems.',
      source: 'amazon_account_health_watch',
      payload: result,
    });
  }

  return {
    reportId: report.reportId,
    suspendedMarketplaces: suspendedListings.length,
  };
}

async function processAiProposalGeneration(job) {
  const sku = inferSku(job.payload);
  if (!sku) {
    return {
      skipped: true,
      reason: 'AI proposal generation requires a SKU.',
    };
  }

  const catalogRecord = await getCatalogProduct(job.tenantCode, sku);
  if (!catalogRecord) {
    return {
      skipped: true,
      reason: `No catalog product exists for SKU ${sku}.`,
    };
  }

  const marketplaceCode = resolveMarketplaceCode(job, catalogRecord);
  if (!marketplaceCode) {
    return {
      skipped: true,
      reason: `No marketplace context exists for SKU ${sku}.`,
    };
  }

  const listingSnapshot = await getSnapshot('amazon_listing_status', job.tenantCode, `${marketplaceCode}:${sku}`);
  const tenant = findTenant(job.tenantCode);
  const sourceCodes = job.payload.sourceCode
    ? [job.payload.sourceCode]
    : (tenant?.amazon?.brandSources || [])
      .filter((source) => source.sku === sku && (!source.marketplaceCode || source.marketplaceCode === marketplaceCode))
      .map((source) => source.code);

  const brandSnapshots = (await Promise.all(
    sourceCodes.map((sourceCode) => getSnapshot('brand_source', job.tenantCode, sourceCode))
  )).filter(Boolean);

  const listingIssues = summarizeListingIssues(listingSnapshot?.payload || {});
  const proposals = brandSnapshots.flatMap((brandSnapshot) => compareBrandEvidence({
    tenantCode: job.tenantCode,
    marketplaceCode,
    sku,
    product: catalogRecord.product,
    brandEvidence: brandSnapshot?.payload || {},
    issues: listingIssues,
  }));

  const listingWriterClient = createListingWriterClient(job.tenantCode);
  let listingWriterDraft = null;

  if (listingWriterClient.enabled()) {
    try {
      const generated = await listingWriterClient.generateListingDraft({
        marketplaceCode,
        sku,
        product: catalogRecord.product,
        brandEvidence: brandSnapshots.map((snapshot) => snapshot.payload || {}),
        amazonIssues: listingIssues,
        existingDraft: currentDraftFromProduct(catalogRecord.product),
      });

      if (generated?.listing) {
        listingWriterDraft = generated;

        await saveSnapshot({
          type: 'epic_ai_listing_draft',
          tenantCode: job.tenantCode,
          marketplaceCode,
          key: `${marketplaceCode}:${sku}`,
          payload: generated,
          hash: sha256(JSON.stringify(generated)),
          source: 'ai_proposal_generation',
        });

        proposals.push(...compareGeneratedDraft({
          tenantCode: job.tenantCode,
          marketplaceCode,
          sku,
          product: catalogRecord.product,
          draft: generated.listing,
          reasonPrefix: 'Epic AI Listing Writer generated updated marketplace copy from approved product facts and current marketplace signals.',
          evidence: [
            'Epic AI Listing Writer',
            ...(generated.providerIds || []),
            ...sourceCodes,
          ],
        }));
      }
    } catch (error) {
      await createAndDispatchAlert({
        tenantCode: job.tenantCode,
        marketplaceCode,
        severity: 'warning',
        title: `Epic AI listing writer failed for ${sku}`,
        message: `The Epic AI listing writer could not generate a draft for ${sku}. Falling back to deterministic proposal generation.`,
        source: 'ai_proposal_generation',
        payload: {
          sku,
          marketplaceCode,
          error: error.message,
        },
      });
    }
  }

  const created = [];
  for (const proposal of dedupeProposals(proposals)) {
    created.push(await createProposal(proposal));
  }

  if (created.some((proposal) => proposal.autoApplyEligible)) {
    await createJob({
      type: 'amazon_publish_execution',
      tenantCode: job.tenantCode,
      marketplaceCode,
      payload: {
        sku,
        autoApprovedOnly: true,
      },
      dedupeKey: `${job.tenantCode}:${marketplaceCode}:${sku}:amazon_publish_execution`,
    });
  }

  return {
    sku,
    created: created.length,
    sourceCount: sourceCodes.length,
    listingWriterUsed: Boolean(listingWriterDraft),
  };
}

async function processValidationPreview(job) {
  const marketplaceCode = job.marketplaceCode;
  const marketplace = findMarketplace(job.tenantCode, marketplaceCode);
  if (!marketplace) {
    return {
      skipped: true,
      reason: `Unknown marketplace "${job.marketplaceCode}".`,
    };
  }

  const client = createAmazonClient(job.tenantCode, marketplace.code);
  const sku = inferSku(job.payload);
  const catalogRecord = await getCatalogProduct(job.tenantCode, sku);
  if (!catalogRecord) {
    return {
      skipped: true,
      reason: `No catalog product exists for SKU ${sku}.`,
    };
  }

  const validation = await client.validateListing({
    marketplace,
    product: catalogRecord.product,
    sku,
    submissionMode: job.payload.submissionMode,
  });

  await saveSnapshot({
    type: 'amazon_validation_preview',
    tenantCode: job.tenantCode,
    marketplaceCode: marketplace.code,
    key: `${marketplace.code}:${sku}`,
    payload: validation,
    hash: sha256(JSON.stringify(validation)),
    source: 'amazon_validation_preview',
  });

  return validation;
}

async function processPublishExecution(job) {
  const marketplaceCode = job.marketplaceCode;
  const marketplace = findMarketplace(job.tenantCode, marketplaceCode);
  if (!marketplace) {
    return {
      skipped: true,
      reason: `Unknown marketplace "${job.marketplaceCode}".`,
    };
  }

  const client = createAmazonClient(job.tenantCode, marketplace.code);
  const sku = inferSku(job.payload);
  const catalogRecord = await getCatalogProduct(job.tenantCode, sku);
  if (!catalogRecord) {
    return {
      skipped: true,
      reason: `No catalog product exists for SKU ${sku}.`,
    };
  }

  const openProposals = await listProposals({
    tenantCode: job.tenantCode,
    marketplaceCode: marketplace.code,
    sku,
    status: 'open',
  });

  const autoApproved = job.payload.autoApprovedOnly
    ? openProposals.filter((proposal) => proposal.autoApplyEligible)
    : openProposals;
  const manualReviewRequired = openProposals.filter((proposal) => !proposal.autoApplyEligible);

  if (manualReviewRequired.length > 0 && job.payload.autoApprovedOnly) {
    await createAndDispatchAlert({
      tenantCode: job.tenantCode,
      marketplaceCode: marketplace.code,
      severity: 'warning',
      title: `Manual review required for ${sku}`,
      message: `Some Amazon listing proposals for ${sku} require human approval and were not auto-applied.`,
      source: 'amazon_publish_execution',
      payload: {
        manualReviewCount: manualReviewRequired.length,
      },
    });
  }

  const updatedProduct = applyAutoApprovedChanges(catalogRecord.product, autoApproved);
  await upsertCatalogProduct({
    tenantCode: job.tenantCode,
    sku,
    marketplaceCode: marketplace.code,
    product: updatedProduct,
  });

  for (const proposal of autoApproved) {
    await updateProposal(proposal.id, (current) => ({
      ...current,
      status: 'applied',
      appliedAt: nowIso(),
    }));
  }

  const validation = await client.validateListing({
    marketplace,
    product: updatedProduct,
    sku,
    submissionMode: job.payload.submissionMode,
  });

  await saveSnapshot({
    type: 'amazon_validation_preview',
    tenantCode: job.tenantCode,
    marketplaceCode: marketplace.code,
    key: `${marketplace.code}:${sku}`,
    payload: validation,
    hash: sha256(JSON.stringify(validation)),
    source: 'amazon_publish_execution',
  });

  if ((validation.issues || []).length > 0) {
    await createAndDispatchAlert({
      tenantCode: job.tenantCode,
      marketplaceCode: marketplace.code,
      severity: 'error',
      title: `Amazon validation failed for ${sku}`,
      message: `Validation preview returned Amazon issues for ${sku}; publish was not attempted.`,
      source: 'amazon_publish_execution',
      payload: validation,
    });

    return {
      sku,
      validation,
      published: false,
    };
  }

  const submission = await client.submitListing({
    marketplace,
    product: updatedProduct,
    sku,
    submissionMode: job.payload.submissionMode || marketplace.amazon?.submissionMode,
  });

  await saveSnapshot({
    type: 'amazon_submission',
    tenantCode: job.tenantCode,
    marketplaceCode: marketplace.code,
    key: `${marketplace.code}:${sku}`,
    payload: submission,
    hash: sha256(JSON.stringify(submission)),
    source: 'amazon_publish_execution',
  });

  return {
    sku,
    validation,
    submission,
    published: true,
  };
}

async function processNotificationEvent(job) {
  const payload = job.payload || {};
  const type = notificationType(payload);
  const marketplaceCode = job.marketplaceCode || payload.marketplaceCode || null;
  const sku = inferSku(payload);

  const record = await recordNotification({
    tenantCode: job.tenantCode,
    marketplaceCode,
    notificationType: type,
    payload,
    source: 'amazon_notification_event',
  });

  if (['LISTINGS_ITEM_STATUS_CHANGE', 'LISTINGS_ITEM_ISSUES_CHANGE'].includes(type)) {
    await createAndDispatchAlert({
      tenantCode: job.tenantCode,
      marketplaceCode,
      severity: 'critical',
      title: `Amazon ${type} for ${sku || 'unknown SKU'}`,
      message: `Amazon emitted ${type} for ${sku || 'an unknown SKU'}. A listing health scan has been queued.`,
      source: 'amazon_notification_event',
      payload,
    });

    await createJob({
      type: 'amazon_listing_health_watch',
      tenantCode: job.tenantCode,
      marketplaceCode,
      payload: {
        sku,
      },
      dedupeKey: `${job.tenantCode}:${marketplaceCode}:${sku}:amazon_listing_health_watch`,
    });
  }

  if (['ITEM_PRODUCT_TYPE_CHANGE', 'PRODUCT_TYPE_DEFINITIONS_CHANGE'].includes(type)) {
    await createAndDispatchAlert({
      tenantCode: job.tenantCode,
      marketplaceCode,
      severity: 'warning',
      title: `Amazon ${type} detected`,
      message: `Amazon emitted ${type}. A schema refresh has been queued for ${marketplaceCode || 'the affected marketplace'}.`,
      source: 'amazon_notification_event',
      payload,
    });

    await createJob({
      type: 'amazon_schema_watch',
      tenantCode: job.tenantCode,
      marketplaceCode,
      payload: {},
      dedupeKey: `${job.tenantCode}:${marketplaceCode}:amazon_schema_watch`,
    });
  }

  if ('ACCOUNT_STATUS_CHANGED' === type) {
    await createAndDispatchAlert({
      tenantCode: job.tenantCode,
      marketplaceCode: null,
      severity: 'critical',
      title: 'Amazon account status changed',
      message: 'Amazon emitted ACCOUNT_STATUS_CHANGED. An account health scan has been queued.',
      source: 'amazon_notification_event',
      payload,
    });

    await createJob({
      type: 'amazon_account_health_watch',
      tenantCode: job.tenantCode,
      marketplaceCode: null,
      payload: {},
      dedupeKey: `${job.tenantCode}:amazon_account_health_watch`,
    });
  }

  return {
    notificationId: record.id,
    notificationType: type,
  };
}

async function processJob(job) {
  switch (job.type) {
    case 'amazon_notification_bootstrap':
      return processNotificationBootstrap(job);
    case 'amazon_schema_watch':
      return processSchemaWatch(job);
    case 'brand_source_watch':
      return processBrandSourceWatch(job);
    case 'amazon_listing_health_watch':
      return processListingHealthWatch(job);
    case 'amazon_account_health_watch':
      return processAccountHealthWatch(job);
    case 'ai_proposal_generation':
      return processAiProposalGeneration(job);
    case 'amazon_validation_preview':
      return processValidationPreview(job);
    case 'amazon_publish_execution':
      return processPublishExecution(job);
    case 'amazon_notification_event':
      return processNotificationEvent(job);
    default:
      return {
        skipped: true,
        reason: `Unknown job type "${job.type}".`,
      };
  }
}

async function runQueuedJob(job) {
  let current = await getJob(job.id);
  if (current && current.status !== 'processing') {
    await updateJob(job.id, (row) => ({
      ...row,
      status: 'processing',
      attempts: Number(row.attempts || 0) + 1,
      startedAt: nowIso(),
      error: null,
    }));
    current = await getJob(job.id);
  }

  const targetJob = current || job;

  try {
    const result = await processJob(targetJob);
    await updateJob(job.id, (row) => ({
      ...row,
      status: result?.skipped ? 'skipped' : 'completed',
      completedAt: nowIso(),
      result,
    }));

    return result;
  } catch (error) {
    await updateJob(job.id, (row) => ({
      ...row,
      status: 'failed',
      completedAt: nowIso(),
      error: error.message,
      result: null,
    }));

    throw error;
  }
}

module.exports = {
  runQueuedJob,
};
