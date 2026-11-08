// Read-only: creates only a private local report. Never registers providers or creates Azure resources.
import { mkdir, writeFile } from 'node:fs/promises';
import { arm, allArm, retail, checkSubscription } from './azure-common.mjs';
try {
  const subscriptionId = process.argv[2];
  if (!/^[0-9a-f-]{36}$/i.test(subscriptionId || '')) throw new Error('Usage: node scripts/azure-preflight.mjs SUBSCRIPTION_UUID');
  const base = `/subscriptions/${subscriptionId}`;
  const subscription = await arm(`${base}?api-version=2022-12-01`);
  checkSubscription(subscription);
  const [skus, locations, policies] = await Promise.all([
    Promise.all(['canadacentral','eastus'].map(region=>allArm(`${base}/providers/Microsoft.Compute/skus?api-version=2021-07-01&$filter=${encodeURIComponent("location eq '"+region+"'")}`))).then(results=>results.flat()),
    allArm(`${base}/locations?api-version=2022-12-01`),
    allArm(`${base}/providers/Microsoft.Authorization/policyAssignments?api-version=2022-06-01`)
  ]);
  console.log('Read spending limit, regional SKU availability and policy assignments.');
  const candidates = [];
  const ancillaryRetailPrices = {};
  for (const region of ['canadacentral', 'eastus']) {
    console.log('Reading '+region+' disk, IP and bandwidth prices.');
    ancillaryRetailPrices[region] = {
      disk: await retail(`serviceName eq 'Storage' and armRegionName eq '${region}' and productName eq 'Standard SSD Managed Disks' and priceType eq 'Consumption'`),
      ip: await retail(`serviceName eq 'Virtual Network' and armRegionName eq '${region}' and productName eq 'IP Addresses' and priceType eq 'Consumption'`),
      bandwidth: await retail(`serviceName eq 'Bandwidth' and armRegionName eq '${region}' and priceType eq 'Consumption'`)
    };
  }
  for (const size of ['Standard_B1s', 'Standard_B2ats_v2']) for (const region of ['canadacentral', 'eastus']) {
    const sku = skus.find(s => s.resourceType === 'virtualMachines' && s.name === size && s.locations?.some(location => location.toLowerCase() === region));
    const caps = Object.fromEntries((sku?.capabilities || []).map(c => [c.name, c.value]));
    const restrictions = (sku?.restrictions || []).filter(r => r.type === 'Location' && (!r.values?.length || r.values.some(location => location.toLowerCase() === region)));
    const usages = await allArm(`${base}/providers/Microsoft.Compute/locations/${region}/usages?api-version=2023-07-01`);
    const requiredVcpus = Number(caps.vCPUs);
    const quota = usages.filter(u => ['cores', sku?.family?.toLowerCase()].includes(u.name?.value?.toLowerCase()));
    const quotaOk = quota.length === 2 && quota.every(u => u.limit - u.currentValue >= requiredVcpus);
    const priceItems = await retail(`serviceName eq 'Virtual Machines' and armRegionName eq '${region}' and armSkuName eq '${size}' and priceType eq 'Consumption'`);
    const linuxOnDemand = priceItems.filter(p => p.isPrimaryMeterRegion && p.unitOfMeasure === '1 Hour' && /^Virtual Machines /i.test(p.productName) && !/windows|spot|low priority/i.test(`${p.productName} ${p.skuName} ${p.meterName}`));
    candidates.push({ region, size, family: sku?.family, architecture: caps.CpuArchitectureType, requiredVcpus, restrictions, quota, quotaOk,
      platformAvailable: Boolean(sku && caps.CpuArchitectureType === 'x64' && !restrictions.length && quotaOk && locations.some(l => l.name.toLowerCase() === region)),
      linuxHourlyPriceCandidates: linuxOnDemand.map(p => ({ meterId: p.meterId, productName: p.productName, meterName: p.meterName, unitOfMeasure: p.unitOfMeasure, retailPrice: p.retailPrice, currencyCode: p.currencyCode })) });
  }
  await mkdir('.local', { recursive: true });
  const report = { generatedAt: new Date().toISOString(), subscriptionId, subscriptionName: subscription.displayName, spendingLimit: subscription.subscriptionPolicies.spendingLimit,
    policyAssignments: policies.map(p => ({ id: p.id, parameters: p.properties?.parameters, policyDefinitionId: p.properties?.policyDefinitionId })), candidates, ancillaryRetailPrices,
    decision: 'BLOCKED_PENDING_PRIVATE_VERIFICATION',
    reason: 'Portal verification is required for Students offer, remaining credit/expiry, effective allowed regions (including inherited policy), free compute eligibility, and all-in disk/IP/egress costs. Retail compute prices alone do not authorize deployment.' };
  await writeFile('.local/azure-preflight.json', JSON.stringify(report, null, 2));
  console.log('Saved private .local/azure-preflight.json. Deployment remains blocked until the cost approval report is verified.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
