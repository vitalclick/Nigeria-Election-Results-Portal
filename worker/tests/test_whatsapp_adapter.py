"""Tests for the WhatsApp adapter + fallback strategy."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.auth.twilio_adapter import NoOpAdapter, SmsResult, build_default_adapter
from app.auth.whatsapp_adapter import TwilioWhatsAppAdapter, WhatsAppFirstAdapter


@pytest.mark.asyncio
async def test_twilio_whatsapp_prefixes_from_and_to():
    """The adapter must add the `whatsapp:` prefix to plain E.164
    numbers passed to it - callers should not have to remember the
    Twilio-specific format."""
    adapter = TwilioWhatsAppAdapter(
        account_sid="ACtest",
        auth_token="token",
        from_number="+12025550100",   # no prefix
    )
    captured: dict = {}

    class FakeResp:
        status_code = 201

        def json(self):
            return {"sid": "MMtest"}

    async def fake_post(url, auth, data):
        captured.update(data=data, url=url)
        return FakeResp()

    with patch("httpx.AsyncClient.post", side_effect=fake_post):
        result = await adapter.send(to_e164="+2348035550101", body="OTP 123456")

    assert result.ok is True
    assert result.provider_id == "MMtest"
    assert captured["data"]["From"] == "whatsapp:+12025550100"
    assert captured["data"]["To"] == "whatsapp:+2348035550101"


@pytest.mark.asyncio
async def test_twilio_whatsapp_preserves_existing_prefix():
    adapter = TwilioWhatsAppAdapter(
        account_sid="ACtest",
        auth_token="token",
        from_number="whatsapp:+12025550100",
    )
    captured: dict = {}

    class FakeResp:
        status_code = 201

        def json(self):
            return {"sid": "MM"}

    async def fake_post(url, auth, data):
        captured.update(data=data)
        return FakeResp()

    with patch("httpx.AsyncClient.post", side_effect=fake_post):
        await adapter.send(to_e164="whatsapp:+2348035550101", body="x")

    assert captured["data"]["From"] == "whatsapp:+12025550100"
    assert captured["data"]["To"] == "whatsapp:+2348035550101"


@pytest.mark.asyncio
async def test_whatsapp_first_falls_back_to_sms_on_whatsapp_failure():
    wa = AsyncMock()
    wa.send = AsyncMock(return_value=SmsResult(ok=False, provider_id=None, error="not a wa user"))
    sms = AsyncMock()
    sms.send = AsyncMock(return_value=SmsResult(ok=True, provider_id="SM-x"))

    strategy = WhatsAppFirstAdapter(whatsapp=wa, sms=sms)
    result = await strategy.send(to_e164="+2348035550101", body="OTP 123456")

    assert result.ok is True
    assert result.provider_id == "SM-x"
    wa.send.assert_awaited_once()
    sms.send.assert_awaited_once()


@pytest.mark.asyncio
async def test_whatsapp_first_does_not_fall_back_on_success():
    wa = AsyncMock()
    wa.send = AsyncMock(return_value=SmsResult(ok=True, provider_id="WA-1"))
    sms = AsyncMock()
    sms.send = AsyncMock()

    strategy = WhatsAppFirstAdapter(whatsapp=wa, sms=sms)
    result = await strategy.send(to_e164="+2348035550101", body="x")

    assert result.ok is True
    assert result.provider_id == "WA-1"
    sms.send.assert_not_awaited()


def test_factory_returns_noop_when_twilio_disabled():
    adapter = build_default_adapter(
        enabled=False,
        account_sid="x", auth_token="y", from_number="+1",
    )
    assert isinstance(adapter, NoOpAdapter)


def test_factory_returns_sms_only_when_no_whatsapp_configured():
    from app.auth.twilio_adapter import TwilioAdapter

    adapter = build_default_adapter(
        enabled=True,
        account_sid="ACtest", auth_token="t", from_number="+1",
    )
    assert isinstance(adapter, TwilioAdapter)


def test_factory_returns_whatsapp_first_when_both_configured():
    adapter = build_default_adapter(
        enabled=True,
        account_sid="ACtest", auth_token="t", from_number="+1",
        whatsapp_from="whatsapp:+1",
    )
    assert isinstance(adapter, WhatsAppFirstAdapter)
