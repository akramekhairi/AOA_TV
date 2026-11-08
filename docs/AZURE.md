# Azure for Students Docker deployment

This path uses one Linux x86 VM, Docker Compose, and Caddy. It keeps the existing Render deployment available for rollback. It does not upgrade a subscription, remove its spending limit, add a card, purchase a DNS zone, or provision a paid managed container platform. A VM, its disk, public IPv4 address, and outgoing traffic can consume student credit. No claim of zero cost is made.

Azure for Students advertises $100 credit for 12 months without a card. Confirm the actual remaining balance, expiration, and eligible free-service usage for this account in the Azure/Sponsorship portal. Renewal of student status/credit does **not** prove that a first-year VM allowance renews. Keep the spending limit **On**. If the required SKU, region, quota, or credit is unavailable, stop; do not upgrade to pay-as-you-go.

## Private preflight and approval

Use Node 22 or newer from the repository root. `.local/` is ignored by Git. Keep tokens, reports, SSH keys, and runtime environment files there. Authentication is prepared separately; none of these scripts signs you in. Store `{ "accessToken": "…", "tenantId": "…", "expiresAt": "ISO-8601 timestamp" }` in `.local/azure-auth.json`, or provide a short-lived `AZURE_ACCESS_TOKEN` environment variable. The token must target Azure Resource Manager. Never paste it into a command, issue, log, or commit.

```powershell
node scripts/azure-preflight.mjs YOUR_SUBSCRIPTION_UUID
Copy-Item infra/azure/approval.example.json .local/azure-approval.json
```

Preflight performs read-only ARM and public Retail Prices API requests. It writes `.local/azure-preflight.json` with subscription spending-limit state, quota, x86 SKU restrictions, policy assignment references, and price meter candidates. Initial targets are Canada Central/East US; the current account restricts those SKUs. The user approved North Central US B2ats_v2 after quota, policy and availability checks. Availability is a snapshot, not a capacity reservation. A listed region is not proof that effective inherited policy permits deploying there. Inspect inherited policies and their definitions in the portal before approving a region. Missing permissions or ambiguous price meters block deployment.

Complete `.local/azure-approval.json` privately with evidence from this account. Use fresh verification timestamps (under 24 hours) and project the entire remaining first year, with a minimum 330-day horizon for this newly activated account. The verified credit expiry must cover that horizon; do not shorten it to make an unaffordable monthly estimate pass. Account for all other subscription consumption and reserve at least 20% of remaining credit: with $100 available, the entire projected deployment and other subscription usage must fit within $80. Set `firstYearCostVerified` and approval only after reviewing these totals. Use the full Linux retail compute price unless account-specific evidence identifies the exact selected SKU, remaining monthly free hours, benefit start/end dates, and projected charged hours over the remaining first year. B2ats_v2 is not automatically a free replacement for B1s.

Set `projectedDays` to the remaining whole days until verified credit expiry (at least 330); include a final partial day's costs in the estimate. The gate rejects a shorter projection even when it exceeds the 330-day minimum.

The all-in estimate must include:

* Linux VM hourly price × projected running hours, less only verified allowance.
* One64GiB Premium_LRS P6 disk. The current deployment uses the account-confirmed first-year P6 allowance (one of two free64GB disks); verify it before assuming zero disk cost.
* One Standard static public IPv4 address for the whole period, including time the VM is deallocated.
* Expected catalog, image, and subtitle outbound transfer, applicable account allowances, and overage. Video streams directly from the provider rather than through this Azure app; estimate Azure bandwidth from the traffic it actually serves.
* Other subscription resources and applicable tax/currency effects.

Retail API snapshots are evidence for meter selection, not an account balance or a complete bill. If the snapshots omit a meter, verify it using the Azure calculator/current pricing page. The scripts deliberately do not guess sponsorship billing-account endpoints or remaining credit. Unknown credit, expiry, or costs means stop.

Generate an SSH key outside source control and place the public key at `.local/azure-vm.pub`. Use your current public IPv4 with `/32` for `sshSourceCidr`; never allow `0.0.0.0/0`. Select a globally available DNS label, for example `aoa-tv-unique123`. The resulting address is `LABEL.REGION.cloudapp.azure.com`; no Azure DNS zone is needed.

```powershell
node scripts/azure-deploy.mjs --check
```

This checks local files only and does not authorize deployment by itself. Review the completed report and ARM template before the explicit deployment step. Provisioning is separate from publishing an image or copying secrets.

## Build the public image

`.github/workflows/container.yml` publishes a generic Linux AMD64 server image on relevant `main` changes or manual dispatch. It uses repository package-write permission and never injects runtime environment secrets. After the first publish, open the GHCR package settings and set visibility to **Public**. GitHub does not make every newly created package public automatically. Test an anonymous pull before VM setup; do not copy a registry token to the VM.

Use `ghcr.io/OWNER/REPOSITORY:sha-FULL_COMMIT_SHA`, preferably the build's `@sha256:…` digest. A SHA-named tag identifies a build but registry tags can be overwritten; digest pinning enforces immutability. Save the previous image digest for rollback.

## Provision only after approval

```powershell
node scripts/azure-deploy.mjs --deploy
```

This rechecks the spending limit, creates a dedicated tagged resource group if absent, validates the ARM template, then submits an incremental deployment. An existing group must have `managedBy=aoa-tv-students`; its metadata location may differ from the VM region. `--validate` only validates an existing group and does not create it. Scripts do not register resource providers, change quotas, or bypass subscription policy. If validation fails after group creation, the empty group may remain; inspect it before deleting. Inspect deployment status in Azure; submission is not proof of a running VM.

