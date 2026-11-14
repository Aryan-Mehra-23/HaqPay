from datetime import date
from math import pow


def calculate_interest(principal_paise: int, days_late: int, bank_rate_percent: float = 5.75, multiplier: float = 3.0) -> int:
    """Calculate interest in paise. Formula is illustrative and subject to legal review."""
    if principal_paise <= 0 or days_late <= 0:
        return 0
    annual_rate = (bank_rate_percent * multiplier) / 100
    accrued = principal_paise * (pow(1 + annual_rate / 12, days_late / 30.4) - 1)
    return round(accrued)


def invoice_interest(invoice, as_of: date, bank_rate_percent: float = 5.75, multiplier: float = 3.0) -> tuple[int, int]:
    """Return (current accrued interest paise, days late), freezing accrued interest at principal payments."""
    if invoice.status in {"draft", "paid", "cancelled", "written_off"}:
        return 0, max((as_of - invoice.due_date).days, 0)
    principal = invoice.amount
    frozen_interest = 0
    cursor = invoice.due_date
    for payment in sorted(invoice.payments, key=lambda p: p.paid_on):
        payment_day = max(payment.paid_on, invoice.due_date)
        frozen_interest += calculate_interest(principal, max((payment_day - cursor).days, 0), bank_rate_percent, multiplier)
        principal = max(0, principal - payment.amount)
        cursor = payment_day
    accrued = frozen_interest + calculate_interest(principal, max((as_of - cursor).days, 0), bank_rate_percent, multiplier)
    return accrued, max((as_of - invoice.due_date).days, 0)


def capped_due_date(invoice_date: date, credit_days: int, has_written_agreement: bool = True) -> date:
    legal_days = min(credit_days, 45) if has_written_agreement else 15
    return invoice_date.fromordinal(invoice_date.toordinal() + legal_days)
