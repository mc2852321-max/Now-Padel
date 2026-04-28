import type { Player, WhatsappSendResponse, WhatsappSendResult, WhatsappStatusResponse } from "../shared/schema.js";

type WhatsappMode = WhatsappSendResponse["mode"];
type WhatsappRecipient = {
  playerId: number;
  player: Player | null;
  message: string;
};

function getWhatsappMode(): WhatsappMode {
  const configuredMode = process.env.WHATSAPP_SEND_MODE?.trim().toLowerCase();
  if (configuredMode === "evolution") return "evolution";
  if (configuredMode === "manual" || configuredMode === "link") return "manual";
  return "mock";
}

function getDefaultCountryCode(): string {
  return process.env.WHATSAPP_DEFAULT_COUNTRY_CODE?.replace(/\D/g, "") || "351";
}

function getConfiguredSenderNumber(): string | null {
  const configured = process.env.WHATSAPP_SENDER_NUMBER?.trim();
  if (!configured) return null;
  return normalizeWhatsappNumber(configured);
}

function getEvolutionConfig() {
  return {
    baseUrl: process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, ""),
    apiKey: process.env.EVOLUTION_API_KEY?.trim(),
    instance: process.env.EVOLUTION_INSTANCE?.trim(),
    delay: Number(process.env.EVOLUTION_SEND_DELAY_MS || 1200),
  };
}

export function normalizeWhatsappNumber(phone: string): string | null {
  const withoutPrefix = phone.trim().replace(/^00/, "");
  const digits = withoutPrefix.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.length === 9) {
    return `${getDefaultCountryCode()}${digits}`;
  }

  if (digits.length >= 10 && digits.length <= 15) {
    return digits;
  }

  return null;
}

function buildWhatsappWebUrl(number: string, message: string): string {
  return `https://web.whatsapp.com/send?phone=${number}&text=${encodeURIComponent(message)}`;
}

function summarizeResults(
  mode: WhatsappMode,
  results: WhatsappSendResult[],
  fallbackUrl?: string,
): WhatsappSendResponse {
  const sent = results.filter((result) => result.status === "sent" || result.status === "mock_sent").length;
  const manual = results.filter((result) => result.status === "manual").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;

  return {
    success: failed === 0 && skipped === 0 && results.length > 0,
    mode,
    total: results.length,
    sent,
    manual,
    failed,
    skipped,
    results,
    fallbackUrl,
  };
}

function parseEvolutionMessageId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;

  const record = payload as Record<string, unknown>;
  if (typeof record.id === "string") return record.id;

  const key = record.key;
  if (key && typeof key === "object" && typeof (key as Record<string, unknown>).id === "string") {
    return (key as Record<string, string>).id;
  }

  return undefined;
}

function parseEvolutionConnectionState(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  const instance = record.instance;
  if (instance && typeof instance === "object") {
    const state = (instance as Record<string, unknown>).state ?? (instance as Record<string, unknown>).status;
    return typeof state === "string" ? state : null;
  }

  const state = record.state ?? record.status;
  return typeof state === "string" ? state : null;
}

function parseEvolutionOwnerNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const rawNumber = value.split("@")[0] ?? value;
  const digits = rawNumber.replace(/\D/g, "");
  return digits || null;
}

function parseEvolutionInstanceInfo(payload: unknown, instanceName: string): { ownerNumber: string | null; profileName: string | null } {
  const candidates = Array.isArray(payload) ? payload : [payload];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;

    const record = candidate as Record<string, unknown>;
    const instance = record.instance && typeof record.instance === "object"
      ? record.instance as Record<string, unknown>
      : record;

    const name = instance.instanceName;
    if (typeof name === "string" && name !== instanceName) continue;

    return {
      ownerNumber: parseEvolutionOwnerNumber(instance.owner),
      profileName: typeof instance.profileName === "string" ? instance.profileName : null,
    };
  }

  return { ownerNumber: null, profileName: null };
}

