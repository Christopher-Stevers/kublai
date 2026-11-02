# DNS migration only: production continues serving from Vercel until app cutover.
# Source: Vercel domain configuration/complete record inventory, 2026-11-02.
resource "aws_route53_zone" "app" {
  name    = "foremanhq.ca"
  comment = "ForemanHQ DNS; registration remains at Namecheap"
  lifecycle { prevent_destroy = true }
}
resource "aws_route53_record" "production" {
  zone_id = aws_route53_zone.app.zone_id
  name    = "foremanhq.ca"
  type    = "A"
  ttl     = 300
  # Vercel's rank-1 recommendedIPv4 for this domain; external ALIAS is unsupported.
  records = ["216.198.79.1", "64.29.17.1"]
}
resource "aws_route53_record" "wildcard" {
  zone_id = aws_route53_zone.app.zone_id
  name    = "*.foremanhq.ca"
  type    = "CNAME"
  ttl     = 300
  records = ["cname.vercel-dns-017.com."]
}
resource "aws_route53_record" "clerk" {
  for_each = {
    "clerk"           = "frontend-api.clerk.services."
    "accounts"        = "accounts.clerk.services."
    "clkmail"         = "mail.jnuxxmp50vwt.clerk.services."
    "clk._domainkey"  = "dkim1.jnuxxmp50vwt.clerk.services."
    "clk2._domainkey" = "dkim2.jnuxxmp50vwt.clerk.services."
  }
  zone_id = aws_route53_zone.app.zone_id
  name    = "${each.key}.foremanhq.ca"
  type    = "CNAME"
  ttl     = 300
  records = [each.value]
}
resource "aws_route53_record" "certificate_authorities" {
  zone_id = aws_route53_zone.app.zone_id
  name    = "foremanhq.ca"
  type    = "CAA"
  ttl     = 300
  records = ["0 issue \"pki.goog\"", "0 issue \"sectigo.com\"", "0 issue \"letsencrypt.org\""]
}
resource "aws_route53_record" "preview" {
  zone_id = aws_route53_zone.app.zone_id
  name    = "aws.foremanhq.ca"
  type    = "A"
  ttl     = 300
  records = [aws_eip.web.public_ip]
}
output "dns_nameservers" {
  description = "Set these four Custom DNS nameservers at Namecheap after verifying the zone."
  value       = aws_route53_zone.app.name_servers
}
output "dns_zone_id" { value = aws_route53_zone.app.zone_id }
