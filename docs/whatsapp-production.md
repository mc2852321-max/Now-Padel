# WhatsApp Production Setup

## Modes

Use `WHATSAPP_SEND_MODE` to switch behavior without changing code:

- `mock`: local/test mode. No real WhatsApp message is sent.
- `evolution`: production automatic sending through Evolution API.
- `manual`: fallback mode. The app prepares WhatsApp Web links so the operator can send manually.

## Vercel Environment Variables For Test

Set these in the Vercel project environment while testing with your own WhatsApp number:

```env
WHATSAPP_SEND_MODE=manual
EVOLUTION_API_URL=https://wa-api.example.com
EVOLUTION_API_KEY=change-me
EVOLUTION_INSTANCE=now-padel-test
WHATSAPP_DEFAULT_COUNTRY_CODE=351
WHATSAPP_SENDER_NUMBER=351914742002
EVOLUTION_SEND_DELAY_MS=1200
```

The WhatsApp number to pair with the test Evolution instance is:

```text
+351 914 742 002
```

In API form, use:

```text
351914742002
```

When moving from test to the final club/client WhatsApp, create or reconnect the final Evolution instance and update:

```env
EVOLUTION_INSTANCE=now-padel
WHATSAPP_SENDER_NUMBER=351XXXXXXXXX
```

## Rollback To Manual Sending

If automatic sending is not reliable, change only this variable in Vercel:

```env
WHATSAPP_SEND_MODE=manual
```

Redeploy or restart the production function if needed. The UI will keep the same flow, but it will show manual WhatsApp links instead of sending through Evolution API.

## Evolution API Requirements

The Evolution API should run outside Vercel because it needs persistent WhatsApp sessions and supporting services such as PostgreSQL and Redis.

Recommended production shape:

- Evolution API behind HTTPS, for example `https://wa-api.example.com`.
- A persistent database and Redis for Evolution.
- A dedicated WhatsApp number for the club.
- One instance, for example `now-padel`, paired with that WhatsApp number.

## Create And Pair A Baileys Instance

In the Evolution API docs, use `Instances > Create Instance` with `WHATSAPP-BAILEYS`. Do not use WhatsApp Cloud API/Facebook Business for this setup.

Most fields in the docs example are optional. For the test number, the minimal create request is:

```bash
curl --request POST \
  --url "$EVOLUTION_API_URL/instance/create" \
  --header "Content-Type: application/json" \
  --header "apikey: $EVOLUTION_API_KEY" \
  --data '{
    "instanceName": "now-padel-test",
    "integration": "WHATSAPP-BAILEYS",
    "qrcode": true,
    "number": "351914742002"
  }'
```

Then request the connection QR or pairing code:

```bash
curl --request GET \
  --url "$EVOLUTION_API_URL/instance/connect/now-padel-test?number=351914742002" \
  --header "apikey: $EVOLUTION_API_KEY"
```

After pairing in WhatsApp, validate the connection state:

```bash
curl --request GET \
  --url "$EVOLUTION_API_URL/instance/connectionState/now-padel-test" \
  --header "apikey: $EVOLUTION_API_KEY"
```

The expected connected state is:

```json
{
  "instance": {
    "state": "open"
  }
}
```

## First Production Test

1. Deploy the Now Padel app with `WHATSAPP_SEND_MODE=manual` first.
2. Confirm the manual fallback works.
3. Pair `now-padel-test` with `+351 914 742 002`.
4. Switch to `WHATSAPP_SEND_MODE=evolution`.
5. Send to two or three controlled players.
6. Only then use it with normal player lists.

## Production Diagnostics

After deployment, log in to the app and call:

```text
/api/whatsapp/status
```

Expected production state:

```json
{
  "mode": "evolution",
  "senderNumber": "351914742002",
  "evolution": {
    "configured": true,
    "connectionState": "open",
    "ownerNumber": "351914742002",
    "senderMatchesInstance": true
  }
}
```
