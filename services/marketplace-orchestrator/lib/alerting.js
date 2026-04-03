const { enqueueEmailMessage, nowIso, updateAlert } = require('./store');

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Alert delivery failed with HTTP ${response.status}: ${bodyText}`);
  }

  return bodyText;
}

async function dispatchSlack(alert, slackWebhookUrl) {
  if (!slackWebhookUrl) {
    return null;
  }

  await postJson(slackWebhookUrl, {
    text: `[${alert.severity.toUpperCase()}] ${alert.title}\n${alert.message}`,
  });

  return {
    channel: 'slack',
    dispatchedAt: nowIso(),
  };
}

async function dispatchPagerDuty(alert, routingKey) {
  if (!routingKey) {
    return null;
  }

  await postJson('https://events.pagerduty.com/v2/enqueue', {
    routing_key: routingKey,
    event_action: 'trigger',
    payload: {
      summary: alert.title,
      source: alert.source || 'coppermind-marketplace-orchestrator',
      severity: ['critical', 'error'].includes(alert.severity) ? 'critical' : 'warning',
      custom_details: {
        message: alert.message,
        payload: alert.payload,
      },
    },
  });

  return {
    channel: 'pagerduty',
    dispatchedAt: nowIso(),
  };
}

async function dispatchEmail(alert, emailConfig) {
  if (!emailConfig || !emailConfig.enabled) {
    return null;
  }

  const recipients = Array.isArray(emailConfig.to) ? emailConfig.to : [];
  if (0 === recipients.length) {
    return null;
  }

  await enqueueEmailMessage({
    tenantCode: alert.tenantCode,
    subject: `[${alert.severity.toUpperCase()}] ${alert.title}`,
    to: recipients,
    body: alert.message,
    payload: alert.payload,
  });

  return {
    channel: 'email-outbox',
    dispatchedAt: nowIso(),
  };
}

async function dispatchSellerCentral(alert, amazonClient, sellerCentralConfig) {
  if (!sellerCentralConfig || !sellerCentralConfig.enabled || !amazonClient) {
    return null;
  }

  const notification = await amazonClient.createSellerCentralNotification({
    marketplaceId: sellerCentralConfig.marketplaceId,
    destinationUserId: sellerCentralConfig.destinationUserId || null,
    notificationType: sellerCentralConfig.notificationType || 'WARNING',
    content: {
      title: alert.title,
      message: alert.message,
    },
  });

  return {
    channel: 'seller-central',
    dispatchedAt: nowIso(),
    notificationId: notification.notificationId || null,
  };
}

async function dispatchAlert(alert, { tenantConfig, amazonClient }) {
  const alertConfig = tenantConfig?.amazon?.alerts || {};
  const deliveries = [];

  const slackResult = await dispatchSlack(alert, alertConfig.slackWebhookUrl);
  if (slackResult) {
    deliveries.push(slackResult);
  }

  const pagerDutyResult = await dispatchPagerDuty(alert, alertConfig.pagerDutyRoutingKey);
  if (pagerDutyResult) {
    deliveries.push(pagerDutyResult);
  }

  const emailResult = await dispatchEmail(alert, alertConfig.email);
  if (emailResult) {
    deliveries.push(emailResult);
  }

  const sellerCentralResult = await dispatchSellerCentral(alert, amazonClient, alertConfig.sellerCentral);
  if (sellerCentralResult) {
    deliveries.push(sellerCentralResult);
  }

  await updateAlert(alert.id, (current) => ({
    ...current,
    status: deliveries.length > 0 ? 'dispatched' : current.status,
    dispatchedAt: deliveries.length > 0 ? nowIso() : current.dispatchedAt,
    channels: deliveries,
  }));

  return deliveries;
}

module.exports = {
  dispatchAlert,
};
