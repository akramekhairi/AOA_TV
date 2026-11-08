// Defaults to local checks. ARM validation and deployment require explicit flags.
import { readFile } from 'node:fs/promises';
import { arm, readJson, checkSubscription } from './azure-common.mjs';
try {
  const mode = process.argv[2] || '--check';
  if (!['--check', '--validate', '--deploy'].includes(mode)) throw new Error('Usage: node scripts/azure-deploy.mjs [--check|--validate|--deploy]');
  const approval = await readJson('.local/azure-approval.json');
  const preflight = await readJson('.local/azure-preflight.json');
  const template = await readJson('infra/azure/main.json');
  const fail = message => { throw new Error(message); };
  const recent = value => Number.isFinite(Date.parse(value)) && Date.now() - Date.parse(value) >= 0 && Date.now() - Date.parse(value) < 24 * 3600000;
  if (!recent(approval.verifiedAt) || !recent(preflight.generatedAt)) fail('Approval and preflight must be less than 24 hours old.');
  if (!approval.verifiedBy || !approval.studentsOfferVerified || !approval.effectiveRegionPolicyVerified || !approval.spendingLimitOnVerified || !approval.approvedForDeployment) fail('Private approval report is incomplete. Verify account and costs before approval.');
  if (approval.subscriptionId !== preflight.subscriptionId || !/^[0-9a-f-]{36}$/i.test(approval.subscriptionId)) fail('Subscription mismatch.');
  const candidate = preflight.candidates.find(c => c.region === approval.region && c.size === approval.vmSize && c.platformAvailable);
  if (!candidate) fail('Selected x86 VM has no verified available SKU/quota in the preflight.');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(approval.resourceGroup || '') || !/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(approval.dnsLabel || '')) fail('Invalid resource group or DNS label.');
  const cidr = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/32$/.exec(approval.sshSourceCidr || '');
  if (!cidr || cidr.slice(1).some(o => Number(o) > 255) || ['0', '127'].includes(cidr[1])) fail('Restrict SSH to your current public IPv4 /32.');
  const numeric = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const keys = ['compute', 'diskStorageAndTransactions', 'publicIpv4', 'bandwidthEgress', 'other'];
  if (!keys.every(k => numeric(approval.costUsd?.[k]) && typeof approval.priceEvidence?.[k] === 'string' && approval.priceEvidence[k].length > 20)) fail('Every all-in cost component needs a verified numeric estimate and evidence.');
  if (!numeric(approval.projectedDays) || approval.projectedDays < 330 || !approval.firstYearCostVerified || !numeric(approval.remainingCreditUsd) || !numeric(approval.reserveUsd) || approval.reserveUsd < approval.remainingCreditUsd * 0.2 || !numeric(approval.otherSubscriptionSpendUsd) || !numeric(approval.maxApprovedCostUsd)) fail('Verify remaining-first-year costs over at least 330 days, available credit, other spend, and a reserve of at least 20% of remaining credit.');
  if (Date.parse(approval.creditExpiresAt) < Date.now() + approval.projectedDays * 86400000 || !Number.isFinite(Date.parse(approval.creditExpiresAt))) fail('Credit expires before the projected operating period.');
  const remainingFirstYearDays = Math.floor((Date.parse(approval.creditExpiresAt) - Date.now()) / 86400000);
  if (approval.projectedDays < remainingFirstYearDays) fail('Projection must cover all remaining whole days before the verified first-year credit expiry.');
  const total = keys.reduce((sum, k) => sum + approval.costUsd[k], 0);
  if (total <= 0 || total > approval.maxApprovedCostUsd || total + approval.otherSubscriptionSpendUsd + approval.reserveUsd > approval.remainingCreditUsd) fail('Projected all-in cost exceeds the approved cap or available credit after reserve.');
  if (candidate.linuxHourlyPriceCandidates.length !== 1) fail('Ambiguous Linux retail compute meter; investigate before deploying.');
  const retailCompute = candidate.linuxHourlyPriceCandidates[0].retailPrice * 24 * approval.projectedDays;
  if (approval.costUsd.compute < retailCompute && (!approval.freeComputeAllowanceVerified || typeof approval.freeComputeEvidence !== 'string' || approval.freeComputeEvidence.length < 80 || approval.freeComputeEvidence.startsWith('If verified:'))) fail('Below-retail compute requires account-specific eligible SKU, remaining hours, benefit dates, and first-year charged-hours evidence.');
  if(approval.costUsd.diskStorageAndTransactions===0&&(!approval.freeDiskAllowanceVerified||typeof approval.freeDiskEvidence!=='string'||approval.freeDiskEvidence.length<80))fail('Zero disk cost requires verified account-specific P6 allowance covering the first-year horizon.');
  const sshPublicKey = (await readFile(approval.sshPublicKeyPath, 'utf8')).trim();
  if (!/^(ssh-ed25519|ssh-rsa) [A-Za-z0-9+/=]+(?: .*)?$/.test(sshPublicKey)) fail('Expected an OpenSSH public key; never supply a private key.');
  const parameters = Object.fromEntries(Object.entries({ location: approval.region, vmSize: approval.vmSize, sshPublicKey, sshSourceCidr: approval.sshSourceCidr, dnsLabel: approval.dnsLabel }).map(([k, value]) => [k, { value }]));
  const deployment = { properties: { mode: 'Incremental', template, parameters } };
  console.log(`Private gate passed: ${approval.region}/${approval.vmSize}; estimated USD ${total.toFixed(2)} over ${approval.projectedDays} days.`);
  if (mode !== '--check') {
    const base = `/subscriptions/${approval.subscriptionId}`;
    checkSubscription(await arm(`${base}?api-version=2022-12-01`));
    const groupPath = `${base}/resourcegroups/${approval.resourceGroup}?api-version=2022-09-01`;
    let group;
    try { group = await arm(groupPath); } catch (error) { if (!error.message.startsWith('ARM 404:')) throw error; }
    if (group && group.tags?.managedBy !== 'aoa-tv-students') fail('Existing resource group is not owned by this deployment.');
    if (!group && mode === '--validate') fail('ARM validation requires the dedicated resource group; --deploy creates it only after all private gates pass.');
    if (!group) await arm(groupPath, 'PUT', { location: approval.region, tags: { managedBy: 'aoa-tv-students' } });
    const path = `${base}/resourcegroups/${approval.resourceGroup}/providers/Microsoft.Resources/deployments/aoa-tv`;
    await arm(`${path}/validate?api-version=2022-09-01`, 'POST', deployment);
    if (mode === '--deploy') {
      await arm(`${path}?api-version=2022-09-01`, 'PUT', deployment);
      console.log('Deployment submitted. Inspect Azure deployment status privately before SSH setup.');
    } else console.log('ARM validation accepted. No VM deployment submitted.');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
