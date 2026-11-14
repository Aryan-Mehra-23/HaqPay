from datetime import date, datetime, timedelta, timezone
import hashlib
import logging
import secrets

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AuditLog, BuyerLink, CashProfile, Config, Customer, Dispute, Invoice, Payment, Supplier
from app.schemas.api import BuyerLinkCreate, CashProfileIn, CashProjectionRequest, CustomerCreate, CustomerOut, DisputeCreate, InvoiceCreate, PaymentCreate, SupplierCreate
from app.services.cash import project_cash
from app.services.interest import capped_due_date, invoice_interest
from app.services.ocr import extract_bill

router = APIRouter()
logger = logging.getLogger(__name__)
MAX_SCAN_BYTES = 10 * 1024 * 1024
SCAN_TYPES = {"image/jpeg", "image/png", "application/pdf"}


def supplier_scope(x_supplier_id: str | None = Header(default=None)) -> str:
    # Development identity only. Replace with a verified Supabase/Firebase JWT subject before deployment.
    if not x_supplier_id:
        raise HTTPException(401, "Missing supplier authentication")
    return x_supplier_id


def audit(db: Session, supplier_id: str, action: str, entity_type: str, entity_id: str | None = None):
    db.add(AuditLog(supplier_id=supplier_id, actor="supplier", action=action, entity_type=entity_type, entity_id=entity_id))


def get_customer(db: Session, supplier_id: str, customer_id: str) -> Customer:
    customer = db.scalar(select(Customer).where(Customer.id == customer_id, Customer.supplier_id == supplier_id))
    if not customer:
        raise HTTPException(404, "Customer not found")
    return customer


def get_invoice(db: Session, supplier_id: str, invoice_id: str) -> Invoice:
    invoice = db.scalar(select(Invoice).where(Invoice.id == invoice_id, Invoice.supplier_id == supplier_id))
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    return invoice


def get_buyer_link(db: Session, token: str) -> tuple[BuyerLink, Invoice]:
    digest = hashlib.sha256(token.encode()).hexdigest()
    link = db.scalar(select(BuyerLink).where(BuyerLink.token_hash == digest))
    now = datetime.now(timezone.utc)
    if not link or link.revoked_at or link.expires_at <= now:
        raise HTTPException(404, "Buyer link is invalid or expired")
    invoice = db.get(Invoice, link.invoice_id)
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    return link, invoice


@router.post("/suppliers", status_code=201)
def create_supplier(payload: SupplierCreate, db: Session = Depends(get_db)):
    if payload.udyam_number and not payload.udyam_number.strip():
        raise HTTPException(422, "Invalid Udyam number")
    supplier = Supplier(**payload.model_dump(), udyam_status="self_declared" if payload.udyam_number else "not_provided")
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return {"id": supplier.id, "name": supplier.name, "business_name": supplier.business_name, "udyam_status": supplier.udyam_status, "eligibility_warning": supplier.udyam_status != "verified"}


@router.post("/scan/extract")
async def scan_bill(file: UploadFile = File(...), supplier_id: str = Depends(supplier_scope)):
    if file.content_type not in SCAN_TYPES:
        raise HTTPException(415, "Upload a JPG, PNG, or PDF bill")
    contents = await file.read(MAX_SCAN_BYTES + 1)
    if not contents:
        raise HTTPException(400, "The uploaded file is empty")
    if len(contents) > MAX_SCAN_BYTES:
        raise HTTPException(413, "Bill file must be 10 MB or smaller")
    try:
        result = await extract_bill(contents, file.content_type)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        logger.exception("Gemini bill extraction failed")
        if any(marker in str(exc).upper() for marker in ("TIMEOUT", "TIMED OUT", "504", "DEADLINE_EXCEEDED")):
            raise HTTPException(504, "Bill reading timed out. Please retry with a smaller or clearer file.") from exc
        if any(marker in str(exc).upper() for marker in ("503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED")):
            raise HTTPException(503, "Gemini is temporarily busy. Please retry the scan in a moment.") from exc
        raise HTTPException(502, "Bill reading failed. Try a clearer JPG, PNG, or PDF, or enter the details manually.") from exc
    return {
        "customer": result["customer"],
        "invoice_number": result["invoice_number"],
        "amount": result["amount_paise"],
        "invoice_date": result["invoice_date"],
        "due_date": result["due_date"],
        "credit_days": result["credit_days"],
        "confidence": result["confidence"],
        "confirmed_by_user": False,
        "review_required": True,
    }


