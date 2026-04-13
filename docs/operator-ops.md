# Operator Ops

## Backup

Create a local backup bundle from the repo root:

```bash
bash scripts/operator-backup.sh
```

That produces:

- `akeneo.sql.gz`
- `resourcespace.sql.gz`
- `resourcespace-filestore.tar.gz`
- `manifest.json`

If `OPERATOR_BACKUP_S3_URI` is set, the script also copies the backup bundle to S3.

If `OPERATOR_CONTROL_PLANE_OPS_BASE_URL` is set, the script also posts a backup record to the Operator control plane so the ops dashboard stays current.

## Restore

Restore from a previously created backup directory:

```bash
bash scripts/operator-restore.sh ~/backups/operator-YYYYMMDD-HHMMSS --yes
```

The restore replaces:

- the Akeneo database
- the ResourceSpace database
- the ResourceSpace filestore

If `OPERATOR_CONTROL_PLANE_OPS_BASE_URL` is set, the restore script records the restore run as a `restore_drill` event in the control plane.

## Monitoring

Post service-health snapshots into the Operator control plane:

```bash
bash scripts/operator-monitor.sh
```

The script checks:

- Operator / control-plane health, when `OPERATOR_CONTROL_PLANE_OPS_BASE_URL` is set
- Akeneo login availability
- ResourceSpace login availability
- marketplace orchestrator health
- Epic AI health, when `OPERATOR_MONITOR_EPIC_AI_URL` is set

To feed the ops dashboard, set:

- `OPERATOR_CONTROL_PLANE_OPS_BASE_URL`
- `OPERATOR_CONTROL_PLANE_ENVIRONMENT`
- `OPERATOR_CONTROL_PLANE_OPS_TENANT`

## Recommended scheduling

- staging: daily backup
- production: at least nightly backup plus a pre-deploy backup
- production: `operator-monitor.sh` every 5 minutes
- production: at least one restore drill per month, recorded through `operator-restore.sh`

## Monitoring baseline

At minimum, monitor:

- EC2 instance status checks
- CPU utilization
- disk usage
- `marketplace-orchestrator` `/health`
- Operator web availability
- queue backlog and failed jobs

The provisioning pass for `epic-dev` should install these as the default baseline.

## Log Aggregation

The current baseline should ship container and host logs into a managed sink instead of leaving them only on-box. At minimum:

- Docker container stdout/stderr for `httpd`, `fpm`, `mysql`, `resourcespace`, and `marketplace-orchestrator`
- backup and restore script logs
- control-plane logs once it becomes the main entry point

## Runbooks

Minimum operator runbooks:

- Akeneo unavailable
- DAM unavailable
- marketplace orchestrator backlog/failure spike
- Amazon notification or validation failure
- backup failure
- failed restore drill

These runbooks should be linked from incidents created in the Operator control plane.

## Infrastructure Hardening

For SaaS rollout, the remaining infra hardening work is:

- move Akeneo/DAM media storage to managed object storage
- put CDN delivery in front of public media
- finish clean hostnames and TLS for all remaining services instead of raw IP/port access
- tighten direct instance exposure once every service is behind a stable hostname
