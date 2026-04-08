# Operator DNS And TLS Cutover

This runbook moves the current production Operator catalog app from the raw Elastic IP to `https://operator.epicglobalinc.com/`.

## Current verified state

Verified on April 8, 2026 with the `epic-prod` profile in `us-west-2`:

- AWS account: `897689477180`
- EC2 instance: `i-0f11f729d8189d6a9` (`epic-akeneo-pim-prod`)
- Elastic IP: `184.32.65.221` (`eipalloc-07195b23db161e744`)
- VPC: `vpc-0b9e25c427bb6d0a3`
- Instance subnet: `subnet-0854864de98b5a0ae` (`us-west-2a`)
- Security group: `sg-06c8ff6aa947ca771`
- Current public app URL: `https://operator.epicglobalinc.com/`
- Current DAM URL: `http://184.32.65.221:8081/`
- ACM certificate: `arn:aws:acm:us-west-2:897689477180:certificate/eab5d692-0ebb-408b-be92-0951ea0f7903`
- ALB security group: `sg-06d6365330d75fba9` (`operator-prod-alb-sg`)
- ALB: `operator-prod-alb`
- ALB DNS name: `operator-prod-alb-1727515185.us-west-2.elb.amazonaws.com`
- Target group: `operator-prod-web-tg`

DNS checks:

- `operator.epicglobalinc.com` is currently `NXDOMAIN`
- `epicglobalinc.com` is not hosted in Route 53 inside `epic-prod`
- the domain currently resolves through Google-hosted nameservers:
  - `ns-cloud-d1.googledomains.com`
  - `ns-cloud-d2.googledomains.com`
  - `ns-cloud-d3.googledomains.com`
  - `ns-cloud-d4.googledomains.com`

Certificate checks:

- an ACM certificate already exists for `atlas.epicglobalinc.com`
- a dedicated ACM certificate now exists for `operator.epicglobalinc.com` and is `ISSUED`

Current cutover state:

- the ALB is active
- the Operator EC2 target is healthy behind the ALB
- the ALB serves HTTPS on port `443`
- port `80` redirects to `443`
- `operator.epicglobalinc.com` now resolves to the ALB
- direct public web access to the EC2 instance on ports `80` and `443` has been removed
- the remaining optional hardening step is to put the DAM behind its own hostname and TLS edge

## Recommended target shape

Use a dedicated internet-facing Application Load Balancer in `epic-prod` with an ACM certificate in `us-west-2`.

Recommended layout:

1. Create a dedicated ALB for Operator instead of reusing the existing `epic-global-itam-prod` load balancer.
2. Attach the ALB to at least two public subnets in `vpc-0b9e25c427bb6d0a3`.
3. Create an ACM certificate for `operator.epicglobalinc.com` in `us-west-2`.
4. Forward HTTPS traffic from the ALB to the existing EC2 instance on HTTP port `80`.
5. Update the authoritative DNS zone for `epicglobalinc.com` to point `operator` at the ALB DNS name.
6. After validation, restrict direct public access to the EC2 instance so port `80` only accepts traffic from the ALB security group.

Suggested public subnets for the ALB:

- `subnet-0854864de98b5a0ae` (`us-west-2a`)
- `subnet-018d085eaa6fcec1d` (`us-west-2b`)

Alternative public subnets are also available:

- `subnet-0535596b4c8027a68` (`us-west-2c`)
- `subnet-0f22f6afb55c76b5c` (`us-west-2d`)

## Why this shape

- ACM handles certificate lifecycle without putting private keys on the instance.
- ALB gives a clean AWS-managed TLS edge and future room for `dam.operator.epicglobalinc.com` or additional Operator services.
- DNS stays simple because `operator.epicglobalinc.com` can be a `CNAME` to the ALB if the domain remains outside Route 53.
- This keeps Operator isolated instead of hanging it off an unrelated shared load balancer.

## Cutover steps

### 1. Create the ACM certificate

Issued in `us-west-2`:

- `operator.epicglobalinc.com`

Current validation record:

- name: `_fe7d998f7f73834cb6011f345ef4c74e.operator.epicglobalinc.com`
- type: `CNAME`
- value: `_c45a85598387d8261bc36573ef235736.jkddzztszm.acm-validations.aws`

If Epic Global later wants broader hostname coverage, request a wildcard in a separate certificate:

- `*.epicglobalinc.com`

Keep the ACM validation record in DNS. It is already working and should stay in place for future certificate renewals.

### 2. Create the ALB

Created:

- a dedicated internet-facing ALB: `operator-prod-alb`
- an ALB security group: `operator-prod-alb-sg`
- a target group that forwards HTTP traffic to `i-0f11f729d8189d6a9` on port `80`: `operator-prod-web-tg`

Listener layout:

- `80` -> redirect to `443`
- `443` -> forward to the Operator target group using the ACM certificate

### 3. Validate the target path before DNS

Before DNS changes:

- confirm the target group marks the EC2 instance healthy
- test the ALB DNS name directly
- verify login page load
- verify static assets load from `/branding/brand-theme.css` and `/branding/brand-theme.js`
- verify authenticated navigation after login

Current verification:

- target health is `healthy`
- `http://operator-prod-alb-1727515185.us-west-2.elb.amazonaws.com/` returns the Operator login redirect
- `https://operator-prod-alb-1727515185.us-west-2.elb.amazonaws.com/` is available behind the issued certificate

### 4. Update DNS

Because the zone is not in Route 53 inside `epic-prod`, update the real authoritative DNS provider for `epicglobalinc.com`.

If the zone stays in Google Cloud DNS or Google-managed DNS:

- create `operator.epicglobalinc.com` as a `CNAME` to the ALB DNS name

Current production target:

- `operator` -> `operator-prod-alb-1727515185.us-west-2.elb.amazonaws.com`

If the zone is later moved into Route 53:

- create an `A` alias record to the ALB

### 5. Post-cutover hardening

After the hostname is serving traffic successfully:

1. Remove public `80` access to the EC2 instance from `0.0.0.0/0`.
2. Allow inbound `80` only from the ALB security group.
3. Decide whether `8081` should remain public. Long term, it should move behind its own hostname and TLS path or become private-only.
4. Update app docs and operator runbooks to use `https://operator.epicglobalinc.com/` as the primary URL.

## Fast fallback option

If the ALB path is temporarily blocked, the fastest short-term fallback is:

1. point `operator.epicglobalinc.com` directly at `184.32.65.221`
2. terminate TLS on the instance with Caddy or Nginx plus Let's Encrypt

This is faster, but it is not the preferred long-term shape for Operator in Epic AWS.

## Manual items still required

- Access to the authoritative DNS zone for `epicglobalinc.com`
- Certificate DNS validation records
- ALB creation
- Security-group tightening after successful cutover
- Optional follow-up hostname for DAM, for example `dam.operator.epicglobalinc.com`
