import uuid
from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def new_id() -> str:
    return str(uuid.uuid4())


class Supplier(Base):
    __tablename__ = "suppliers"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(200))
    business_name: Mapped[str] = mapped_column(String(240))
    phone: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(254))
    udyam_number: Mapped[str | None] = mapped_column(String(32))
    udyam_status: Mapped[str] = mapped_column(String(20), default="self_declared")
    plan: Mapped[str] = mapped_column(String(20), default="free")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    customers: Mapped[list["Customer"]] = relationship(back_populates="supplier", cascade="all, delete-orphan")
    invoices: Mapped[list["Invoice"]] = relationship(back_populates="supplier", cascade="all, delete-orphan")


class Customer(Base):
    __tablename__ = "customers"
    __table_args__ = (UniqueConstraint("supplier_id", "id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    supplier_id: Mapped[str] = mapped_column(ForeignKey("suppliers.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    business_name: Mapped[str | None] = mapped_column(String(240))
    phone: Mapped[str | None] = mapped_column(String(32))
    opt_out: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    supplier: Mapped[Supplier] = relationship(back_populates="customers")
    invoices: Mapped[list["Invoice"]] = relationship(back_populates="customer")


class Invoice(Base):
    __tablename__ = "invoices"
    __table_args__ = (UniqueConstraint("supplier_id", "customer_id", "invoice_no"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    supplier_id: Mapped[str] = mapped_column(ForeignKey("suppliers.id", ondelete="CASCADE"), index=True)
    customer_id: Mapped[str] = mapped_column(String(36), ForeignKey("customers.id", ondelete="CASCADE"), index=True)
    invoice_no: Mapped[str] = mapped_column(String(100))
    amount: Mapped[int] = mapped_column(BigInteger)  # integer paise
    invoice_date: Mapped[date] = mapped_column(Date)
    credit_days: Mapped[int] = mapped_column(Integer, default=15)
    due_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    photo_url: Mapped[str | None] = mapped_column(Text)
    ai_confidence: Mapped[dict] = mapped_column(JSON, default=dict)
    confirmed_by_user: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    supplier: Mapped[Supplier] = relationship(back_populates="invoices")
    customer: Mapped[Customer] = relationship(back_populates="invoices")
    payments: Mapped[list["Payment"]] = relationship(back_populates="invoice", cascade="all, delete-orphan", order_by="Payment.paid_on")


class Payment(Base):
    __tablename__ = "payments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    invoice_id: Mapped[str] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), index=True)
    amount: Mapped[int] = mapped_column(BigInteger)  # integer paise
    paid_on: Mapped[date] = mapped_column(Date)
    mode: Mapped[str] = mapped_column(String(20))
    marked_by: Mapped[str] = mapped_column(String(20))
    invoice: Mapped[Invoice] = relationship(back_populates="payments")


class ReminderLog(Base):
    __tablename__ = "reminder_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    invoice_id: Mapped[str] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(20))
    message: Mapped[str] = mapped_column(Text)
    channel: Mapped[str] = mapped_column(String(20), default="manual")
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivery_status: Mapped[str] = mapped_column(String(40), default="draft")


class BuyerLink(Base):
    __tablename__ = "buyer_links"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    invoice_id: Mapped[str] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Dispute(Base):
    __tablename__ = "disputes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    invoice_id: Mapped[str] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), index=True)
    reason: Mapped[str] = mapped_column(String(40))
    comment: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="open")
    resolution_note: Mapped[str | None] = mapped_column(Text)


class CashProfile(Base):
    __tablename__ = "cash_profiles"
    supplier_id: Mapped[str] = mapped_column(ForeignKey("suppliers.id", ondelete="CASCADE"), primary_key=True)
    cash_in_hand: Mapped[int] = mapped_column(BigInteger, default=0)
    weekly_costs: Mapped[int] = mapped_column(BigInteger, default=0)
    weekly_sales: Mapped[int] = mapped_column(BigInteger, default=0)


class Config(Base):
    __tablename__ = "app_config"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[dict | list | str | int | float | bool] = mapped_column(JSON)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    supplier_id: Mapped[str] = mapped_column(ForeignKey("suppliers.id", ondelete="CASCADE"), index=True)
    actor: Mapped[str] = mapped_column(String(100))
    action: Mapped[str] = mapped_column(String(100))
    entity_type: Mapped[str] = mapped_column(String(80))
    entity_id: Mapped[str | None] = mapped_column(String(36))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
