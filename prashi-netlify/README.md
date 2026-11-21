# Prashi Tutorial for Netlify

The frontend is static HTML, CSS and JavaScript in `site/`. Netlify Functions provide the backend. MongoDB Atlas stores accounts, portal records, exams, and uploaded study material.

## Local preview

From this directory, use Node.js 24.

```sh
npm ci
npm test
node --env-file=.env scripts/dev.mjs
```

Create a local `.env` file with `MONGODB_URI` and `MONGODB_DB`. The local preview listens on `http://127.0.0.1:8130`. Use a dedicated Atlas test database when testing writes.

## Netlify configuration

Use `prashi-netlify` as the base directory if the project is deployed from the parent repository. The included `netlify.toml` selects the Node.js runtime, publish directory and functions directory. Set `MONGODB_URI` and `MONGODB_DB` in Netlify's environment settings for Functions. Use Node.js 24 for the Functions runtime. Create the portal indexes before deployment with `node --env-file=.env scripts/prepare-atlas.mjs`. The existing Prashi Atlas database already contains the indexes created for the imported legacy collections. Keep the local environment file out of the deploy source and publish directory.

For password recovery, configure `RESEND_API_KEY`, `MAIL_FROM` (an approved sender) and an HTTPS `SITE_URL` in Netlify's Functions environment. The link expires after one hour and can be used once. Use a test account to confirm delivery before launch.

If you have the legacy app in a sibling `prashi-tutorial-py` directory, copy its file attachments into Atlas with `node --env-file=.env scripts/migrate-uploads.mjs --apply`. Omit `--apply` to check referenced files first. The tool verifies each file's checksum.

Question imports use text PDFs or Word `.docx` files. Question documents and private material can be up to 3 MiB. Private material is served by an authenticated API route with class-based access.

## Cutover status

The JavaScript build includes student and staff login, password recovery, account management and CSV student import, question uploads and batch publishing, timed exams and alerts, private materials, tutorial records and Excel marksheets, enrollments, attendance and receipts, student doubts, public pages, enquiry forms, the inbox, site content editing, and admin exports.

To create an offline Atlas backup, run `node --env-file=.env scripts/backup.mjs /path/to/new-backup-directory`. The BSON Extended JSON snapshot includes files and account password hashes. Store it in a protected location. The downloadable admin data exports omit password hashes and recovery tokens.

The legacy Flask site still runs separately. Before making the Netlify build public, review the imported public content, confirm the final Atlas data is current, configure deployment secrets, verify the deployment, and validate workflows that differ from the Flask version.

## Health and HTTP status

Use `GET /healthz` to confirm the JavaScript service can respond and `GET /readyz` to verify the Atlas connection. The readiness endpoint pings MongoDB and returns HTTP 503 during a database outage. API failures have a stable error code and an `X-Request-ID` for matching server logs. Missing course and resource pages return HTTP 404 with the site's error layout.