@router.post("/customers", response_model=CustomerOut, status_code=201)
def create_customer(payload: CustomerCreate, supplier_id: str = Depends(supplier_scope), db: Session = Depends(get_db)):
    customer = Customer(supplier_id=supplier_id, **payload.model_dump())
    db.add(customer)
    audit(db, supplier_id, "customer.created", "customer", customer.id)
    db.commit()
    db.refresh(customer)
    return customer


@router.get("/customers", response_model=list[CustomerOut])
def list_customers(supplier_id: str = Depends(supplier_scope), db: Session = Depends(get_db)):
    return list(db.scalars(select(Customer).where(Customer.supplier_id == supplier_id).order_by(Customer.name)))


@router.get("/customer-scores")
def customer_scores(supplier_id: str = Depends(supplier_scope), db: Session = Depends(get_db)):
    customers = db.scalars(select(Customer).where(Customer.supplier_id == supplier_id)).all()
    results = []
    for customer in customers:
        paid_delays, on_time, outstanding = [], 0, 0
        for invoice in sorted(customer.invoices, key=lambda row: row.invoice_date):
            paid_total = sum(payment.amount for payment in invoice.payments)
            if invoice.status == "paid" and invoice.payments:
                paid_date = max(payment.paid_on for payment in invoice.payments)
                delay = (paid_date - invoice.due_date).days
                paid_delays.append((max(delay, 0), invoice.amount))
                on_time += int(delay <= 0)
            elif invoice.status not in {"cancelled", "written_off"}:
                outstanding += max(invoice.amount - paid_total, 0)
        if paid_delays:
            # Recent invoices receive larger weights; latest record has weight N.
            weighted = sum(delay * weight for weight, (delay, _) in enumerate(paid_delays, start=1))
            avg_delay = round(weighted / sum(range(1, len(paid_delays) + 1)), 1)
            on_time_pct = round(on_time / len(paid_delays) * 100, 1)
        else:
            avg_delay, on_time_pct = 0.0, 0.0
        label = "Risky" if avg_delay > 60 else "Watch" if avg_delay > 30 else "Safe"
        results.append({"customer_name": customer.name, "avg_days_late": avg_delay, "label": label, "outstanding": outstanding, "on_time_pct": on_time_pct})
    return results


@router.post("/invoices", status_code=201)
def create_invoice(payload: InvoiceCreate, supplier_id: str = Depends(supplier_scope), db: Session = Depends(get_db)):
    get_customer(db, supplier_id, payload.customer_id)
    if payload.status not in {"draft", "sent", "accepted", "overdue"}:
        raise HTTPException(422, "Invalid initial invoice status")
    due = capped_due_date(payload.invoice_date, payload.credit_days)
    if payload.due_date and payload.due_date != due:
        raise HTTPException(422, f"Due date must follow the legal MVP cap: {due.isoformat()}")
    invoice = Invoice(supplier_id=supplier_id, due_date=due, **payload.model_dump(exclude={"due_date"}))
    db.add(invoice)
    audit(db, supplier_id, "invoice.created", "invoice", invoice.id)
    db.commit()
    db.refresh(invoice)
    return {"invoice_id": invoice.id, "invoice_no": invoice.invoice_no, "due_date": invoice.due_date, "status": invoice.status}


@router.get("/invoices/{invoice_id}")
def invoice_detail(invoice_id: str, supplier_id: str = Depends(supplier_scope), db: Session = Depends(get_db)):
    invoice = get_invoice(db, supplier_id, invoice_id)
    rate = float(db.get(Config, "bank_rate").value) if db.get(Config, "bank_rate") else 5.75
    multiplier = float(db.get(Config, "multiplier").value) if db.get(Config, "multiplier") else 3.0
    interest, days = invoice_interest(invoice, date.today(), rate, multiplier)
    return {"invoice_id": invoice.id, "customer_name": invoice.customer.name, "amount": invoice.amount, "days_late": days, "interest": interest, "status": invoice.status, "eligibility_unverified": True}


