# ForemanHQ DNS delegation

Registration/renewal stays at Namecheap. Terraform manages the new Route 53
public zone `Z06815084GXA3PEQM2IP` through the existing ForemanHQ state.

The zone preserves the current Vercel production website. It does not cut the
production application over to AWS. The `aws` preview points to the dedicated
EC2 Elastic IP. Source inventory was fetched from Vercel on 2026-11-02: 11 records,
no further page, no MX/TXT records at the apex, and DNSSEC disabled/no parent DS.
Three separate source CAA records are combined into one Route 53 record set.

Vercel's external ALIAS records cannot be copied literally: apex uses the domain
configuration API's rank-1 recommended A records (216.198.79.1 and 64.29.17.1),
and wildcard becomes a CNAME to the same source target. Both apex IPs were tested
with HTTPS SNI and preserved the redirect to https://www.foremanhq.ca/.
The five Clerk authentication/mail CNAMEs are preserved exactly.

## Verify before changing delegation

From the repository root:

```sh
node infra/aws/verify-dns.mjs \
  ns-1036.awsdns-01.org ns-1815.awsdns-34.co.uk \
  ns-792.awsdns-35.net ns-32.awsdns-04.com
```

This queries each authoritative nameserver directly, including wildcard
resolution for www, rather than relying on the still-active Vercel delegation.

## Namecheap handoff

Domain List → Manage foremanhq.ca → Nameservers → Custom DNS.
Replace both Vercel nameservers with these four and save:

```text
ns-1036.awsdns-01.org
ns-1815.awsdns-34.co.uk
ns-792.awsdns-35.net
ns-32.awsdns-04.com
```

Keep the Vercel zone and project active during propagation (allow 24–48 hours).
Verify parent delegation, public DNS, website redirect, www HTTPS, Clerk login,
and aws preview before declaring the DNS migration complete. If recovery is
needed, restore ns1.vercel-dns.com and ns2.vercel-dns.com at Namecheap; cached
answers mean rollback is not instant. Do not use the helloanyworld.click zone.

Future DNS edits go in dns.tf, followed by a reviewed Terraform plan/apply.
Production app cutover is a separate change after CI/CD and app acceptance pass.
Route 53 adds $0.50/month for the hosted zone plus standard DNS query charges.
