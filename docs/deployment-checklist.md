# Deployment checklist

Everything to do before real users sign in. Target setup (brief §3): web on Vercel, API on a
long-running host in Singapore (Railway, Fly.io or Render), Postgres on Neon in Singapore.

## Before the first deploy

- [ ] **Redis for auth rate limits.** Better Auth keeps limits in memory today, so a restart resets
      them and each server instance counts separately. Add a Redis (e.g. Upstash, Singapore) and
      point Better Auth's rate-limit storage at it via a `REDIS_URL` env var, using Bun's built-in
      Redis client. Keep sessions in Postgres (don't use `secondaryStorage` for sessions).
- [ ] **Client IP behind the host's proxy.** Set `CLIENT_IP_HEADER` to the header the host puts the
      real client IP in (Fly.io: `fly-client-ip`; check the host's docs), or `TRUSTED_PROXIES`.
      Without it all visitors can share one rate-limit bucket. Check the server log has no "could not
      determine a client IP" warning.
- [ ] **https URLs.** `BETTER_AUTH_URL` (API) and `WEB_URL`/`CORS_ORIGIN` (web) on https. The server
      refuses to start in production otherwise.
- [ ] **Cookies across subdomains.** Web on `app.<domain>`, API on `api.<domain>`; set
      `COOKIE_DOMAIN=<domain>`.
- [ ] **Secret.** A new `BETTER_AUTH_SECRET` (`openssl rand -base64 32`), never the dev one.
- [ ] **Email.** `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and `EMAIL_FROM` on a domain verified in
      Resend (SPF/DKIM). Send one invitation and one password reset to a real inbox.
- [ ] **File storage.** `STORAGE_DRIVER=s3` with the R2 bucket settings (`S3_*`). Upload a floor
      plan and open it: the R2 driver has only been tested against the local folder so far.
- [ ] **Migrations first.** Run `bun run db:migrate` against the production database before the new
      server version goes live (brief §3).
- [ ] **First company.** `bun run org:create --name "…" --owner-email …` on the server, then the
      owner sets a password from the email.

## After the first deploy

- [ ] Sign up via an invitation and sign in from a phone (Safari and Chrome): cookies and redirects.
- [ ] Try 6 wrong passwords in a minute: the 6th is refused (429).
- [ ] Two-step login on a real authenticator app.
- [ ] Backups: confirm Neon's point-in-time restore is enabled.
