# nowtutors.com DNS snapshot, 2026-10-07 02:15 WAT (before any change)

Taken with Google DNS over HTTPS (dns.google) because plain `dig` to outside resolvers is blocked from this Mac. Registrar: Network Solutions (whois), name servers ns35/ns36.worldnic.com, so records are edited in the Network Solutions account. Domain expires 2027-04-08.

| Type | Host | Value | TTL | Belongs to |
|---|---|---|---|---|
| A | nowtutors.com | 104.16.36.105 | 3600 | Bubble (Cloudflare front) |
| A | nowtutors.com | 104.19.240.93 | 3600 | Bubble |
| A | nowtutors.com | 104.19.241.93 | 3600 | Bubble |
| A | nowtutors.com | 104.16.42.105 | 3600 | Bubble |
| A | www.nowtutors.com | same four addresses | 3600 | Bubble |
| NS | nowtutors.com | ns35.worldnic.com, ns36.worldnic.com | 7200 | registrar |

Nothing else exists: no AAAA, no MX, no TXT (no SPF, no DKIM, no DMARC), no CAA, nothing at `send`, `mail`, `_dmarc` or `resend._domainkey`. `https://nowtutors.com` answers `409 Conflict` from Cloudflare, which is what a removed Bubble site returns, so the domain is already dead to visitors.

What this means for the cutover: there is no email to protect, so the change is only the apex and `www` records, and every Resend and DMARC record is a plain add. Rollback is putting the four A records back, which brings back a 409 page, so there is nothing worth rolling back to.

## Records to add for Resend (domain added 2026-10-07, region eu-west-1, Resend account nowtutors.pays)

Resend's current record set uses CNAMEs for sending, not the old MX + SPF TXT pair.

| Type | Host | Value | Purpose |
|---|---|---|---|
| TXT | resend._domainkey | p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDXsOVeDS9hwZrm/OTdNbUM1nlf4ytPBRdZV7tAT4tP3qYeoAfepNEUxbX/YGxUMYBxliQ7jUscDwN52CTmMwnn7MijOB7mGoeyE2WobvmACZqrYyefaaYmqOBAiRMMl2qgrNxGgz5KoWeY3vIvbLa75O4oyC8E1MvOh6fx/QuyvQIDAQAB | DKIM, domain verification |
| CNAME | rsend | rsend-euw1.forge.rmta.net | sending (SPF) |
| CNAME | send | send.forge.rmta.net | sending (SPF), return-path |
| TXT | _dmarc | v=DMARC1; p=none; rua=mailto:nowtutors.pays@gmail.com | DMARC reports to the business inbox |

Not added: the receiving MX (inbound-smtp.eu-west-1.amazonaws.com). Nobody reads mail at @nowtutors.com (D9); if Noora wants hello@ later, registrar forwarding is the simpler route.

## Resend records confirmed published, 2026-10-07 04:20 WAT

All four answer from Google DNS with the exact values above (TTL 4 hours at Network Solutions). Added by Daniels in the Network Solutions account (login nowtutors.pays@gmail.com, registrant Noora Jassim).

## Records for the website cutover (Stage 7), as Vercel's Domains page lists them for project nowtutors, team nowtutors

Both domains added to the project on 2026-10-07: `nowtutors.com` on Production, `www.nowtutors.com` as a 308 redirect to the apex. Vercel shows "Invalid Configuration" for both until these records exist. Change ONLY these; the Resend and DMARC records stay.

| Action | Type | Host | Value |
|---|---|---|---|
| Delete the four existing | A | @ | 104.16.36.105, 104.16.42.105, 104.19.240.93, 104.19.241.93 |
| Add | A | @ | 216.150.1.1 |
| Delete the four existing | A | www | the same four Bubble addresses |
| Add | CNAME | www | 7b1868df3c2fd635.vercel-dns-017.com |

Vercel notes the legacy values (76.76.21.21 and cname.vercel-dns.com) still work, but the two above are what it asked for on the day.