@router.post("/invoices/{invoice_id}/payments", status_code=201)
def add_payment(invoice_id: str, payload: PaymentCreate, supplier_id: str = Depends(supplier_scope), db: Session = Depends(get_db)):
    invoice = get_invoice(db, supplier_id, invoice_id)
    total_paid = sum(payment.amount for payment in invoice.payments)
    bank_row, multiplier_row = db.get(Config, "bank_rate"), db.get(Config, "multiplier")
    bank_rate = float(bank_row.value) if bank_row else 5.75
    multiplier = float(multiplier_row.value) if multiplier_row else 3.0
    interest_due, _ = invoice_interest(invoice, payload.paid_on, bank_rate, multiplier)
    total_due = invoice.amount + interest_due
    if payload.amount + total_paid > total_due:
        raise HTTPException(422, "Payment exceeds outstanding principal and accrued interest")
    payment = Payment(invoice_id=invoice.id, **payload.model_dump())
    db.add(payment)
    # Principal-first MVP allocation: an invoice is paid only when principal and
    # all accrued (including frozen) interest have been covered.
    settled = payload.amount + total_paid >= total_due
    invoice.status = "paid" if settled else "partly_paid"
    audit(db, supplier_id, "payment.recorded", "payment", payment.id)
    db.commit()
    return {"payment_id": payment.id, "status": invoice.status}


@router.get("/dashboard")
def dashboard(supplier_id: str = Depends(supplier_scope), db: Session = Depends(get_db)):
    rate_row, mult_row = db.get(Config, "bank_rate"), db.get(Config, "multiplier")
    rate, multiplier = (float(rate_row.value) if rate_row else 5.75), (float(mult_row.value) if mult_row else 3.0)
    invoices = db.scalars(select(Invoice).where(Invoice.supplier_id == supplier_id, Invoice.status.not_in(["draft", "paid", "cancelled", "written_off"]))).all()
    rows, pending, total_interest = [], 0, 0
    for inv in invoices:
        interest, days = invoice_interest(inv, date.today(), rate, multiplier)
        principal = max(inv.amount - sum(p.amount for p in inv.payments), 0)
        pending += principal
        total_interest += interest
        status = "overdue" if days > 0 and inv.status in {"sent", "accepted"} else inv.status
        rows.append({"customer_name": inv.customer.name, "amount": principal, "days_late": days if days else (inv.due_date - date.today()).days * -1, "interest": interest, "status": status, "invoice_id": inv.id})
    rows.sort(key=lambda r: r["days_late"], reverse=True)
    return {"total_interest": total_interest, "total_pending": pending, "late_bills_count": sum(r["days_late"] > 0 for r in rows), "rows": rows}


@router.put("/cash-profile")
def upsert_cash_profile(payload: CashProfileIn, supplier_id: str = Depends(supplier_scope), db: Session = Depends(get_db)):
    profile = db.get(CashProfile, supplier_id)
    if profile is None:
        profile = CashProfile(supplier_id=supplier_id, **payload.model_dump())
        db.add(profile)
    else:
        for key, value in payload.model_dump().items():
            setattr(profile, key, value)
    db.commit()
    return {"saved": True}


@router.post("/cash-alert")
def cash_alert(payload: CashProjectionRequest, supplier_id: str = Depends(supplier_scope), db: Session = Depends(get_db)):
    profile = db.get(CashProfile, supplier_id)
    if not profile:
        raise HTTPException(404, "Cash profile not configured")
    open_invoices = db.scalars(select(Invoice).where(Invoice.supplier_id == supplier_id, Invoice.status.in_(["sent", "accepted", "overdue", "partly_paid"]))).all()
    receivables = [(max(i.amount - sum(p.amount for p in i.payments), 0), i.invoice_date.fromordinal(i.invoice_date.toordinal() + payload.credit_days)) for i in open_invoices]
    return project_cash(profile.cash_in_hand, profile.weekly_costs, profile.weekly_sales, receivables, payload.credit_days)


