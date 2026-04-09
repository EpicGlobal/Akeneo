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

## Restore

Restore from a previously created backup directory:

```bash
bash scripts/operator-restore.sh ~/backups/operator-YYYYMMDD-HHMMSS --yes
```

The restore replaces:

- the Akeneo database
- the ResourceSpace database
- the ResourceSpace filestore

## Recommended scheduling

- staging: daily backup
- production: at least nightly backup plus a pre-deploy backup

## Monitoring baseline

At minimum, monitor:

- EC2 instance status checks
- CPU utilization
- disk usage
- `marketplace-orchestrator` `/health`
- Operator web availability
- queue backlog and failed jobs

The provisioning pass for `epic-dev` should install these as the default baseline.
