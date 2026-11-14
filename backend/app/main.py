from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.models import AuditLog, BuyerLink, CashProfile, Config, Customer, Dispute, Invoice, Payment, ReminderLog, Supplier  # noqa: F401
from app.routers.api import router

app = FastAPI(title="HaqPay API", version="0.1.0", description="MVP API; amounts are integer paise.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    # Local frontend servers (Live Server, Vite, etc.) may use different ports.
    # Keep this limited to loopback hosts for development; use explicit origins in production.
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router, prefix="/api/v1")


@app.get("/health")
def health():
    return {"status": "ok"}
