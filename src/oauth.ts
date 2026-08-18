import { createHash, randomBytes } from "node:crypto";

/**
 * Ask Ads' OAuth app for Metrica, scoped to `metrika:read` only. Overridable so
 * a user who wants their own app (narrower scope, own consent screen) can point
 * the flow at it without forking.
 */
export const DEFAULT_CLIENT_ID = "b282705d340f4253a456d8625af3ebee";

/** Yandex shows the code on this page instead of redirecting anywhere. */
export const VERIFICATION_REDIRECT = "https://oauth.yandex.ru/verification_code";

/**
 * Requested rights. Sent explicitly even though the app is already scoped to
 * Metrica: without `scope` Yandex issues a token carrying **every** right the app
 * holds, so an app that gains a right later would silently widen every token
 * minted afterwards.
 */
export const SCOPE = "metrika:read";

const AUTHORIZE_URL = "https://oauth.yandex.ru/authorize";
const TOKEN_URL = "https://oauth.yandex.ru/token";

/** The confirmation code is valid for 10 minutes; the pending login expires with it. */
const PENDING_TTL_MS = 10 * 60 * 1000;

const OAUTH_TIMEOUT_MS = 30_000;

export function oauthClientId(): string {
  return process.env.YANDEX_METRIKA_OAUTH_CLIENT_ID || DEFAULT_CLIENT_ID;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/**
 * A PKCE pair per RFC 7636: the verifier stays in this process, only its SHA-256
 * digest travels in the authorize URL. That asymmetry is what makes it safe for
 * the confirmation code to pass through the chat — the code alone cannot be
 * redeemed by anyone who sees it.
 */
export function createPkce(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/**
 * No `state` parameter on purpose: state exists to tie a redirect back to the
 * session that started it, and this flow has no redirect — the user copies the
 * code off Yandex's page by hand, and PKCE already binds the exchange to the
 * verifier held in this process.
 */
export function buildAuthorizeUrl(params: { clientId: string; challenge: string }): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", VERIFICATION_REDIRECT);
  url.searchParams.set("code_challenge", params.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("scope", SCOPE);
  // Always show the consent screen: a user who authorized this app earlier would
  // otherwise be handed the old token back, with whatever rights it carried then.
  url.searchParams.set("force_confirm", "yes");
  return url.toString();
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  /** Yandex returns this only when it granted *fewer* rights than requested. */
  scope?: string;
}

/** A pending login: the verifier that must accompany the code the user pastes back. */
interface PendingLogin {
  verifier: string;
  clientId: string;
  createdAt: number;
}

// One slot, not a map: a single stdio server serves one user, and a second
// `start_login` means they abandoned the first attempt (wrong account, closed
// the tab) — keeping the stale verifier around would only redeem the wrong code.
let pending: PendingLogin | undefined;

/** Starts a login: mints the PKCE pair, remembers the verifier, returns the URL to open. */
export function startLogin(now = Date.now()): { authorizeUrl: string } {
  const clientId = oauthClientId();
  const { verifier, challenge } = createPkce();
  const authorizeUrl = buildAuthorizeUrl({ clientId, challenge });
  pending = { verifier, clientId, createdAt: now };
  return { authorizeUrl };
}

export function pendingLogin(now = Date.now()): PendingLogin | undefined {
  if (!pending) return undefined;
  if (now - pending.createdAt > PENDING_TTL_MS) {
    pending = undefined;
    return undefined;
  }
  return pending;
}

export function clearPendingLogin(): void {
  pending = undefined;
}

/**
 * Exchanges a confirmation code for tokens. `client_secret` is deliberately not
 * sent: the app is a public client and PKCE is what proves the caller started
 * the flow — shipping a secret inside an npm package would protect nothing.
 */
export async function exchangeCode(params: {
  code: string;
  verifier: string;
  clientId: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenResponse> {
  return postToken(
    {
      grant_type: "authorization_code",
      code: params.code,
      client_id: params.clientId,
      code_verifier: params.verifier,
    },
    params.fetchImpl,
  );
}

/** Trades a refresh token for a fresh access token (same public-client rules). */
export async function refreshTokens(params: {
  refreshToken: string;
  clientId: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenResponse> {
  return postToken(
    {
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
      client_id: params.clientId,
    },
    params.fetchImpl,
  );
}

async function postToken(
  form: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OAUTH_TIMEOUT_MS);
  let res: Response;
  let text: string;
  try {
    res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: controller.signal,
    });
    text = await res.text();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Запрос к oauth.yandex.ru превысил таймаут ${OAUTH_TIMEOUT_MS} мс`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  if (!res.ok) throw new Error(describeOAuthError(res.status, body));

  const token = body as TokenResponse;
  if (!token || typeof token.access_token !== "string") {
    throw new Error("Яндекс OAuth вернул ответ без access_token.");
  }
  return token;
}

/**
 * Turns Yandex's `{ error, error_description }` envelope into advice. The three
 * codes below are the ones a user actually hits, and each needs a different
 * action — a bare "invalid_grant" would send them to re-check the wrong thing.
 */
function describeOAuthError(status: number, body: unknown): string {
  const obj = (body ?? {}) as Record<string, unknown>;
  const code = typeof obj.error === "string" ? obj.error : `HTTP ${status}`;
  const description = typeof obj.error_description === "string" ? obj.error_description : "";

  switch (code) {
    // Yandex answers a wrong or expired code with `bad_verification_code`, not the
    // `invalid_grant` the OAuth spec suggests — and since the code lives only 10
    // minutes, this is the single most likely failure of the whole flow.
    case "bad_verification_code":
    case "invalid_grant":
      return (
        "Код подтверждения не принят: он живёт 10 минут и одноразовый. " +
        "Запустите start_login заново и введите свежий код. " +
        (description ? `Ответ Яндекса: ${description}` : "")
      ).trim();
    case "invalid_client":
      return (
        "Яндекс OAuth не принял приложение (invalid_client). " +
        "Если задан YANDEX_METRIKA_OAUTH_CLIENT_ID — проверьте его; " +
        "приложение должно быть с Redirect URI https://oauth.yandex.ru/verification_code. " +
        (description ? `Ответ Яндекса: ${description}` : "")
      ).trim();
    case "unauthorized_client":
      return (
        "Приложение OAuth заблокировано или не прошло модерацию (unauthorized_client). " +
        (description ? `Ответ Яндекса: ${description}` : "")
      ).trim();
    default:
      return `Ошибка Яндекс OAuth: ${code}${description ? ` — ${description}` : ""}`;
  }
}
