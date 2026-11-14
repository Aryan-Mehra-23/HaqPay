# HaqPay backend MVP

FastAPI + SQLAlchemy API and PostgreSQL-ready relational model. API amounts are integer paise. Dates are ISO dates; timestamps are UTC. GST is out of scope.

## Run locally

1. Create a virtual environment and install `requirements.txt`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to PostgreSQL (or leave unset to use local SQLite).
3. Run `alembic upgrade head`.
4. Run `uvicorn app.main:app --reload` from this directory.
5. Open `/docs` for the REST API.

The current `X-Supplier-Id` header is a development identity shim so the endpoints can be exercised before OTP auth is connected. It is not authentication; replace it with a validated Supabase/Firebase JWT before exposing this API. Never trust a client-supplied supplier ID in production.

## Implemented MVP surface

- Create supplier and supplier-scoped customers/invoices/payments.
- Dashboard totals and rows in the prototype's JSON shape.
- Cash profile and 12-week cash projection endpoint.
- Dispute creation and append-only audit events for core changes.
- Shared interest calculation service with dated partial-payment segments.
- SQLAlchemy entities for reminders, buyer links, disputes, cash profiles, config, and audit logs.

Messaging is a provider adapter stub. OTP/JWT auth, reminder delivery, UPI/payment webhooks, PDF output, and bank reports still need provider credentials and follow-on implementation. Bill extraction uses Gemini and returns a review draft; invoice creation remains a separate supplier-confirmed request. Buyer links support secure token creation, invoice view, acceptance, and dispute; rate limiting and notifications remain to be added. No real legal notice should be sent from this MVP. Interest and eligibility are advisory; confirm calculations and legal language with a CA/lawyer.

## Endpoints

- `POST /api/v1/suppliers`
- `POST /api/v1/scan/extract` (Gemini bill extraction; requires `GEMINI_API_KEY`, accepts JPG/PNG/PDF up to 10 MB; returns a review draft without saving an invoice)
- `POST|GET /api/v1/customers`
- `POST /api/v1/invoices`, `GET /api/v1/invoices/{invoice_id}`, `POST /api/v1/invoices/{invoice_id}/payments`
- `GET /api/v1/dashboard`
- `GET /api/v1/customer-scores`
- `PUT /api/v1/cash-profile`, `POST /api/v1/cash-alert`
- `POST /api/v1/invoices/{invoice_id}/disputes`
- `POST /api/v1/invoices/{invoice_id}/buyer-link`
- `GET /api/v1/buyer/{token}`, `POST /api/v1/buyer/{token}/accept`, `POST /api/v1/buyer/{token}/dispute`
- `GET /health`
