const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

function loadModule(configFile, overrideFile) {
  process.env.MARKETPLACE_ORCHESTRATOR_CONFIG_FILE = configFile;
  process.env.MARKETPLACE_ORCHESTRATOR_OVERRIDE_FILE = overrideFile;
  delete require.cache[require.resolve('../lib/config-loader')];
  return require('../lib/config-loader');
}

test('config loader provisions synthetic tenants and admin settings via overrides', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'marketplace-config-loader-'));
  const configFile = path.join(tempRoot, 'tenants.json');
  const overrideFile = path.join(tempRoot, 'tenant-overrides.json');

  fs.writeFileSync(configFile, JSON.stringify({
    tenants: [
      {
        code: 'default',
        label: 'Default Tenant',
        governance: {
          stages: ['catalog_review', 'launch_review'],
        },
        amazon: {
          enabled: true,
          mode: 'mock',
          pilotFamilyCodes: ['shoes'],
          notifications: {
            types: ['LISTINGS_ITEM_STATUS_CHANGE'],
          },
          alerts: {
            email: {
              enabled: true,
              to: ['ops@example.com'],
            },
          },
        },
        ai: {
          listingWriter: {
            enabled: true,
            providerIds: ['openai'],
          },
        },
        marketplaces: [
          {
            code: 'amazon_us',
            label: 'Amazon US',
            channel: 'amazon',
            requiredAttributes: ['name', 'description'],
            requiredAssetRoles: ['hero', 'detail'],
            requiredApprovals: ['launch_review'],
            minimumImageCount: 3,
            automation: ['listing_writer'],
          },
        ],
      },
    ],
  }, null, 2));

  const loader = loadModule(configFile, overrideFile);
  const created = loader.createTenantConfig({
    code: 'acme',
    label: 'Acme',
    ownerEmail: 'owner@example.com',
    templateCode: 'default',
    amazon: {
      mode: 'live',
      pilotFamilyCodes: ['bags'],
      notificationTypes: ['LISTINGS_ITEM_STATUS_CHANGE', 'LISTINGS_ITEM_ISSUES_CHANGE'],
      alerts: {
        email: {
          enabled: true,
          to: ['alerts@example.com'],
        },
      },
    },
    ai: {
      listingWriter: {
        enabled: true,
        providerIds: ['openai', 'anthropic'],
      },
    },
  });

  assert.equal(created.code, 'acme');
  assert.equal(created.amazon.mode, 'live');
  assert.deepEqual(created.amazon.pilotFamilyCodes, ['bags']);

  const tenants = loader.listTenants();
  assert.equal(tenants.some((tenant) => tenant.code === 'acme'), true);

  const settings = loader.getTenantAdminSettings('acme');
  assert.equal(settings.amazon.mode, 'live');
  assert.deepEqual(settings.amazon.notificationTypes, ['LISTINGS_ITEM_STATUS_CHANGE', 'LISTINGS_ITEM_ISSUES_CHANGE']);
  assert.deepEqual(settings.ai.providerIds, ['openai', 'anthropic']);

  const updated = loader.updateTenantAdminSettings('acme', {
    label: 'Acme Updated',
    amazon: {
      mode: 'mock',
      pilotFamilyCodes: ['accessories'],
      notificationTypes: ['ACCOUNT_STATUS_CHANGED'],
      alerts: {
        email: {
          enabled: false,
          to: ['ops2@example.com'],
        },
      },
    },
    ai: {
      listingWriter: {
        enabled: false,
        providerIds: ['gemini'],
      },
    },
  });

  assert.equal(updated.label, 'Acme Updated');
  assert.equal(updated.amazon.mode, 'mock');
  assert.deepEqual(updated.amazon.pilotFamilyCodes, ['accessories']);
  assert.deepEqual(updated.amazon.notificationTypes, ['ACCOUNT_STATUS_CHANGED']);
  assert.deepEqual(updated.amazon.alerts.email.to, ['ops2@example.com']);
  assert.equal(updated.ai.enabled, false);
  assert.deepEqual(updated.ai.providerIds, ['gemini']);

  const overridePayload = JSON.parse(fs.readFileSync(overrideFile, 'utf8'));
  assert.equal(overridePayload.tenants.acme.label, 'Acme Updated');
  assert.equal(overridePayload.tenants.acme.amazon.mode, 'mock');
  assert.deepEqual(overridePayload.tenants.acme.ai.listingWriter.providerIds, ['gemini']);
});
