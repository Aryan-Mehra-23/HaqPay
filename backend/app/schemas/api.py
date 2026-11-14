from datetime import date
from pydantic import BaseModel, ConfigDict, Field


class SupplierCreate(BaseModel):
    name: str
    business_name: str
    phone: str
    udyam_number: str | None = None


class CustomerCreate(BaseModel):
    name: str
    business_name: str | None = None
    phone: str | None = None


class CustomerOut(BaseModel):
    id: str
    name: str
    business_name: str | None
    phone: str | None
    model_config = ConfigDict(from_attributes=True)


class InvoiceCreate(BaseModel):
    customer_id: str
    invoice_no: str
    amount: int = Field(gt=0, description="Amount in paise")
    invoice_date: date
    credit_days: int = Field(default=15, ge=0, le=365)
    due_date: date | None = None
    status: str = "sent"
    photo_url: str | None = None
    ai_confidence: dict[str, float] = Field(default_factory=dict)
    confirmed_by_user: bool = True


class PaymentCreate(BaseModel):
    amount: int = Field(gt=0, description="Amount in paise")
    paid_on: date
    mode: str = "bank"
    marked_by: str = "supplier"


class CashProfileIn(BaseModel):
    cash_in_hand: int = Field(ge=0)
    weekly_costs: int = Field(ge=0)
    weekly_sales: int = Field(ge=0)


class CashProjectionRequest(BaseModel):
    credit_days: int = Field(default=30, ge=30, le=90)


class DisputeCreate(BaseModel):
    reason: str
    comment: str | None = None


class BuyerLinkCreate(BaseModel):
    expires_in_days: int = Field(default=14, ge=1, le=90)
