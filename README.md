Akeneo PIM Community Standard Edition
=====================================

Welcome to Akeneo PIM.

This repository is used to create a new PIM project based on Akeneo PIM.

If you want to contribute to the Akeneo PIM (and we will be pleased if you do!), you can fork the repository https://github.com/akeneo/pim-community-dev and submit a pull request.

Installation instructions
-------------------------

### Development Installation with Docker

## Requirements
 - Docker 19+
 - docker-compose >= 1.24
 - make

## Creating a project and starting the PIM
The following steps will install Akeneo PIM in the current directory (must be empty) and launch it from there:

```bash
$ docker run -u www-data -v $(pwd):/srv/pim -w /srv/pim --rm akeneo/pim-php-dev:8.1 \
    php /usr/local/bin/composer create-project --prefer-dist \
    akeneo/pim-community-standard /srv/pim "dev-master@dev"
```
```
$ make

```

The PIM will be available on http://localhost:8080/, with `admin/admin` as default credentials.

To shutdown your PIM: `make down`

### Installation without Docker


```bash
$ php /usr/local/bin/composer create-project --prefer-dist akeneo/pim-community-standard /srv/pim "dev-master@dev"
```

You will need to change the `.env` file to configure the access to your MySQL and ES server.

Once done, you can run:

```
$ NO_DOCKER=true make
```

For more details, please follow https://docs.akeneo.com/master/install_pim

Upgrade instructions
--------------------

To upgrade Akeneo PIM to a newer version, please follow:
https://docs.akeneo.com/master/migrate_pim/index.html

Changelog
---------
You can check out the changelog files in https://github.com/akeneo/pim-community-dev.

Operator Stack
--------------

This repository is the Operator catalog and asset stack: Akeneo Community Edition with Epic Global's custom governance, DAM, and marketplace orchestration layers on top.

Setup notes live in [docs/resourcespace.md](docs/resourcespace.md).
SaaS rollout notes live in [docs/saas-readiness.md](docs/saas-readiness.md).
Operator platform boundary notes live in [docs/coppermind-platform.md](docs/coppermind-platform.md).
Amazon marketplace automation notes live in [docs/amazon-marketplace.md](docs/amazon-marketplace.md).
Epic AWS deployment notes live in [docs/aws-epic-deployment.md](docs/aws-epic-deployment.md).
DNS and TLS cutover notes for `operator.epicglobalinc.com` live in [docs/operator-dns-cutover.md](docs/operator-dns-cutover.md).
Backup, restore, and monitoring notes live in [docs/operator-ops.md](docs/operator-ops.md).

For local development:

- Start the pinned ResourceSpace stack and write-back worker with `make resourcespace-up`.
- Start the standalone marketplace orchestration service with `make marketplace-up`.
- The PIM runs at `http://localhost:8080`, ResourceSpace runs at `http://localhost:8081`, and the marketplace orchestrator runs at `http://localhost:8090`.

Recent Operator additions in this repo:

- Akeneo-side governance workflow state, approvals, asset-rights queue, and operator APIs
- durable outbox and async media-ingest workers
- marketplace review inbox, proposal approval/apply endpoints, onboarding state, and readiness reporting
- Epic AWS deployment wrappers for isolated prod/dev environments
