require('./lib/bootstrap-env');

const { runQueuedJob } = require('./lib/job-runner');
const { scheduleAmazonMaintenance } = require('./lib/scheduler');
const { claimQueuedJobs, ensureSchema } = require('./lib/store');

const pollMs = Math.max(1000, Number(process.env.MARKETPLACE_WORKER_POLL_MS || 5000) || 5000);
const batchSize = Math.max(1, Number(process.env.MARKETPLACE_WORKER_BATCH_SIZE || 10) || 10);

async function processBatch() {
  const scheduled = await scheduleAmazonMaintenance();
  if (scheduled.length > 0) {
    console.log(`Scheduled ${scheduled.length} recurring Amazon maintenance job(s).`);
  }

  const jobs = await claimQueuedJobs(batchSize);
  if (jobs.length === 0) {
    return 0;
  }

  let processed = 0;

  for (const job of jobs) {
    try {
      const result = await runQueuedJob(job);
      processed += 1;
      console.log(`Processed job ${job.id} (${job.type}) with status ${result?.skipped ? 'skipped' : 'completed'}.`);
    } catch (error) {
      processed += 1;
      console.error(`Failed job ${job.id} (${job.type}): ${error.message}`);
    }
  }

  return processed;
}

async function loop() {
  try {
    await processBatch();
  } catch (error) {
    console.error(error);
  } finally {
    setTimeout(loop, pollMs);
  }
}

async function start() {
  await ensureSchema();
  console.log(`Marketplace orchestrator worker polling every ${pollMs}ms with batch size ${batchSize}`);
  loop();
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
