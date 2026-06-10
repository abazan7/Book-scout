# eBay Book Scanner

A small prototype for scanning a book ISBN/UPC barcode and estimating eBay sell-through for new and used copies.

The scanner is iPhone-ready: it uses the browser's native barcode detector when available and falls back to ZXing for iOS Safari.

## Run

```bash
npm start
```

Then open `http://localhost:4173`.

To use it from an iPhone on the same Wi-Fi network:

```bash
HOST=0.0.0.0 node server.js
```

Find your Mac's local IP address, then open `http://YOUR_MAC_IP:4173` on the iPhone.

For everyday iPhone use without your computer, deploy the app. See `DEPLOYMENT.md`.

## Live eBay setup

Set these environment variables before starting the app:

```bash
export EBAY_CLIENT_ID="your-app-id"
export EBAY_CLIENT_SECRET="your-cert-id"
export EBAY_MARKETPLACE_ID="EBAY_US"
npm start
```

Active listings use eBay Browse API search by `gtin`.

Sold listings use eBay Marketplace Insights `item_sales/search`. eBay marks this API as limited release, so your developer account must be approved for it. Without credentials, the app runs in demo mode so the UI and scanner can still be tested.

## Notes

- Sell-through rate is calculated as `sold listings / active listings`.
- Sold price averages are calculated from the returned sold-listing sample.
- Used books include eBay condition IDs for Like New, Very Good, Good, Acceptable, and Used.
- New books include eBay condition IDs for New and related new states.
