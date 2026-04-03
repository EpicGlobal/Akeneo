const crypto = require('crypto');

const { ensureSchema, query, tableName, transaction } = require('./db');

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function toSqlJson(value) {
  if (undefined === value || null === value) {
    return null;
  }

  return JSON.stringify(value);
}

function fromSqlJson(value, fallback = null) {
  if (undefined === value || null === value || '' === value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function buildWhere(filters = {}, mapping = {}) {
  const clauses = [];
  const params = [];

  Object.entries(filters).forEach(([key, value]) => {
    if (undefined === value || null === value || '' === value) {
      return;
    }

    const column = mapping[key];
    if (!column) {
      return;
    }

    if (Array.isArray(value)) {
      if (0 === value.length) {
        return;
      }

      clauses.push(`${column} IN (${value.map(() => '?').join(', ')})`);
      params.push(...value);
      return;
    }

    clauses.push(`${column} = ?`);
    params.push(value);
  });

  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function catalogId(tenantCode, sku) {
  return `${String(tenantCode || '').trim()}::${String(sku || '').trim()}`;
}

function snapshotId(type, tenantCode, key) {
  return `${String(type || '').trim()}::${String(tenantCode || 'global').trim()}::${String(key || '').trim()}`;
}

function mapRunRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    tenantCode: row.tenant_code,
    marketplaceCode: row.marketplace_code,
    status: row.status,
    trigger: fromSqlJson(row.trigger_json, { type: 'manual' }),
    product: fromSqlJson(row.product_json, {}),
    payload: fromSqlJson(row.payload_json, null),
    evaluation: fromSqlJson(row.evaluation_json, null),
    listingPayload: fromSqlJson(row.listing_payload_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapJobRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    type: row.type,
    tenantCode: row.tenant_code,
    marketplaceCode: row.marketplace_code,
    status: row.status,
    payload: fromSqlJson(row.payload_json, {}),
    dedupeKey: row.dedupe_key,
    attempts: Number(row.attempts || 0),
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    error: row.error_text,
    result: fromSqlJson(row.result_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAlertRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    tenantCode: row.tenant_code,
    marketplaceCode: row.marketplace_code,
    severity: row.severity,
    status: row.status,
    title: row.title,
    message: row.message,
    source: row.source,
    payload: fromSqlJson(row.payload_json, null),
    channels: fromSqlJson(row.channels_json, []),
    dispatchedAt: row.dispatched_at,
    acknowledgedAt: row.acknowledged_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProposalRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    tenantCode: row.tenant_code,
    marketplaceCode: row.marketplace_code,
    sku: row.sku,
    field: row.field_name,
    currentValue: row.current_value,
    proposedValue: row.proposed_value,
    risk: row.risk,
    reason: row.reason,
    evidence: fromSqlJson(row.evidence_json, []),
    autoApplyEligible: Boolean(row.auto_apply_eligible),
    status: row.status,
    payload: fromSqlJson(row.payload_json, null),
    appliedAt: row.applied_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapStateRow(row) {
  if (!row) {
    return null;
  }

  return {
    key: row.state_key,
    value: fromSqlJson(row.value_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSnapshotRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    type: row.type,
    tenantCode: row.tenant_code,
    marketplaceCode: row.marketplace_code,
    key: row.snapshot_key,
    payload: fromSqlJson(row.payload_json, null),
    hash: row.hash,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapNotificationRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    tenantCode: row.tenant_code,
    marketplaceCode: row.marketplace_code,
    notificationType: row.notification_type,
    payload: fromSqlJson(row.payload_json, null),
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCatalogRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    tenantCode: row.tenant_code,
    sku: row.sku,
    marketplaceCode: row.marketplace_code,
    marketplaceCodes: fromSqlJson(row.marketplace_codes_json, []),
    product: fromSqlJson(row.product_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMailRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    tenantCode: row.tenant_code,
    subject: row.subject,
    to: fromSqlJson(row.recipients_json, []),
    body: row.body,
    payload: fromSqlJson(row.payload_json, null),
    status: row.status,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createRun({ tenantCode, marketplaceCode, product, trigger, evaluation, payload }) {
  await ensureSchema();
  const record = {
    id: createId('run'),
    tenantCode: tenantCode || null,
    marketplaceCode: marketplaceCode || null,
    status: 'queued',
    trigger: trigger || { type: 'manual' },
    product: product || {},
    payload: payload || null,
    evaluation: evaluation || null,
    listingPayload: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  await query(
    `INSERT INTO ${tableName('runs')} (
      id, tenant_code, marketplace_code, status, trigger_json, product_json, payload_json, evaluation_json, listing_payload_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.tenantCode,
      record.marketplaceCode,
      record.status,
      toSqlJson(record.trigger),
      toSqlJson(record.product),
      toSqlJson(record.payload),
      toSqlJson(record.evaluation),
      toSqlJson(record.listingPayload),
      record.createdAt,
      record.updatedAt,
    ]
  );

  return record;
}

async function listRuns(filters = {}) {
  await ensureSchema();
  const where = buildWhere(filters, {
    tenantCode: 'tenant_code',
    marketplaceCode: 'marketplace_code',
    status: 'status',
  });
  const [rows] = await query(
    `SELECT * FROM ${tableName('runs')} ${where.sql} ORDER BY created_at DESC`,
    where.params
  );
  return rows.map(mapRunRow);
}

async function getRun(runId) {
  await ensureSchema();
  const [rows] = await query(`SELECT * FROM ${tableName('runs')} WHERE id = ? LIMIT 1`, [runId]);
  return mapRunRow(rows[0]);
}

async function updateRun(runId, updater) {
  const current = await getRun(runId);
  if (!current) {
    return null;
  }

  const next = updater({ ...current });
  next.id = runId;
  next.createdAt = current.createdAt;
  next.updatedAt = nowIso();

  await query(
    `UPDATE ${tableName('runs')}
      SET tenant_code = ?, marketplace_code = ?, status = ?, trigger_json = ?, product_json = ?, payload_json = ?, evaluation_json = ?, listing_payload_json = ?, updated_at = ?
      WHERE id = ?`,
    [
      next.tenantCode || null,
      next.marketplaceCode || null,
      next.status,
      toSqlJson(next.trigger),
      toSqlJson(next.product),
      toSqlJson(next.payload),
      toSqlJson(next.evaluation),
      toSqlJson(next.listingPayload),
      next.updatedAt,
      runId,
    ]
  );

  return next;
}

async function findOpenJobByDedupeKey(dedupeKey) {
  if (!dedupeKey) {
    return null;
  }

  await ensureSchema();
  const [rows] = await query(
    `SELECT * FROM ${tableName('jobs')}
      WHERE dedupe_key = ? AND status IN ('queued', 'processing')
      ORDER BY created_at DESC
      LIMIT 1`,
    [dedupeKey]
  );

  return mapJobRow(rows[0]);
}

async function createJob({ type, tenantCode, marketplaceCode, payload, scheduledFor, dedupeKey }) {
  await ensureSchema();

  if (dedupeKey) {
    const existing = await findOpenJobByDedupeKey(dedupeKey);
    if (existing) {
      return existing;
    }
  }

  const record = {
    id: createId('job'),
    type,
    tenantCode: tenantCode || null,
    marketplaceCode: marketplaceCode || null,
    status: 'queued',
    payload: payload || {},
    dedupeKey: dedupeKey || null,
    attempts: 0,
    scheduledFor: scheduledFor || nowIso(),
    startedAt: null,
    completedAt: null,
    error: null,
    result: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  await query(
    `INSERT INTO ${tableName('jobs')} (
      id, type, tenant_code, marketplace_code, status, payload_json, dedupe_key, attempts, scheduled_for, started_at, completed_at, error_text, result_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.type,
      record.tenantCode,
      record.marketplaceCode,
      record.status,
      toSqlJson(record.payload),
      record.dedupeKey,
      record.attempts,
      record.scheduledFor,
      record.startedAt,
      record.completedAt,
      record.error,
      toSqlJson(record.result),
      record.createdAt,
      record.updatedAt,
    ]
  );

  return record;
}

async function listJobs(filters = {}) {
  await ensureSchema();
  const where = buildWhere(filters, {
    tenantCode: 'tenant_code',
    marketplaceCode: 'marketplace_code',
    status: 'status',
    type: 'type',
  });
  const [rows] = await query(
    `SELECT * FROM ${tableName('jobs')} ${where.sql} ORDER BY scheduled_for ASC, created_at DESC`,
    where.params
  );
  return rows.map(mapJobRow);
}

async function claimQueuedJobs(limit = 10) {
  const batchSize = Math.max(1, Number(limit || 1) || 1);
  const claimedAt = nowIso();

  return transaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT * FROM ${tableName('jobs')}
        WHERE status = 'queued' AND scheduled_for <= ?
        ORDER BY scheduled_for ASC, created_at ASC
        LIMIT ?
        FOR UPDATE SKIP LOCKED`,
      [claimedAt, batchSize]
    );

    if (0 === rows.length) {
      return [];
    }

    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(', ');

    await connection.query(
      `UPDATE ${tableName('jobs')}
        SET status = 'processing', attempts = attempts + 1, started_at = ?, error_text = NULL, updated_at = ?
        WHERE id IN (${placeholders})`,
      [claimedAt, claimedAt, ...ids]
    );

    const [claimedRows] = await connection.query(
      `SELECT * FROM ${tableName('jobs')} WHERE id IN (${placeholders})`,
      ids
    );

    const byId = new Map(claimedRows.map((row) => [row.id, mapJobRow(row)]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  });
}

async function getJob(jobId) {
  await ensureSchema();
  const [rows] = await query(`SELECT * FROM ${tableName('jobs')} WHERE id = ? LIMIT 1`, [jobId]);
  return mapJobRow(rows[0]);
}

async function updateJob(jobId, updater) {
  const current = await getJob(jobId);
  if (!current) {
    return null;
  }

  const next = updater({ ...current });
  next.id = jobId;
  next.createdAt = current.createdAt;
  next.updatedAt = nowIso();

  await query(
    `UPDATE ${tableName('jobs')}
      SET type = ?, tenant_code = ?, marketplace_code = ?, status = ?, payload_json = ?, dedupe_key = ?, attempts = ?, scheduled_for = ?, started_at = ?, completed_at = ?, error_text = ?, result_json = ?, updated_at = ?
      WHERE id = ?`,
    [
      next.type,
      next.tenantCode || null,
      next.marketplaceCode || null,
      next.status,
      toSqlJson(next.payload),
      next.dedupeKey || null,
      Number(next.attempts || 0),
      next.scheduledFor || current.scheduledFor,
      next.startedAt || null,
      next.completedAt || null,
      next.error || null,
      toSqlJson(next.result),
      next.updatedAt,
      jobId,
    ]
  );

  return next;
}

async function createAlert({ tenantCode, marketplaceCode, severity, title, message, source, payload, channels }) {
  await ensureSchema();
  const record = {
    id: createId('alert'),
    tenantCode: tenantCode || null,
    marketplaceCode: marketplaceCode || null,
    severity: severity || 'info',
    status: 'open',
    title,
    message,
    source: source || null,
    payload: payload || null,
    channels: channels || [],
    dispatchedAt: null,
    acknowledgedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  await query(
    `INSERT INTO ${tableName('alerts')} (
      id, tenant_code, marketplace_code, severity, status, title, message, source, payload_json, channels_json, dispatched_at, acknowledged_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.tenantCode,
      record.marketplaceCode,
      record.severity,
      record.status,
      record.title,
      record.message,
      record.source,
      toSqlJson(record.payload),
      toSqlJson(record.channels),
      record.dispatchedAt,
      record.acknowledgedAt,
      record.createdAt,
      record.updatedAt,
    ]
  );

  return record;
}

async function listAlerts(filters = {}) {
  await ensureSchema();
  const where = buildWhere(filters, {
    tenantCode: 'tenant_code',
    marketplaceCode: 'marketplace_code',
    status: 'status',
  });
  const [rows] = await query(
    `SELECT * FROM ${tableName('alerts')} ${where.sql} ORDER BY created_at DESC`,
    where.params
  );
  return rows.map(mapAlertRow);
}

async function getAlert(alertId) {
  await ensureSchema();
  const [rows] = await query(`SELECT * FROM ${tableName('alerts')} WHERE id = ? LIMIT 1`, [alertId]);
  return mapAlertRow(rows[0]);
}

async function updateAlert(alertId, updater) {
  const current = await getAlert(alertId);
  if (!current) {
    return null;
  }

  const next = updater({ ...current });
  next.id = alertId;
  next.createdAt = current.createdAt;
  next.updatedAt = nowIso();

  await query(
    `UPDATE ${tableName('alerts')}
      SET tenant_code = ?, marketplace_code = ?, severity = ?, status = ?, title = ?, message = ?, source = ?, payload_json = ?, channels_json = ?, dispatched_at = ?, acknowledged_at = ?, updated_at = ?
      WHERE id = ?`,
    [
      next.tenantCode || null,
      next.marketplaceCode || null,
      next.severity || 'info',
      next.status,
      next.title,
      next.message,
      next.source || null,
      toSqlJson(next.payload),
      toSqlJson(next.channels || []),
      next.dispatchedAt || null,
      next.acknowledgedAt || null,
      next.updatedAt,
      alertId,
    ]
  );

  return next;
}

async function createProposal({ tenantCode, marketplaceCode, sku, field, currentValue, proposedValue, risk, reason, evidence, autoApplyEligible, status, payload }) {
  await ensureSchema();
  const record = {
    id: createId('proposal'),
    tenantCode: tenantCode || null,
    marketplaceCode: marketplaceCode || null,
    sku: sku || null,
    field,
    currentValue: currentValue || '',
    proposedValue: proposedValue || '',
    risk: risk || 'medium',
    reason: reason || '',
    evidence: evidence || [],
    autoApplyEligible: Boolean(autoApplyEligible),
    status: status || 'open',
    payload: payload || null,
    appliedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  await query(
    `INSERT INTO ${tableName('proposals')} (
      id, tenant_code, marketplace_code, sku, field_name, current_value, proposed_value, risk, reason, evidence_json, auto_apply_eligible, status, payload_json, applied_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.tenantCode,
      record.marketplaceCode,
      record.sku,
      record.field,
      record.currentValue,
      record.proposedValue,
      record.risk,
      record.reason,
      toSqlJson(record.evidence),
      record.autoApplyEligible ? 1 : 0,
      record.status,
      toSqlJson(record.payload),
      record.appliedAt,
      record.createdAt,
      record.updatedAt,
    ]
  );

  return record;
}

async function listProposals(filters = {}) {
  await ensureSchema();
  const where = buildWhere(filters, {
    tenantCode: 'tenant_code',
    marketplaceCode: 'marketplace_code',
    sku: 'sku',
    status: 'status',
  });
  const [rows] = await query(
    `SELECT * FROM ${tableName('proposals')} ${where.sql} ORDER BY created_at DESC`,
    where.params
  );
  return rows.map(mapProposalRow);
}

async function getProposal(proposalId) {
  await ensureSchema();
  const [rows] = await query(`SELECT * FROM ${tableName('proposals')} WHERE id = ? LIMIT 1`, [proposalId]);
  return mapProposalRow(rows[0]);
}

async function updateProposal(proposalId, updater) {
  const current = await getProposal(proposalId);
  if (!current) {
    return null;
  }

  const next = updater({ ...current });
  next.id = proposalId;
  next.createdAt = current.createdAt;
  next.updatedAt = nowIso();

  await query(
    `UPDATE ${tableName('proposals')}
      SET tenant_code = ?, marketplace_code = ?, sku = ?, field_name = ?, current_value = ?, proposed_value = ?, risk = ?, reason = ?, evidence_json = ?, auto_apply_eligible = ?, status = ?, payload_json = ?, applied_at = ?, updated_at = ?
      WHERE id = ?`,
    [
      next.tenantCode || null,
      next.marketplaceCode || null,
      next.sku || null,
      next.field,
      next.currentValue || '',
      next.proposedValue || '',
      next.risk || 'medium',
      next.reason || '',
      toSqlJson(next.evidence || []),
      next.autoApplyEligible ? 1 : 0,
      next.status,
      toSqlJson(next.payload),
      next.appliedAt || null,
      next.updatedAt,
      proposalId,
    ]
  );

  return next;
}

async function getState(key) {
  await ensureSchema();
  const [rows] = await query(`SELECT * FROM ${tableName('states')} WHERE state_key = ? LIMIT 1`, [key]);
  return mapStateRow(rows[0]);
}

async function setState(key, payload) {
  await ensureSchema();
  const current = await getState(key);
  const record = {
    key,
    value: payload,
    createdAt: current ? current.createdAt : nowIso(),
    updatedAt: nowIso(),
  };

  await query(
    `INSERT INTO ${tableName('states')} (state_key, value_json, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_at = VALUES(updated_at)`,
    [record.key, toSqlJson(record.value), record.createdAt, record.updatedAt]
  );

  return record;
}

async function saveSnapshot({ type, tenantCode, marketplaceCode, key, payload, hash, source }) {
  await ensureSchema();
  const id = snapshotId(type, tenantCode, key);
  const current = await getSnapshot(type, tenantCode, key);
  const record = {
    id,
    type,
    tenantCode: tenantCode || null,
    marketplaceCode: marketplaceCode || null,
    key,
    payload,
    hash: hash || null,
    source: source || null,
    createdAt: current ? current.createdAt : nowIso(),
    updatedAt: nowIso(),
  };

  await query(
    `INSERT INTO ${tableName('snapshots')} (
      id, type, tenant_code, marketplace_code, snapshot_key, payload_json, hash, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        type = VALUES(type),
        tenant_code = VALUES(tenant_code),
        marketplace_code = VALUES(marketplace_code),
        snapshot_key = VALUES(snapshot_key),
        payload_json = VALUES(payload_json),
        hash = VALUES(hash),
        source = VALUES(source),
        updated_at = VALUES(updated_at)`,
    [
      record.id,
      record.type,
      record.tenantCode,
      record.marketplaceCode,
      record.key,
      toSqlJson(record.payload),
      record.hash,
      record.source,
      record.createdAt,
      record.updatedAt,
    ]
  );

  return record;
}

async function getSnapshot(type, tenantCode, key) {
  await ensureSchema();
  const [rows] = await query(`SELECT * FROM ${tableName('snapshots')} WHERE id = ? LIMIT 1`, [snapshotId(type, tenantCode, key)]);
  return mapSnapshotRow(rows[0]);
}

async function listSnapshots(filters = {}) {
  await ensureSchema();
  const where = buildWhere(filters, {
    tenantCode: 'tenant_code',
    marketplaceCode: 'marketplace_code',
    type: 'type',
  });
  const [rows] = await query(
    `SELECT * FROM ${tableName('snapshots')} ${where.sql} ORDER BY created_at DESC`,
    where.params
  );
  return rows.map(mapSnapshotRow);
}

async function recordNotification({ tenantCode, marketplaceCode, notificationType, payload, source }) {
  await ensureSchema();
  const record = {
    id: createId('notification'),
    tenantCode: tenantCode || null,
    marketplaceCode: marketplaceCode || null,
    notificationType: notificationType || null,
    payload: payload || null,
    source: source || null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  await query(
    `INSERT INTO ${tableName('notifications')} (
      id, tenant_code, marketplace_code, notification_type, payload_json, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.tenantCode,
      record.marketplaceCode,
      record.notificationType,
      toSqlJson(record.payload),
      record.source,
      record.createdAt,
      record.updatedAt,
    ]
  );

  return record;
}

async function listNotifications(filters = {}) {
  await ensureSchema();
  const where = buildWhere(filters, {
    tenantCode: 'tenant_code',
    marketplaceCode: 'marketplace_code',
  });
  const [rows] = await query(
    `SELECT * FROM ${tableName('notifications')} ${where.sql} ORDER BY created_at DESC`,
    where.params
  );
  return rows.map(mapNotificationRow);
}

async function upsertCatalogProduct({ tenantCode, sku, product, marketplaceCode }) {
  await ensureSchema();
  const current = await getCatalogProduct(tenantCode, sku);
  const marketplaceCodes = new Set([...(current?.marketplaceCodes || [])]);
  if (marketplaceCode) {
    marketplaceCodes.add(marketplaceCode);
  }

  const record = {
    id: catalogId(tenantCode, sku),
    tenantCode,
    sku,
    marketplaceCode: marketplaceCode || current?.marketplaceCode || null,
    marketplaceCodes: [...marketplaceCodes].sort(),
    product: product || {},
    createdAt: current ? current.createdAt : nowIso(),
    updatedAt: nowIso(),
  };

  await query(
    `INSERT INTO ${tableName('catalog')} (
      id, tenant_code, sku, marketplace_code, marketplace_codes_json, product_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        marketplace_code = VALUES(marketplace_code),
        marketplace_codes_json = VALUES(marketplace_codes_json),
        product_json = VALUES(product_json),
        updated_at = VALUES(updated_at)`,
    [
      record.id,
      record.tenantCode,
      record.sku,
      record.marketplaceCode,
      toSqlJson(record.marketplaceCodes),
      toSqlJson(record.product),
      record.createdAt,
      record.updatedAt,
    ]
  );

  return record;
}

async function getCatalogProduct(tenantCode, sku) {
  await ensureSchema();
  const [rows] = await query(
    `SELECT * FROM ${tableName('catalog')} WHERE tenant_code = ? AND sku = ? LIMIT 1`,
    [tenantCode, sku]
  );
  return mapCatalogRow(rows[0]);
}

async function listCatalogProducts(tenantCode) {
  await ensureSchema();
  const params = [];
  let whereSql = '';
  if (tenantCode) {
    whereSql = 'WHERE tenant_code = ?';
    params.push(tenantCode);
  }

  const [rows] = await query(
    `SELECT * FROM ${tableName('catalog')} ${whereSql} ORDER BY updated_at DESC`,
    params
  );
  return rows.map(mapCatalogRow);
}

async function enqueueEmailMessage({ tenantCode, subject, to, body, payload }) {
  await ensureSchema();
  const record = {
    id: createId('email'),
    tenantCode: tenantCode || null,
    subject,
    to: Array.isArray(to) ? to : [],
    body,
    payload: payload || null,
    status: 'queued',
    sentAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  await query(
    `INSERT INTO ${tableName('mail')} (
      id, tenant_code, subject, recipients_json, body, payload_json, status, sent_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.tenantCode,
      record.subject,
      toSqlJson(record.to),
      record.body,
      toSqlJson(record.payload),
      record.status,
      record.sentAt,
      record.createdAt,
      record.updatedAt,
    ]
  );

  return record;
}

module.exports = {
  claimQueuedJobs,
  createAlert,
  createId,
  createJob,
  createProposal,
  createRun,
  enqueueEmailMessage,
  ensureSchema,
  findOpenJobByDedupeKey,
  getAlert,
  getCatalogProduct,
  getJob,
  getProposal,
  getRun,
  getSnapshot,
  getState,
  listAlerts,
  listCatalogProducts,
  listJobs,
  listNotifications,
  listProposals,
  listRuns,
  listSnapshots,
  nowIso,
  recordNotification,
  saveSnapshot,
  setState,
  updateAlert,
  updateJob,
  updateProposal,
  updateRun,
  upsertCatalogProduct,
};
