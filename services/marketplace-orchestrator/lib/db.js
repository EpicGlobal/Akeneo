require('./bootstrap-env');

const mysql = require('mysql2/promise');

const tablePrefix = process.env.MARKETPLACE_DB_TABLE_PREFIX?.trim() || 'coppermind_marketplace_';

let pool;
let schemaPromise;

function tableName(suffix) {
  return `\`${tablePrefix}${suffix}\``;
}

function databaseConfig() {
  const url = process.env.MARKETPLACE_DB_URL?.trim();
  if (url) {
    return {
      uri: url,
      waitForConnections: true,
      connectionLimit: Math.max(2, Number(process.env.MARKETPLACE_DB_POOL_LIMIT || 10) || 10),
      queueLimit: 0,
      charset: 'utf8mb4',
    };
  }

  return {
    host: process.env.MARKETPLACE_DB_HOST?.trim()
      || process.env.APP_DATABASE_HOST?.trim()
      || 'localhost',
    port: Number(process.env.MARKETPLACE_DB_PORT || process.env.APP_DATABASE_PORT || 3306) || 3306,
    user: process.env.MARKETPLACE_DB_USER?.trim()
      || process.env.APP_DATABASE_USER?.trim()
      || 'root',
    password: process.env.MARKETPLACE_DB_PASSWORD?.trim()
      || process.env.APP_DATABASE_PASSWORD?.trim()
      || '',
    database: process.env.MARKETPLACE_DB_NAME?.trim()
      || process.env.APP_DATABASE_NAME?.trim()
      || 'akeneo_pim',
    waitForConnections: true,
    connectionLimit: Math.max(2, Number(process.env.MARKETPLACE_DB_POOL_LIMIT || 10) || 10),
    queueLimit: 0,
    charset: 'utf8mb4',
  };
}

async function ensureDatabaseExists(config) {
  if (config.uri || !config.database) {
    return;
  }

  const bootstrap = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    charset: 'utf8mb4',
  });

  try {
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await bootstrap.end();
  }
}

