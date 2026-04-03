const { listTenants } = require('./config-loader');
const { createJob, findOpenJobByDedupeKey, getState, nowIso, setState } = require('./store');

function minutesToMs(minutes, fallbackMinutes) {
  return Math.max(1, Number(minutes || fallbackMinutes || 0)) * 60 * 1000;
}

async function lastScheduledAt(key) {
  return (await getState(`scheduler:${key}`))?.value?.scheduledAt || null;
}

async function rememberSchedule(key, timestamp) {
  return setState(`scheduler:${key}`, { scheduledAt: timestamp });
}

async function shouldSchedule(key, intervalMs) {
  const lastScheduled = await lastScheduledAt(key);
  if (!lastScheduled) {
    return true;
  }

  return Date.now() - Date.parse(lastScheduled) >= intervalMs;
}

async function queueRecurringJob({ type, tenantCode, marketplaceCode, payload, intervalMs, dedupeKey }) {
  if (!(await shouldSchedule(dedupeKey, intervalMs))) {
    return null;
  }

  if (await findOpenJobByDedupeKey(dedupeKey)) {
    return null;
  }

  const job = await createJob({
    type,
    tenantCode,
    marketplaceCode,
    payload,
    dedupeKey,
    scheduledFor: nowIso(),
  });

  await rememberSchedule(dedupeKey, job.createdAt);

  return job;
}

async function scheduleAmazonMaintenance() {
  const created = [];

  for (const tenant of listTenants()) {
    if (!tenant.amazon || tenant.amazon.enabled === false) {
      continue;
    }

    const watchers = tenant.amazon.watchers || {};
    const tenantCode = tenant.code;

    created.push(await queueRecurringJob({
      type: 'amazon_notification_bootstrap',
      tenantCode,
      intervalMs: minutesToMs(watchers.notificationBootstrapIntervalMinutes, 1440),
      dedupeKey: `${tenantCode}:amazon_notification_bootstrap`,
      payload: {},
    }));

    for (const marketplace of (tenant.marketplaces || []).filter((item) => item.channel === 'amazon')) {
      created.push(await queueRecurringJob({
        type: 'amazon_schema_watch',
        tenantCode,
        marketplaceCode: marketplace.code,
        intervalMs: minutesToMs(watchers.schemaIntervalMinutes, 720),
        dedupeKey: `${tenantCode}:${marketplace.code}:amazon_schema_watch`,
        payload: {},
      }));

      created.push(await queueRecurringJob({
        type: 'amazon_listing_health_watch',
        tenantCode,
        marketplaceCode: marketplace.code,
        intervalMs: minutesToMs(watchers.listingHealthIntervalMinutes, 15),
        dedupeKey: `${tenantCode}:${marketplace.code}:amazon_listing_health_watch`,
        payload: {},
      }));
    }

    created.push(await queueRecurringJob({
      type: 'amazon_account_health_watch',
      tenantCode,
      intervalMs: minutesToMs(watchers.accountHealthIntervalMinutes, 60),
      dedupeKey: `${tenantCode}:amazon_account_health_watch`,
      payload: {},
    }));

    for (const source of (tenant.amazon.brandSources || [])) {
      created.push(await queueRecurringJob({
        type: 'brand_source_watch',
        tenantCode,
        marketplaceCode: source.marketplaceCode || null,
        intervalMs: minutesToMs(source.intervalMinutes, watchers.brandSourceIntervalMinutes || 360),
        dedupeKey: `${tenantCode}:${source.code}:brand_source_watch`,
        payload: { sourceCode: source.code },
      }));
    }
  }

  return created.filter(Boolean);
}

module.exports = {
  scheduleAmazonMaintenance,
};
