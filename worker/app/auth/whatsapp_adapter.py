"""WhatsApp Business adapter.

Same SmsAdapter contract as the Twilio SMS adapter, so the auth flow
can swap between them transparently. Uses Twilio's WhatsApp integration
under the hood (same account SID + auth token, different `From` format
`whatsapp:+234...`). For a direct Meta WhatsApp Business API integration,
implement another class with the same shape.

WhatsApp message templates must be pre-approved by Meta. The OTP body
is parameterised so we can pass the code into the template variable.
Template name is configurable via WHATSAPP_TEMPLATE_OTP.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from .twilio_adapter import SmsAdapter, SmsResult

log = logging.getLogger(__name__)


class TwilioWhatsAppAdapter(SmsAdapter):
    """WhatsApp via Twilio. Same REST endpoint as SMS; only the `From`
    sender format differs."""

    BASE_URL = "https://api.twilio.com/2010-04-01"

    def __init__(
        self,
        account_sid: str,
        auth_token: str,
        from_number: str,
        template_name: str | None = None,
    ):
        self.account_sid = account_sid
        self.auth_token = auth_token
        # Twilio accepts either "whatsapp:+E.164" or plain E.164; we
        # normalise to the prefixed form here so callers don't have to.
        self.from_number = (
            from_number if from_number.startswith("whatsapp:") else f"whatsapp:{from_number}"
        )
        self.template_name = template_name

    async def send(self, *, to_e164: str, body: str) -> SmsResult:
        url = f"{self.BASE_URL}/Accounts/{self.account_sid}/Messages.json"
        to = to_e164 if to_e164.startswith("whatsapp:") else f"whatsapp:{to_e164}"
        data = {"From": self.from_number, "To": to, "Body": body}
        if self.template_name:
            data["ContentSid"] = self.template_name
        try:
            async with httpx.AsyncClient(timeout=10.0) as c:
                r = await c.post(
                    url, auth=(self.account_sid, self.auth_token), data=data
                )
            if r.status_code >= 300:
                return SmsResult(
                    ok=False,
                    provider_id=None,
                    error=f"HTTP {r.status_code}: {r.text[:200]}",
                )
            payload: dict[str, Any] = r.json()
            return SmsResult(ok=True, provider_id=payload.get("sid"))
        except Exception as e:
            return SmsResult(ok=False, provider_id=None, error=str(e))


class WhatsAppFirstAdapter(SmsAdapter):
    """Strategy: try WhatsApp first; on failure (or when the recipient is
    not a WhatsApp user) fall back to SMS. Used in production where the
    operator has both Twilio SMS and WhatsApp credentials configured -
    WhatsApp messaging is ~60% cheaper than Nigerian SMS so we prefer
    it when available.
    """

    def __init__(self, whatsapp: SmsAdapter, sms: SmsAdapter):
        self.whatsapp = whatsapp
        self.sms = sms

    async def send(self, *, to_e164: str, body: str) -> SmsResult:
        wa_result = await self.whatsapp.send(to_e164=to_e164, body=body)
        if wa_result.ok:
            return wa_result
        log.info(
            "auth.sms.whatsapp_fallback",
            extra={"to": to_e164, "wa_error": wa_result.error},
        )
        return await self.sms.send(to_e164=to_e164, body=body)
