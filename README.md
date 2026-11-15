# HaqPay

**HaqPay helps small suppliers keep track of unpaid invoices, review bill details extracted with AI, see overdue receivables, and prepare customer follow-ups.** This repository contains a browser-based frontend and a FastAPI backend MVP.

> **Prototype notice:** This is a hackathon/demo project, not a production accounting or legal service. Interest figures are illustrative. Verify invoice data, legal eligibility, calculations, and message wording before relying on or sending them.

## What it can do

- Scan a JPG, PNG, or PDF invoice through the backend's Gemini-powered extraction endpoint. Extracted fields are returned as a draft for the supplier to review; OCR does not save the invoice automatically.
- Track invoice amounts, due dates, late days, and illustrative interest in a dashboard.
- Keep separate demo accounts and invoice workspaces in the current browser.
- Show a cash-alert graph based on invoice receivables and due dates.
- Prepare a friendly reminder or legal-notice draft and open WhatsApp with the message filled in.
- Provide backend API routes for customers, invoices, manual payment records, customer scores, cash profiles/forecasts, buyer links, disputes, and audit events.

Some backend routes are API capabilities and are not yet connected to complete frontend workflows. See [Current limitations](#current-limitations).

## Technology stack

- **Frontend:** HTML, CSS, and plain JavaScript (no frontend build framework required).
- **Browser routing and charts:** URL hash navigation and JavaScript-rendered SVG.
- **Demo account storage:** `localStorage` for browser-local accounts and invoice workspaces; `sessionStorage` for the active tab session; Web Crypto PBKDF2/SHA-256 password hashing.
- **Backend:** Python, FastAPI, and Uvicorn.
- **Validation and configuration:** Pydantic and Pydantic Settings.
- **Database:** SQLAlchemy ORM; SQLite by default, with PostgreSQL support through `DATABASE_URL`.
- **Migrations:** Alembic.
- **Invoice extraction:** Google Gemini via the Google GenAI Python SDK.

## Repository layout

```text
HaqPay/
├── Frontend/
│   ├── index.html
│   ├── app.js
│   ├── auth.js
│   ├── styles.css
│   └── assets/
└── backend/
    ├── app/
    │   ├── models/
    │   ├── routers/
    │   ├── schemas/
    │   └── services/
    ├── migrations/
    ├── .env.example
    ├── alembic.ini
    └── requirements.txt
```

## Run locally on Windows

You need Python installed and VS Code. The frontend is static, so it does not need `npm` or a JavaScript package installation.

### 1. Configure and start the backend

Open a PowerShell terminal in the `HaqPay` repository folder, then run:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Edit `backend/.env` and set your Gemini key:

```dotenv
GEMINI_API_KEY=your_gemini_api_key
```

For local SQLite, set:

```dotenv
DATABASE_URL=sqlite:///./haqpay.db
```

The app can use SQLite locally. To use PostgreSQL instead, set `DATABASE_URL` to your own PostgreSQL connection string and make sure that database is running.

Run the database migration and start the API:

```powershell
python -m alembic upgrade head
python -m uvicorn app.main:app --reload
```

Keep this terminal open while using the frontend. The API should be available at [http://127.0.0.1:8000](http://127.0.0.1:8000). Open [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) for interactive API documentation and [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health) to check whether it is running.

> If PowerShell or an application-control policy blocks `alembic.exe` or `uvicorn.exe`, use the `python -m ...` commands above; they run the tools through Python.

### 2. Start the frontend

Open a **second** VS Code terminal:

```powershell
cd Frontend
```

Open `index.html` in VS Code and start the **Live Server** extension with **Go Live**. Use the local `http://127.0.0.1:...` address it opens. Do not open the page as a `file://` URL; browser security features used by the demo login require a local web address.

The frontend currently points to `http://127.0.0.1:8000/api/v1` in `Frontend/app.js`. If the backend runs on a different address or port, update `API_BASE` there.

## Typical data flow

1. The browser uploads the selected bill to `POST /api/v1/scan/extract`.
2. FastAPI checks the file type and size, then asks Gemini to extract invoice fields.
3. The backend returns a structured draft. The user reviews it and chooses whether to add it.
4. With a signed-in **local demo account**, the invoice is saved in that account's browser workspace. In the no-local-account API demo path, the frontend creates a customer and invoice through the backend.
5. Dashboard figures and the current cash-alert graph are rendered from the available invoice data.

The API stores monetary values as **integer paise**; the frontend displays rupees. API dates use ISO format (`YYYY-MM-DD`).

## Main backend endpoints

All application routes use the `/api/v1` prefix.

| Endpoint | Purpose |
| --- | --- |
| `POST /scan/extract` | Extract invoice fields into a review draft using Gemini |
| `POST`, `GET /customers` | Create and list customers |
| `POST /invoices` | Create a confirmed invoice |
| `GET /invoices/{invoice_id}` | Read invoice details and illustrative interest |
| `POST /invoices/{invoice_id}/payments` | Record a manual payment |
| `GET /dashboard` | Return dashboard totals and invoice rows |
| `GET /customer-scores` | Return customer payment-delay summaries |
| `PUT /cash-profile`, `POST /cash-alert` | Save cash assumptions and calculate a backend forecast |
| `POST /invoices/{invoice_id}/disputes` | Open a dispute |
| `POST /invoices/{invoice_id}/buyer-link` | Create a buyer access link |
| `GET /buyer/{token}` and buyer actions | View, accept, or dispute an invoice through a buyer link |
| `GET /health` | Check API status |

The frontend's current cash graph is a receivables forecast from invoice amounts and due dates. It does **not** call the separate backend cash-profile forecast endpoint.

## Current limitations

- **Demo authentication only:** Usernames/accounts and invoice workspaces are stored in the browser. The active session lasts until that browser tab is closed. Accounts do not sync across devices and are not verified by the backend.
- **Development supplier identity:** API requests currently use a shared `X-Supplier-Id` development header. This is not authentication or production-safe tenant isolation. Do not expose the API publicly with this setup.
- **WhatsApp:** The frontend opens WhatsApp with a prefilled draft; it does not send messages automatically. The backend messaging adapter is a stub.
- **Payments:** The backend can record a manual payment, but online UPI checkout, a payment provider, and payment webhooks are not integrated.
- **Other production work:** OTP/real server authentication, private file storage, automated reminders, PDF reports, deployment hardening, and full frontend integration of several backend routes remain future work.
- **Interest and eligibility:** Interest calculations are illustrative, and supplier eligibility is not independently verified. Get qualified legal/accounting review before relying on these figures or sending legal notices.


