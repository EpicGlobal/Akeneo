# Operator AWS Deployment

This repository deploys the Operator application stack into Epic Global AWS accounts with the existing Docker Compose runtime and the Epic-specific bootstrap wrapper.

The runtime still uses the current parameter prefix and bootstrap scripts:

- Parameter Store prefix: `/epic-global/akeneo-pim/prod`
- Deploy wrapper: `scripts/aws-epic-deploy.sh`
- EC2 bootstrap helper: `scripts/aws-ec2-bootstrap.sh`

## Production

From an EC2 instance in the target account:

```bash
export AWS_REGION=us-west-2
export DEPLOY_PARAMETER_PREFIX=/epic-global/akeneo-pim/prod
bash scripts/aws-epic-deploy.sh <public-ip-or-url>
```

## Fresh Host Bootstrap

If the host does not already have Docker and the repo checked out:

```bash
export AWS_REGION=us-west-2
export DEPLOY_PARAMETER_PREFIX=/epic-global/akeneo-pim/prod
export BOOTSTRAP_SCRIPT=scripts/aws-epic-deploy.sh
bash scripts/aws-ec2-bootstrap.sh <public-ip-or-url>
```

## What The Epic Wrapper Does

- pulls secrets from AWS Systems Manager Parameter Store
- writes the required `.env` values for Akeneo, ResourceSpace, and object storage
- derives the ResourceSpace private API key for the bootstrap admin user from `RESOURCE_SPACE_API_SCRAMBLE_KEY`
- runs the existing `scripts/aws-first-run.sh` bootstrap
- replays the custom Operator platform migrations that Akeneo's installer marks as executed during a fresh catalog install
- runs Doctrine migrations
- starts ResourceSpace plus background workers
- installs the marketplace orchestrator Node dependencies once, then starts the orchestrator plus worker
- configures the default tenant-scoped ResourceSpace connection
- stops non-runtime Akeneo helper containers after the build completes

## Current Epic Prod Footprint

Verified in `epic-prod` / `us-west-2` on April 8, 2026:

- EC2 instance: `i-0f11f729d8189d6a9` (`epic-akeneo-pim-prod`)
- Elastic IP: `184.32.65.221`
- VPC: `vpc-0b9e25c427bb6d0a3`
- Security group: `sg-06c8ff6aa947ca771`

The current public entrypoint is still the raw IP. The Operator hostname cutover plan lives in [docs/operator-dns-cutover.md](operator-dns-cutover.md).

## Required Parameter Store Keys

Under the chosen prefix:

- `app_secret`
- `app_database_password`
- `app_database_root_password`
- `object_storage_access_key`
- `object_storage_secret_key`
- `resource_space_db_password`
- `resource_space_db_root_password`
- `resource_space_admin_password`
- `resource_space_scramble_key`
- `resource_space_api_scramble_key`

## Remaining Manual Follow-Ups

- point DNS at the host or Elastic IP
- add TLS in front of port 80
- configure a real mailer/SES path
- provide live Amazon and Epic AI credentials when ready
- create and map a real Akeneo media attribute if you want one-click binary sync from the DAM
