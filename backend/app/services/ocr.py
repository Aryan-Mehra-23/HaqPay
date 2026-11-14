"""Gemini-powered invoice extraction. Results remain drafts until a supplier confirms them."""

import json

from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from app.config import settings


class FieldConfidence(BaseModel):
    customer: float = Field(ge=0, le=1)
    invoice_number: float = Field(ge=0, le=1)
    amount: float = Field(ge=0, le=1)
    invoice_date: float = Field(ge=0, le=1)
    credit_days: float = Field(ge=0, le=1)
    due_date: float = Field(ge=0, le=1)


class BillExtraction(BaseModel):
    customer: str | None
    invoice_number: str | None
    amount_paise: int | None = Field(description="Total amount converted to integer paise; null if unclear")
    invoice_date: str | None = Field(description="ISO date YYYY-MM-DD, or null if unclear")
    credit_days: int | None = Field(description="Explicit written credit terms in days, or null if absent")
    due_date: str | None = Field(description="Printed due date as ISO date YYYY-MM-DD, or null if absent")
    confidence: FieldConfidence


async def extract_bill(file_bytes: bytes, content_type: str) -> dict:
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is missing from the backend .env file")

    # Bound provider wait time: the SDK otherwise retries transient 503/429s
    # several times before our fallback model is attempted.
    client = genai.Client(
        api_key=settings.gemini_api_key,
        http_options=types.HttpOptions(
            timeout=15000,
            retry_options=types.HttpRetryOptions(attempts=1),
        ),
    )
    prompt = """Read this supplier invoice. Extract only information visibly present on the document.
Return the buyer/customer name, invoice number, total payable amount, invoice date, explicit written credit period in days, and printed due date.
Convert the total to integer paise (1 rupee = 100 paise). Return dates as YYYY-MM-DD.
If a value is absent, ambiguous, or unreadable, return null. Do not invent credit terms or infer dates.
For each field, provide an approximate confidence from 0.0 to 1.0 based on legibility and certainty; this is an estimate, not a calibrated probability."""
    # A transient capacity issue on one model should not fail the whole scan.
    fallback_model = "gemini-3.6-flash" if settings.gemini_model != "gemini-3.6-flash" else "gemini-3.5-flash"
    model_candidates = list(dict.fromkeys([settings.gemini_model, fallback_model]))
    response = None
    for model in model_candidates:
        try:
            response = await client.aio.models.generate_content(
                model=model,
                contents=[prompt, types.Part.from_bytes(data=file_bytes, mime_type=content_type)],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=BillExtraction,
                    temperature=0,
                ),
            )
            break
        except Exception as exc:
            error_text = str(exc).upper()
            if not any(marker in error_text for marker in ("503", "UNAVAILABLE", "504", "DEADLINE_EXCEEDED", "429", "RESOURCE_EXHAUSTED")):
                raise
            if model == model_candidates[-1]:
                raise
    if not response.text:
        raise ValueError("Gemini returned no bill fields")
    extracted = BillExtraction.model_validate_json(response.text)
    return extracted.model_dump()