function getPool() {
  if (!pool) {
    pool = mysql.createPool(databaseConfig());
  }

  return pool;
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const config = databaseConfig();
      await ensureDatabaseExists(config);
      if (!pool) {
        pool = mysql.createPool(config);
      }

      const connection = await pool.getConnection();
      try {
        await connection.query(`
          CREATE TABLE IF NOT EXISTS ${tableName('runs')} (
            id VARCHAR(80) NOT NULL PRIMARY KEY,
            tenant_code VARCHAR(120) NULL,
            marketplace_code VARCHAR(120) NULL,
            status VARCHAR(40) NOT NULL,
            trigger_json LONGTEXT NULL,
            product_json LONGTEXT NULL,
            payload_json LONGTEXT NULL,
            evaluation_json LONGTEXT NULL,
            listing_payload_json LONGTEXT NULL,
            created_at VARCHAR(40) NOT NULL,
            updated_at VARCHAR(40) NOT NULL,
            KEY idx_runs_tenant_marketplace_status_created (tenant_code, marketplace_code, status, created_at),
            KEY idx_runs_created (created_at)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await connection.query(`
          CREATE TABLE IF NOT EXISTS ${tableName('jobs')} (
            id VARCHAR(80) NOT NULL PRIMARY KEY,
            type VARCHAR(120) NOT NULL,
            tenant_code VARCHAR(120) NULL,
            marketplace_code VARCHAR(120) NULL,
            status VARCHAR(40) NOT NULL,
            payload_json LONGTEXT NULL,
            dedupe_key VARCHAR(255) NULL,
            attempts INT NOT NULL DEFAULT 0,
            scheduled_for VARCHAR(40) NOT NULL,
            started_at VARCHAR(40) NULL,
            completed_at VARCHAR(40) NULL,
            error_text LONGTEXT NULL,
            result_json LONGTEXT NULL,
            created_at VARCHAR(40) NOT NULL,
            updated_at VARCHAR(40) NOT NULL,
            KEY idx_jobs_status_scheduled (status, scheduled_for, created_at),
            KEY idx_jobs_tenant_marketplace_status (tenant_code, marketplace_code, status),
            KEY idx_jobs_type_status (type, status),
            KEY idx_jobs_dedupe (dedupe_key)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await connection.query(`
          CREATE TABLE IF NOT EXISTS ${tableName('alerts')} (
            id VARCHAR(80) NOT NULL PRIMARY KEY,
            tenant_code VARCHAR(120) NULL,
            marketplace_code VARCHAR(120) NULL,
            severity VARCHAR(40) NOT NULL,
            status VARCHAR(40) NOT NULL,
            title VARCHAR(255) NOT NULL,
            message LONGTEXT NOT NULL,
            source VARCHAR(120) NULL,
            payload_json LONGTEXT NULL,
            channels_json LONGTEXT NULL,
            dispatched_at VARCHAR(40) NULL,
            acknowledged_at VARCHAR(40) NULL,
            created_at VARCHAR(40) NOT NULL,
            updated_at VARCHAR(40) NOT NULL,
            KEY idx_alerts_tenant_marketplace_status_created (tenant_code, marketplace_code, status, created_at),
            KEY idx_alerts_status_created (status, created_at)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await connection.query(`
          CREATE TABLE IF NOT EXISTS ${tableName('proposals')} (
            id VARCHAR(80) NOT NULL PRIMARY KEY,
            tenant_code VARCHAR(120) NULL,
            marketplace_code VARCHAR(120) NULL,
            sku VARCHAR(120) NULL,
            field_name VARCHAR(120) NOT NULL,
            current_value LONGTEXT NULL,
            proposed_value LONGTEXT NULL,
            risk VARCHAR(40) NOT NULL,
            reason LONGTEXT NULL,
            evidence_json LONGTEXT NULL,
            auto_apply_eligible TINYINT(1) NOT NULL DEFAULT 0,
            status VARCHAR(40) NOT NULL,
            payload_json LONGTEXT NULL,
            applied_at VARCHAR(40) NULL,
            created_at VARCHAR(40) NOT NULL,
            updated_at VARCHAR(40) NOT NULL,
            KEY idx_proposals_tenant_marketplace_sku_status_created (tenant_code, marketplace_code, sku, status, created_at),
            KEY idx_proposals_status_created (status, created_at)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await connection.query(`
          CREATE TABLE IF NOT EXISTS ${tableName('states')} (
            state_key VARCHAR(255) NOT NULL PRIMARY KEY,
            value_json LONGTEXT NOT NULL,
            created_at VARCHAR(40) NOT NULL,
            updated_at VARCHAR(40) NOT NULL
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await connection.query(`
          CREATE TABLE IF NOT EXISTS ${tableName('snapshots')} (
            id VARCHAR(255) NOT NULL PRIMARY KEY,
            type VARCHAR(120) NOT NULL,
            tenant_code VARCHAR(120) NULL,
            marketplace_code VARCHAR(120) NULL,
            snapshot_key VARCHAR(255) NOT NULL,
            payload_json LONGTEXT NULL,
            hash VARCHAR(64) NULL,
            source VARCHAR(120) NULL,
            created_at VARCHAR(40) NOT NULL,
            updated_at VARCHAR(40) NOT NULL,
            KEY idx_snapshots_tenant_marketplace_type_created (tenant_code, marketplace_code, type, created_at),
            KEY idx_snapshots_type_key (type, snapshot_key)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await connection.query(`
          CREATE TABLE IF NOT EXISTS ${tableName('notifications')} (
            id VARCHAR(80) NOT NULL PRIMARY KEY,
            tenant_code VARCHAR(120) NULL,
            marketplace_code VARCHAR(120) NULL,
            notification_type VARCHAR(120) NULL,
            payload_json LONGTEXT NULL,
            source VARCHAR(120) NULL,
            created_at VARCHAR(40) NOT NULL,
            updated_at VARCHAR(40) NOT NULL,
            KEY idx_notifications_tenant_marketplace_created (tenant_code, marketplace_code, created_at),
            KEY idx_notifications_type_created (notification_type, created_at)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await connection.query(`
          CREATE TABLE IF NOT EXISTS ${tableName('catalog')} (
            id VARCHAR(255) NOT NULL PRIMARY KEY,
            tenant_code VARCHAR(120) NOT NULL,
            sku VARCHAR(120) NOT NULL,
            marketplace_code VARCHAR(120) NULL,
            marketplace_codes_json LONGTEXT NULL,
            product_json LONGTEXT NOT NULL,
            created_at VARCHAR(40) NOT NULL,
            updated_at VARCHAR(40) NOT NULL,
            UNIQUE KEY uniq_catalog_tenant_sku (tenant_code, sku),
            KEY idx_catalog_tenant_updated (tenant_code, updated_at),
            KEY idx_catalog_sku (sku)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await connection.query(`
          CREATE TABLE IF NOT EXISTS ${tableName('mail')} (
            id VARCHAR(80) NOT NULL PRIMARY KEY,
            tenant_code VARCHAR(120) NULL,
            subject VARCHAR(255) NOT NULL,
            recipients_json LONGTEXT NULL,
            body LONGTEXT NULL,
            payload_json LONGTEXT NULL,
            status VARCHAR(40) NOT NULL,
            sent_at VARCHAR(40) NULL,
            created_at VARCHAR(40) NOT NULL,
            updated_at VARCHAR(40) NOT NULL,
            KEY idx_mail_status_created (status, created_at)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
      } finally {
        connection.release();
      }
    })();
  }

  return schemaPromise;
}

async function query(sql, params = []) {
  await ensureSchema();
  return getPool().query(sql, params);
}

async function execute(sql, params = []) {
  const [result] = await query(sql, params);
  return result;
}

async function transaction(work) {
  await ensureSchema();
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    schemaPromise = null;
  }
}

module.exports = {
  closePool,
  ensureSchema,
  execute,
  getPool,
  query,
  tableName,
  transaction,
};
