import { readFile } from 'node:fs/promises';
export async function readJson(path) { return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/,'')); }
export async function arm(path, method = 'GET', body) {
  const auth = process.env.AZURE_ACCESS_TOKEN ? { accessToken: process.env.AZURE_ACCESS_TOKEN } : await readJson('.local/azure-auth.json');
  const expires=auth.expiresAt?Date.parse(auth.expiresAt):auth.expires_on?Number(auth.expires_on)*1000:undefined;
  if (expires && expires <= Date.now()) throw new Error('Azure authentication expired; refresh it privately.');
  const url = new URL(path, 'https://management.azure.com');
  if (url.origin !== 'https://management.azure.com') throw new Error('Unexpected ARM host');
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${auth.accessToken}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),signal:AbortSignal.timeout(45000) });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`ARM ${response.status}: ${error.error?.code || 'request failed'} (${method} ${url.pathname})`);
  }
  const text=await response.text();return text?JSON.parse(text):{};
}
export async function allArm(path) {
  const values = [];
  while (path) { const page = await arm(path); values.push(...(page.value || [])); path = page.nextLink; }
  return values;
}
export async function retail(filter) {
  let url = `https://prices.azure.com/api/retail/prices?currencyCode='USD'&$filter=${encodeURIComponent(filter)}`;
  const items = [];
  while (url) {
    if (new URL(url).origin !== 'https://prices.azure.com') throw new Error('Unexpected pricing host');
    const response = await fetch(url,{signal:AbortSignal.timeout(45000)});
    if (!response.ok) throw new Error(`Retail prices unavailable (${response.status})`);
    const page = await response.json(); items.push(...page.Items); url = page.NextPageLink;
  }
  return items;
}
export function checkSubscription(sub) {
  if (sub.state !== 'Enabled') throw new Error('Subscription must be Enabled');
  if (sub.subscriptionPolicies?.spendingLimit !== 'On') throw new Error('Spending limit is not confirmed On; stop without upgrading the subscription.');
}