@router.post("/invoices/{invoice_id}/disputes", status_code=201)
def create_dispute(invoice_id: str, payload: DisputeCreate, supplier_id: str = Depends(supplier_scope), db: Session = Depends(get_db)):
    invoice = get_invoice(db, supplier_id, invoice_id)
    if payload.reason not in {"goods_damaged", "wrong_quantity", "already_paid", "other"}:
        raise HTTPException(422, "Invalid dispute reason")
    dispute = Dispute(invoice_id=invoice.id, **payload.model_dump())
    invoice.status = "disputed"
    db.add(dispute)
    audit(db, supplier_id, "dispute.opened", "dispute", dispute.id)
    db.commit()
    return {"dispute_id": dispute.id, "status": "open"}


@router.post("/invoices/{invoice_id}/buyer-link", status_code=201)
def create_buyer_link(invoice_id: str, payload: BuyerLinkCreate, supplier_id: str = Depends(supplier_scope), db: Session = Depends(get_db)):
    invoice = get_invoice(db, supplier_id, invoice_id)
    token = secrets.token_urlsafe(32)
    link = BuyerLink(invoice_id=invoice.id, token_hash=hashlib.sha256(token.encode()).hexdigest(), expires_at=datetime.now(timezone.utc) + timedelta(days=payload.expires_in_days))
    db.add(link)
    audit(db, supplier_id, "buyer_link.created", "buyer_link", link.id)
    db.commit()
    return {"url_token": token, "expires_at": link.expires_at}


@router.get("/buyer/{token}")
def buyer_view(token: str, db: Session = Depends(get_db)):
    link, invoice = get_buyer_link(db, token)
    now = datetime.now(timezone.utc)
    if not link.opened_at:
        link.opened_at = now
    rate_row, mult_row = db.get(Config, "bank_rate"), db.get(Config, "multiplier")
    bank_rate = float(rate_row.value) if rate_row else 5.75
    multiplier = float(mult_row.value) if mult_row else 3.0
    interest, days = invoice_interest(invoice, date.today(), bank_rate, multiplier)
    tomorrow_interest, _ = invoice_interest(invoice, date.fromordinal(date.today().toordinal() + 1), bank_rate, multiplier)
    interest_per_day = max(tomorrow_interest - interest, 0)
    supplier = db.get(Supplier, invoice.supplier_id)
    db.add(AuditLog(supplier_id=invoice.supplier_id, actor="buyer", action="buyer_link.opened", entity_type="buyer_link", entity_id=link.id))
    db.commit()
    return {"supplier_name": supplier.business_name, "buyer_name": invoice.customer.name, "invoice_no": invoice.invoice_no, "amount": invoice.amount, "terms": invoice.credit_days, "days_late": days, "interest_so_far": interest, "interest_per_day": interest_per_day, "status": invoice.status, "eligibility_unverified": supplier.udyam_status != "verified", "disclaimer": "Illustrative estimate, not legal advice."}


@router.post("/buyer/{token}/accept")
def buyer_accept(token: str, db: Session = Depends(get_db)):
    link, invoice = get_buyer_link(db, token)
    if invoice.status in {"paid", "cancelled", "written_off"}:
        raise HTTPException(409, "Invoice is no longer open")
    now = datetime.now(timezone.utc)
    link.accepted_at = now
    invoice.status = "accepted"
    db.add(AuditLog(supplier_id=invoice.supplier_id, actor="buyer", action="invoice.accepted", entity_type="invoice", entity_id=invoice.id))
    db.commit()
    return {"accepted": True, "accepted_at": now}


@router.post("/buyer/{token}/dispute", status_code=201)
def buyer_dispute(token: str, payload: DisputeCreate, db: Session = Depends(get_db)):
    link, invoice = get_buyer_link(db, token)
    if payload.reason not in {"goods_damaged", "wrong_quantity", "already_paid", "other"}:
        raise HTTPException(422, "Invalid dispute reason")
    if invoice.status in {"paid", "cancelled", "written_off"}:
        raise HTTPException(409, "Invoice is no longer open")
    dispute = Dispute(invoice_id=invoice.id, **payload.model_dump())
    invoice.status = "disputed"
    db.add(dispute)
    db.add(AuditLog(supplier_id=invoice.supplier_id, actor="buyer", action="invoice.disputed", entity_type="invoice", entity_id=invoice.id))
    db.commit()
    return {"dispute_id": dispute.id, "status": "open"}
