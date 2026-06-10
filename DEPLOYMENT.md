# Deploy for iPhone

This app should be hosted so your iPhone can use it without your Mac running.

## What you need from eBay

In your eBay developer account, create or open an application and copy:

- Client ID / App ID
- Client Secret / Cert ID

The app uses the eBay Browse API for active listings. Sold listing data requires eBay Marketplace Insights access.

If Marketplace Insights is not available in your API Explorer list, request access from eBay Developer Support. A copy/paste template is in `EBAY_MARKETPLACE_INSIGHTS_REQUEST.md`.

## Recommended setup

Deploy this folder to a Node host such as Render, Railway, Fly.io, or a VPS.

Set these environment variables on the host:

```text
HOST=0.0.0.0
EBAY_CLIENT_ID=your_app_id
EBAY_CLIENT_SECRET=your_cert_id
EBAY_MARKETPLACE_ID=EBAY_US
EBAY_ENV=production
```

Start command:

```bash
node server.js
```

After deployment, open the HTTPS URL on your iPhone. Camera scanning in Safari requires HTTPS unless the app is running on localhost.

## Add to iPhone Home Screen

Open the deployed URL in Safari, tap Share, then tap Add to Home Screen.
