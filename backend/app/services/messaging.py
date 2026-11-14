"""Adapter boundary for WhatsApp/SMS/email providers."""


async def send_message(channel: str, destination: str, message: str) -> dict:
    raise NotImplementedError("Configure a messaging provider before sending messages")
