// Verify each new authoritative server before changing Namecheap delegation.
// Usage: node infra/aws/verify-dns.mjs ns-1.example.net ns-2.example.org ...
import { Resolver, resolve4 } from 'node:dns/promises';
import assert from 'node:assert/strict';
const vercel = process.argv.includes('--vercel');
const servers = process.argv.slice(2).filter(arg => arg !== '--vercel');
assert.equal(servers.length, 4, 'Supply the four nameservers from terraform output dns_nameservers');
const cnames = {
  '*': 'cname.vercel-dns-017.com',
  clerk: 'frontend-api.clerk.services',
  accounts: 'accounts.clerk.services',
  clkmail: 'mail.jnuxxmp50vwt.clerk.services',
  'clk._domainkey': 'dkim1.jnuxxmp50vwt.clerk.services',
  'clk2._domainkey': 'dkim2.jnuxxmp50vwt.clerk.services',
};
const normalize = values => values.map(s => s.replace(/\.$/, '').toLowerCase()).sort();
for (const server of servers) {
  const resolver = new Resolver({timeout: 5000, tries: 2});
  resolver.setServers([ (await resolve4(server))[0] ]);
  assert.deepEqual(normalize(await resolver.resolveNs('foremanhq.ca')), normalize(servers));
  assert.deepEqual((await resolver.resolve4('foremanhq.ca')).sort(), (vercel ? ['216.198.79.1', '64.29.17.1'] : ['3.150.51.3']).sort());
  assert.deepEqual(await resolver.resolve4('aws.foremanhq.ca'), ['3.150.51.3']);
  for (const [name, value] of Object.entries(cnames)) {
    assert.deepEqual(normalize(await resolver.resolveCname(`${name}.foremanhq.ca`)), [value]);
  }
  if (vercel) assert.deepEqual(normalize(await resolver.resolveCname('www.foremanhq.ca')), [cnames['*']]);
  else assert.deepEqual(await resolver.resolve4('www.foremanhq.ca'), ['3.150.51.3']);
  const caa = await resolver.resolveCaa('foremanhq.ca');
  assert.equal(caa.length, 3);
  assert.ok(caa.every(r => r.critical === 0));
  assert.deepEqual(caa.map(r => r.issue).sort(), ['letsencrypt.org', 'pki.goog', 'sectigo.com']);
  console.log(`${server}: NS, production, preview, wildcard/www, Clerk and CAA passed`);
}
