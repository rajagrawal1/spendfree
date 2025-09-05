# SpendFree — Offline-first Personal Budgeting (Web)

A beautiful, minimalist, **offline** web app to plan income, outflows, and contingency buffers—designed for phones *and* desktops.
No server. No sign-up. Your data (and documents) live **locally** in your browser.

---

## Highlights

* **Simple, elegant UI** with light/dark mode
* **Incomes, Outflows, Contingencies** (recurring + one-time windows)
* **Sources** (user-defined) linked to Incomes, Outflows, and Contingencies
* **Attachments** column shows attachment status for sources
* **Attachments** per entry (image, text, PDF, and document files)

  * Add multiple files, remove before saving (chips with ×)
  * View: pick which attachment to open
  * Edit: delete any attachment (with confirm)
* **Charts**: Income (blue), Outflows (red), Contingency (yellow), Safe-to-Spend (green)

  * Renders with **Chart.js** if present, otherwise a **canvas fallback**
* **Full JSON backup/restore** (entire dataset **including attachments & notes**)
* **Offline-first** (PWA) when hosted on HTTPS or localhost

---

## Project Structure

```
.
├─ index.html          # App shell & UI
├─ styles.css          # Tailwind-esque utility CSS + custom styles
├─ app.js              # All logic (state, UI, charts, IndexedDB, Drive)
├─ manifest.webmanifest
├─ service-worker.js   # Offline caching (on HTTPS or localhost)
├─ vendor/             # Optional local libs (Chart.js)
│  ├─ chart.umd.min.js
│  └─ README.txt
└─ icons/
   ├─ icon-192.png
   └─ icon-512.png
```

---

## Data Model

All state lives in `localStorage` (structured store) + attachments in **IndexedDB**:

### Entities

* **Source**
  `{ id, name, type, note }`
* **Income**
  `{ id, title, amount, sourceId, recurrence, startMonth, durationMonths, docLink, note }`
* **Outflow**
  `{ id, title, amount, sourceId?, recurrence, startMonth, durationMonths, docLink, note }`
* **Contingency**
  `{ id, title, amount, sourceId?, recurrence, startMonth, durationMonths, docLink, note }`

  > Use amount as percentage (≤ 1.0) or fixed amount (≥ 1.0) depending on your setup.
* **Attachment (IndexedDB ‘files’ store)**
  `{ id, entryId, name, type, data(ArrayBuffer) }`

### Recurrence

* `Monthly`, `Bi-Weekly`, `Weekly`, `Daily`, `One-Time` (+ one-time window fields)
* **One-Time** requires: `startMonth` (YYYY-MM) and `durationMonths` (≥ 1)

### Sources Linkage

* **Income** uses **Source** (required)
* **Outflow** and **Contingency**: optional **Source** link
* On first run after the update, a **migration** creates/link Sources as needed and cleans up deprecated fields.

---

## Attachments

* Allowed: **images**, **PDF**, **text**, **documents**

  * MIME: `image/*`, `application/pdf`, `text/*`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
  * Extensions supported include: `.png .jpg .jpeg .gif .webp .svg .heic .heif .bmp .pdf .txt .md .markdown .csv .log .json .rtf .doc .docx .tiff`
* Add multiple files, remove before saving (chip ×)
* **View** → documents chooser to open selected file
* **Edit** → see existing list with **Delete** buttons (with confirmation)

---

## Import / Export (JSON)

* **Export Data**: One JSON “snapshot” of everything:

  ```json
  {
    "settings": {...},
    "incomes": [...],
    "outflows": [...],
    "contingencies": [...],
    "sources": [...],
    "attachments": [
      {"id":"...","entryId":"...","name":"...","type":"...","dataB64":"<base64>"}
    ]
  }
  ```
* **Import Data**: Restores all entries **and** rehydrates attachments into IndexedDB.
* Backward compatible with older snapshots (pre-source linkage). The migration will create/link Sources as needed.

> Tip: JSON files with attachments can be large. For a quick lightweight backup, you can optionally exclude attachments by exporting before adding large files (or we can add an “Exclude attachments” toggle if you want that UI).

---

## Charts

* If `/vendor/chart.umd.min.js` is present → **Chart.js** bar chart (recommended)
* Otherwise → **canvas fallback** renders automatically
* Colors are locked:

  * **Income**: blue `#3b82f6`
  * **Outflows**: red `#ef4444`
  * **Contingency**: yellow `#f59e0b`
  * **Safe-to-Spend**: green `#22c55e`

---

## Running Locally

### Fastest (no server)

* Open `index.html` directly (file://).
* Works fully except PWA install (service worker is disabled on `file://` by design).

### Recommended (localhost)

Run a tiny static server so PWA/Cache work:

* **Python**

  ```bash
  python3 -m http.server 8080
  ```

  Open: [http://localhost:8080](http://localhost:8080)

* **Node**

  ```bash
  npx http-server -p 8080
  ```

### Optional: Add Chart.js locally

Place **Chart.js UMD** here:

```
/vendor/chart.umd.min.js
```

> The app gracefully falls back if it’s missing, but charts look nicer with Chart.js.

---

## Deploying on GitHub Pages

1. Create a repo and add all files.
2. Push `main`.
3. In **Settings → Pages**, choose **Deploy from branch** → `main` → `/ (root)`
4. Visit your Pages URL. The service worker will enable offline caching.

---

---

## Keyboard & UX Tips

* **Tab** between inputs; **Enter** to submit forms
* **Attach files**: click 📎, then use the chip **×** to unselect before saving
* **View** vs **Edit**

  * View = read-only + choose which doc to open
  * Edit = full form + delete docs with confirmation

---

## Troubleshooting

**Nothing clicks / tabs don’t switch**

* Likely a syntax error blocked `app.js`. Open DevTools → Console, copy the first error line and fix.
* Using these builds, you should not see any of the earlier issues:

  * `expected expression, got '}'` / `got ','` — fixed
  * `await is only valid in async functions` — fixed
  * `redeclaration of let ...` — fixed

**Service Worker error on file://**

* Expected: browsers allow SW only on **HTTPS** or **localhost**.
* Host locally via `http-server` or deploy to Pages.

**CDN/CORS/MIME issues**

* We removed third-party CDNs. If you want full Chart.js, **vendor it locally** in `/vendor`.

**IndexedDB “transaction not active”**

* Fixed by pre-reading files before starting a write transaction.

**Attachments won’t import**

* Ensure your JSON includes `"attachments":[...]` and that files aren’t stripped by your OS or tools.

---

## Privacy

* All data stays in your browser (localStorage + IndexedDB).
* Nothing is sent anywhere.
* You can **Export Data** anytime and store securely.

---

## Accessibility

* Keyboard navigable forms and buttons
* Clear color contrast in both light and dark themes
* Minimal motion; no flashing

---

## Roadmap (optional ideas)

* Toggle to **exclude attachments** in Export
* Inline **image thumbnails** in tables (collapsed row)
* Per-source reporting & breakdown charts
* Quick “clone entry” and “apply window to range” helpers

---

## License

MIT — do what you like, just don’t hold the authors liable.

---

## Credits

Crafted for a fast, reliable, **offline-first** budgeting flow with clean UX and strong data control. If you hit an edge case, open the console, copy the first error line, and report it — I’ll help you resolve it quickly.

