# ResourceSpace + Akeneo

This project now includes a first-party integration bundle that adds a `ResourceSpace DAM` tab to Akeneo product and product-model edit forms.

## What it does

- Searches ResourceSpace from inside the Akeneo editor.
- Persists linked DAM assets per product or product model.
- Lets a user mark a linked ResourceSpace asset as primary.
- Can pull a ResourceSpace file into an Akeneo media attribute in one click.
- Writes Akeneo linkage metadata back into ResourceSpace on link, unlink, and sync.

## Configure ResourceSpace

Set these values in `.env` or your deployment environment:

```dotenv
RESOURCE_SPACE_BASE_URI=https://resourcespace.example.com
RESOURCE_SPACE_INTERNAL_BASE_URI=
RESOURCE_SPACE_API_USER=akeneo
RESOURCE_SPACE_API_KEY=your_api_key
RESOURCE_SPACE_SEARCH_TEMPLATE=akeneo_links:%s
RESOURCE_SPACE_DEFAULT_ATTRIBUTE_CODE=main_image
RESOURCE_SPACE_SEARCH_LIMIT=24
RESOURCE_SPACE_TIMEOUT_SECONDS=20
RESOURCE_SPACE_WRITEBACK_ENABLED=1
RESOURCE_SPACE_WRITEBACK_IDENTIFIER_FIELD=akeneo_identifier
RESOURCE_SPACE_WRITEBACK_UUID_FIELD=akeneo_product_uuid
RESOURCE_SPACE_WRITEBACK_OWNER_TYPE_FIELD=akeneo_owner_type
RESOURCE_SPACE_WRITEBACK_LINKS_FIELD=akeneo_links
```

Notes:

- `RESOURCE_SPACE_SEARCH_TEMPLATE` is the default query used when the tab loads without a manual search term.
- `%s` is replaced with the Akeneo product identifier or product model code.
- `RESOURCE_SPACE_DEFAULT_ATTRIBUTE_CODE` should point to an Akeneo `image` or `file` attribute if you want one-click syncing into Akeneo storage.
- `RESOURCE_SPACE_BASE_URI` is the browser-facing ResourceSpace URL. This is what Akeneo will render for previews and asset links.
- `RESOURCE_SPACE_INTERNAL_BASE_URI` is optional. Set it when Akeneo reaches ResourceSpace over a different Docker or private-network hostname than the browser does.
- The `RESOURCE_SPACE_WRITEBACK_*` values accept a ResourceSpace field shortname or numeric field ID.

## Finish the install

Run the migration, clear cache, and install bundle assets:

```powershell
docker compose run -u www-data --rm php php bin/console doctrine:migrations:migrate --no-interaction
docker compose run -u www-data --rm php php bin/console cache:clear --env=prod
docker compose run -u www-data --rm php php bin/console pim:installer:assets --symlink --clean
```

Then open any product or product model and load the `ResourceSpace DAM` tab to verify the Akeneo side can reach the DAM with the configured credentials.

List the active tenant-scoped DAM configurations with:

```powershell
docker compose run -u www-data --rm php php bin/console coppermind:resourcespace:tenant:list --env=prod
```

Create or update a tenant-scoped DAM connection with:

```powershell
docker compose run -u www-data --rm php php bin/console coppermind:resourcespace:tenant:configure --env=prod --tenant=default --label="Default Tenant" --base-uri=http://localhost:8081 --internal-base-uri=http://resourcespace --api-user=admin --api-key=your_api_key --default-attribute=image --writeback-enabled=1
```

Verify a tenant-specific connection with:

```powershell
docker compose run -u www-data --rm php php bin/console coppermind:resourcespace:test-connection --env=prod --tenant=default
```

If you are using the local Akeneo frontend workflow, rebuild assets after enabling the bundle:

```powershell
make assets
make javascript-dev
make css
```

## Local ResourceSpace stack

The repo now includes a pinned local ResourceSpace Docker build based on the official `resourcespace/docker` `v10.7` recipe.

Start it with:

```powershell
make resourcespace-up
```

The local bootstrap is self-installing. It provisions the schema, the `admin` super-admin account, and the Akeneo write-back metadata fields automatically on first boot. Use `make resourcespace-logs` to follow the stack and `make resourcespace-down` to stop just the ResourceSpace services.

For local Docker development, the default `.env` values are already aligned for the split hostname case:

```dotenv
RESOURCE_SPACE_BASE_URI=http://localhost:8081
RESOURCE_SPACE_INTERNAL_BASE_URI=http://resourcespace
```

That lets the browser load ResourceSpace on `localhost:8081` while Akeneo's PHP container talks to the `resourcespace` service on the Docker network.

## ResourceSpace-side setup

- Create a dedicated API user and API key in ResourceSpace for non-local environments.
- Create text metadata fields with the shortnames from `RESOURCE_SPACE_WRITEBACK_*`, or replace those env values with your existing field IDs.
- Recommended local field shortnames: `akeneo_identifier`, `akeneo_product_uuid`, `akeneo_owner_type`, `akeneo_links`
- Leave `RESOURCE_SPACE_SEARCH_TEMPLATE=akeneo_links:%s` if you want Akeneo links to become immediately searchable in ResourceSpace after write-back.

## Current scope

- Asset linking is stored in Akeneo in `coppermind_resourcespace_asset_link`.
- Unlinking an asset removes the DAM link, but it does not clear any Akeneo media value that was already synced.
- The sync flow downloads the DAM asset into Akeneo storage immediately. For very large binaries or bulk workflows, a queued import job would be the next step.
- Write-back is attempted immediately after every link change. If ResourceSpace is unavailable, Akeneo keeps the local link change and queues the metadata update for retry in `coppermind_resourcespace_writeback_job`.

## Write-back reliability

- The DAM tab now surfaces queued and failed write-back state on linked assets.
- Akeneo link and unlink actions no longer depend on ResourceSpace being healthy in the same request.
- Failed or pending write-back records can be retried directly from the DAM tab with the `Retry write-back` action.
- The local ResourceSpace stack now starts a dedicated `resourcespace-writeback-worker` container, so queued write-back jobs self-heal automatically in the background.

## Smoke test

Run the end-to-end smoke test with a seeded Akeneo product and explicit DAM refs:

```powershell
docker compose run -u www-data --rm php php bin/console coppermind:resourcespace:smoke-test --env=prod --tenant=default --primary-resource-ref=<primary_ref> --secondary-resource-ref=<secondary_ref>
```

Use the local seeder in `docker/resourcespace/seed-smoke-resource.php` if you want deterministic refs without relying on ResourceSpace's remote-upload API behavior. The smoke test covers ResourceSpace search, link, mark-primary, sync, unlink, and queued write-back processing in one command.