async function getEvolutionConnectionState(): Promise<{ state: string | null; error?: string }> {
  const config = getEvolutionConfig();
  if (!config.baseUrl || !config.apiKey || !config.instance) {
    return { state: null, error: "Evolution API nao configurada." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${config.baseUrl}/instance/connectionState/${encodeURIComponent(config.instance)}`, {
      method: "GET",
      headers: {
        apikey: config.apiKey,
      },
      signal: controller.signal,
    });

    const responseText = await response.text();
    let payload: unknown = null;
    if (responseText) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        payload = responseText;
      }
    }

    if (!response.ok) {
      const detail = typeof payload === "string" ? payload : response.statusText;
      return { state: null, error: `Evolution API ${response.status}: ${detail}` };
    }

    return { state: parseEvolutionConnectionState(payload) };
  } catch (error) {
    return {
      state: null,
      error: error instanceof Error ? error.message : "Erro desconhecido ao consultar Evolution API.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getEvolutionInstanceInfo(): Promise<{ ownerNumber: string | null; profileName: string | null; error?: string }> {
  const config = getEvolutionConfig();
  if (!config.baseUrl || !config.apiKey || !config.instance) {
    return { ownerNumber: null, profileName: null, error: "Evolution API nao configurada." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const params = new URLSearchParams({ instanceName: config.instance });
    const response = await fetch(`${config.baseUrl}/instance/fetchInstances?${params.toString()}`, {
      method: "GET",
      headers: {
        apikey: config.apiKey,
      },
      signal: controller.signal,
    });

    const responseText = await response.text();
    let payload: unknown = null;
    if (responseText) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        payload = responseText;
      }
    }

    if (!response.ok) {
      const detail = typeof payload === "string" ? payload : response.statusText;
      return { ownerNumber: null, profileName: null, error: `Evolution API ${response.status}: ${detail}` };
    }

    return parseEvolutionInstanceInfo(payload, config.instance);
  } catch (error) {
    return {
      ownerNumber: null,
      profileName: null,
      error: error instanceof Error ? error.message : "Erro desconhecido ao consultar instancia Evolution API.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getWhatsappStatus(): Promise<WhatsappStatusResponse> {
  const mode = getWhatsappMode();
  const config = getEvolutionConfig();
  const senderNumber = getConfiguredSenderNumber();
  const apiUrlConfigured = Boolean(config.baseUrl);
  const apiKeyConfigured = Boolean(config.apiKey);
  const instanceConfigured = Boolean(config.instance);
  const configured = apiUrlConfigured && apiKeyConfigured && instanceConfigured;
  const [connection, instanceInfo] = mode === "evolution" && configured
    ? await Promise.all([getEvolutionConnectionState(), getEvolutionInstanceInfo()])
    : [{ state: null }, { ownerNumber: null, profileName: null }];

  return {
    mode,
    senderNumber,
    evolution: {
      configured,
      apiUrlConfigured,
      apiKeyConfigured,
      instanceConfigured,
      instance: config.instance || null,
      connectionState: connection.state,
      ownerNumber: instanceInfo.ownerNumber,
      profileName: instanceInfo.profileName,
      ...(senderNumber && instanceInfo.ownerNumber
        ? { senderMatchesInstance: senderNumber === instanceInfo.ownerNumber }
        : {}),
      ...(connection.error || instanceInfo.error ? { error: connection.error || instanceInfo.error } : {}),
    },
  };
}

async function sendEvolutionText(number: string, message: string): Promise<string | undefined> {
  const config = getEvolutionConfig();
  if (!config.baseUrl || !config.apiKey || !config.instance) {
    throw new Error("Evolution API nao configurada. Define EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${config.baseUrl}/message/sendText/${encodeURIComponent(config.instance)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.apiKey,
      },
      body: JSON.stringify({
        number,
        text: message,
        delay: Number.isFinite(config.delay) ? config.delay : 1200,
        linkPreview: false,
      }),
      signal: controller.signal,
    });

    const responseText = await response.text();
    let payload: unknown = null;
    if (responseText) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        payload = responseText;
      }
    }

    if (!response.ok) {
      const detail = typeof payload === "string" ? payload : response.statusText;
      throw new Error(`Evolution API ${response.status}: ${detail}`);
    }

    return parseEvolutionMessageId(payload);
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendWhatsappMessages(recipients: WhatsappRecipient[]): Promise<WhatsappSendResponse> {
  const mode = getWhatsappMode();
  const results: WhatsappSendResult[] = [];
  let fallbackUrl: string | undefined;

  for (const recipient of recipients) {
    if (!recipient.player) {
      results.push({
        playerId: recipient.playerId,
        name: `Jogador #${recipient.playerId}`,
        phone: "",
        number: null,
        status: "skipped",
        error: "Jogador nao encontrado.",
      });
      continue;
    }

    const number = normalizeWhatsappNumber(recipient.player.phone);
    if (!number) {
      results.push({
        playerId: recipient.player.id,
        name: recipient.player.name,
        phone: recipient.player.phone,
        number: null,
        status: "skipped",
        error: "Numero WhatsApp invalido.",
      });
      continue;
    }

    const recipientFallbackUrl = buildWhatsappWebUrl(number, recipient.message);
    fallbackUrl ??= recipientFallbackUrl;

    if (mode === "mock") {
      results.push({
        playerId: recipient.player.id,
        name: recipient.player.name,
        phone: recipient.player.phone,
        number,
        status: "mock_sent",
        fallbackUrl: recipientFallbackUrl,
      });
      continue;
    }

    if (mode === "manual") {
      results.push({
        playerId: recipient.player.id,
        name: recipient.player.name,
        phone: recipient.player.phone,
        number,
        status: "manual",
        fallbackUrl: recipientFallbackUrl,
      });
      continue;
    }

    try {
      const providerMessageId = await sendEvolutionText(number, recipient.message);
      results.push({
        playerId: recipient.player.id,
        name: recipient.player.name,
        phone: recipient.player.phone,
        number,
        status: "sent",
        fallbackUrl: recipientFallbackUrl,
        providerMessageId,
      });
    } catch (error) {
      results.push({
        playerId: recipient.player.id,
        name: recipient.player.name,
        phone: recipient.player.phone,
        number,
        status: "failed",
        fallbackUrl: recipientFallbackUrl,
        error: error instanceof Error ? error.message : "Erro desconhecido ao enviar WhatsApp.",
      });
    }
  }

  return summarizeResults(mode, results, fallbackUrl);
}