The template creates Ubuntu 24.04 x86, SSH key authentication, a 32 GiB Standard SSD OS disk, Standard static IPv4 with Azure DNS label, and an NSG exposing TCP 80/443 plus TCP 22 from the approved `/32`. App port 3001 is not exposed by the NSG. Reusing the deployment is incremental, but changing a VM's identity, region, image, or disk configuration can fail or cause downtime; review such changes manually. Never repurpose the dedicated resource group for unrelated resources.

## Install and start on the VM

SSH as `aoaadmin` using the private key. On the fresh Ubuntu 24.04 VM:

```sh
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo install -d -m 700 /opt/aoa-tv
```

Use SSH/SCP to copy `infra/azure/compose.yaml`, `infra/azure/Caddyfile`, and privately prepared `deployment.env` and `app.env` into `/opt/aoa-tv`. Stage files in the SSH user's private home directory, then use `sudo install -m 600` for the environment files. Create the real files under `.local/`, using the examples only as key lists. Copy the server settings from the existing Render deployment securely. Do not copy local helper credentials such as Render tokens or Roku passwords. Set `PUBLIC_URL=https://THE_AZURE_DNS_HOSTNAME` and preserve the required Pages CORS origin. Keep existing signing/admin secrets for a migration unless you intentionally rotate them.

```sh
cd /opt/aoa-tv
sudo chmod 600 app.env deployment.env
sudo docker compose --env-file deployment.env config --quiet
sudo docker compose --env-file deployment.env pull
sudo docker compose --env-file deployment.env up -d
sudo docker compose --env-file deployment.env ps
curl --fail http://127.0.0.1:3001/health
curl --fail https://THE_AZURE_DNS_HOSTNAME/health
```

Avoid plain `docker compose config`, which expands runtime secrets into terminal output. Caddy obtains and renews a public ACME certificate automatically after DNS resolves and ports 80/443 are reachable. Its certificate state persists in Docker volumes. App port 3001 binds only to loopback; Caddy reaches it on the Compose network. Both containers restart unless explicitly stopped; Docker starts on reboot. Logs are capped at 3 × 10 MiB per container. The health check reports app failure but does not automatically restart an unhealthy process; inspect the cause and restart if needed.

Test a real authenticated session, playlist, image, and playback through HTTPS before switching Roku/provider URLs. Preserve the Render hostname and previous client configuration until migration succeeds. The template's NSG permits TCP web traffic; HTTP/3 UDP is optional and not required for HTTPS.

## Update, recovery, and credit protection

For updates, copy the current private `deployment.env` to a backup, change `APP_IMAGE` to the reviewed new digest, and run `pull` followed by `up -d`. Verify HTTPS health and playback. To roll back the container, restore the previous digest and repeat those commands. For a platform rollback, point the clients back to the existing Render HTTPS URL and verify Render's environment/CORS/signing keys before use. Do not delete the Azure VM until rollback is verified.

After a reboot, inspect `systemctl status docker` and `docker compose --env-file deployment.env ps`. If HTTPS fails, check DNS, NSG, clock, and Caddy logs. Keep Caddy volumes when recreating containers. Avoid `down -v` during routine recovery. A lost VM can be recreated from the ARM template and the private runtime configuration, but Caddy will request new certificates; repeated recreation can hit ACME rate limits.

Configure Azure Cost Management budget alerts (for example 50%, 80%, and 95% of the verified available credit), and separately set calendar reminders before credit/benefit expiry. Budget alerts are notifications, not a spending cap. Monitor remaining credit and actual VM/disk/IP/bandwidth costs frequently, especially after playback tests. Re-estimate whenever usage or free allowance changes. A spending limit can disable the service when credit runs out, so it does not guarantee uptime.

Stopping Linux inside the guest does not deallocate the VM. Use Azure **Stop (deallocate)** to stop compute billing; the disk and static IPv4 can keep accruing cost. Once data/configuration and rollback are secured, deleting the dedicated resource group removes the VM, disk, and IP. Review the group's contents before deleting it. Do not rely on student renewal to extend the VM free period, and do not remove the spending limit to keep the app running.

Official references: [Azure for Students offer](https://azure.microsoft.com/en-us/pricing/offers/ms-azr-0170p/), [Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices), [SKU availability troubleshooting](https://learn.microsoft.com/en-us/azure/azure-resource-manager/troubleshooting/error-sku-not-available), [Azure spending limit](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/spending-limit), and [Cost Management budgets](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets).

## Current deployment evidence

The user activated the student subscription on2026-11-08 with$100/$100credit and supplied the portal free-service table listing Linux B2ats_v2 750hours/month and two64GB P6 SSDs for12months. The dedicated user-created AOA_TV resource group has metadata in EastUS; the VM runs in NorthCentralUS. The inherited ABN-tag policy is DoNotEnforce; no billing number was invented.

The estimate is$43.80/year for StandardIPv4 at$.005/hour, plus$1 incidental allowance. VM hours(max744/month) and oneP6 disk fit verified first-year allowances. Forecast$44.80 leaves$55.20 of credit, exceeding the20%reserve. Credit/benefit end is conservatively recorded as2027-11-08T00:00Z from fresh activation; verify the exact sponsorship timestamp and review before that date. These first-year allowances do not automatically renew with student credit.

Public endpoint: https://aoa-tv-akramekhairi.northcentralus.cloudapp.azure.com . Runtime image is pinned to a public GHCR digest, with private settings under/opt/aoa-tv. Only ports80/443 and SSH from the configured administrative IPv4 are allowed. TRUST_PROXY=loopback,172.16.0.0/12 trusts only the local Docker proxy for client rate limits.
