from datetime import date, timedelta


def project_cash(cash_in_hand: int, weekly_costs: int, weekly_sales: int, receivables: list[tuple[int, date]], credit_days: int, weeks: int = 12) -> dict:
    """Simple deterministic MVP projection. Values are integer paise."""
    today = date.today()
    series = []
    balance = cash_in_hand
    min_balance, min_week, run_out_week = balance, 0, None
    for week in range(1, weeks + 1):
        week_start = today + timedelta(days=7 * (week - 1))
        week_end = today + timedelta(days=7 * week)
        collections = sum(amount for amount, due in receivables if week_start < due <= week_end)
        balance += weekly_sales - weekly_costs + collections
        series.append({"week": week, "balance": balance})
        if balance < min_balance:
            min_balance, min_week = balance, week
        if balance < 0 and run_out_week is None:
            run_out_week = week
    return {"run_out_week": run_out_week, "min_balance": min_balance, "min_week": min_week, "series": series}
