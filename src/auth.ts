import {
  clearCredentials,
  credentialsPath,
  readCredentials,
  writeCredentials,
  type StoredCredentials,
} from "./credentials.js";
import { oauthClientId, refreshTokens, type TokenResponse } from "./oauth.js";

/**
 * Raised when a tool needs a token and none is available. The message is the
 * whole point of the class: it is what the calling model reads and relays, so
 * it names the fix instead of the failure.
 */
export class AuthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthRequiredError";
  }
}

/** Refresh this long before the stated expiry, so a call never races the clock. */
const REFRESH_LEEWAY_MS = 60_000;

export type TokenSource = "env" | "stored";

export interface AuthStatus {
  configured: boolean;
  source?: TokenSource;
  /** ISO date the stored access token expires; absent for env tokens. */
  expiresAt?: string;
  /** ISO date the stored token was obtained. */
  obtainedAt?: string;
  canRefresh: boolean;
  path: string;
}

export const NOT_CONNECTED_MESSAGE =
  "Яндекс Метрика не подключена: нет токена доступа. " +
  "Это не сбой сети — повторный вызов не поможет, нужно подключение. " +
  "Вызовите инструмент start_login, покажите пользователю ссылку, попросите войти " +
  "под аккаунтом с доступом к нужным счётчикам и прислать код подтверждения, " +
  "затем передайте этот код в finish_login. " +
  "Альтернатива без диалога — задать переменную окружения YANDEX_METRIKA_TOKEN в конфиге клиента.";

/**
 * Resolves the access token for every request. Two sources, in this order:
 *
 *   env    — YANDEX_METRIKA_TOKEN, the documented setup; never touched or refreshed
 *   stored — ~/.config/mcp-yandex-metrica/credentials.json, written by finish_login
 *
 * env wins so an explicitly configured install (and CI) behaves exactly as before,
 * and the file is re-read on every call — that is what lets a login take effect
 * mid-session without restarting the client.
 */
export class TokenStore {
  constructor(
    private readonly envToken?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** True when a token exists without touching the network. */
  hasToken(): boolean {
    return Boolean(this.envToken) || Boolean(readCredentials());
  }

  async getToken(): Promise<string> {
    if (this.envToken) return this.envToken;

    const stored = readCredentials();
    if (!stored) throw new AuthRequiredError(NOT_CONNECTED_MESSAGE);

    if (!isExpired(stored)) return stored.access_token;

    if (!stored.refresh_token) {
      throw new AuthRequiredError(
        "Срок действия сохранённого токена Метрики истёк, а обновить его нечем. " +
          "Вызовите start_login и пройдите подключение заново.",
      );
    }
    const refreshed = await this.refresh(stored.refresh_token);
    return refreshed.access_token;
  }

  /**
   * Re-mints the access token from the stored refresh token. Called on expiry and
   * once more when the API answers 401/403 — a token can be revoked in Yandex ID
   * long before `expires_at`, and only the API knows that.
   */
  async refresh(refreshToken?: string): Promise<StoredCredentials> {
    const token = refreshToken ?? readCredentials()?.refresh_token;
    if (!token) {
      throw new AuthRequiredError(
        "Нет refresh-токена для обновления доступа — вызовите start_login заново.",
      );
    }
    const response = await refreshTokens({
      refreshToken: token,
      clientId: oauthClientId(),
      fetchImpl: this.fetchImpl,
    });
    return this.save(response);
  }

  /** True when a stored refresh token exists — i.e. a retry after 401 is worth trying. */
  canRefresh(): boolean {
    return !this.envToken && Boolean(readCredentials()?.refresh_token);
  }

  /** Persists a token response; returns what was stored (never logged). */
  save(response: TokenResponse, now = Date.now()): StoredCredentials {
    const credentials: StoredCredentials = {
      access_token: response.access_token,
      refresh_token: response.refresh_token,
      expires_at: response.expires_in ? now + response.expires_in * 1000 : undefined,
      obtained_at: now,
    };
    writeCredentials(credentials);
    return credentials;
  }

  logout(): boolean {
    return clearCredentials();
  }

  status(): AuthStatus {
    const stored = readCredentials();
    const path = credentialsPath();
    if (this.envToken) {
      return { configured: true, source: "env", canRefresh: false, path };
    }
    if (!stored) return { configured: false, canRefresh: false, path };
    return {
      configured: true,
      source: "stored",
      expiresAt: stored.expires_at ? new Date(stored.expires_at).toISOString() : undefined,
      obtainedAt: new Date(stored.obtained_at).toISOString(),
      canRefresh: Boolean(stored.refresh_token),
      path,
    };
  }
}

function isExpired(stored: StoredCredentials, now = Date.now()): boolean {
  if (!stored.expires_at) return false;
  return stored.expires_at - REFRESH_LEEWAY_MS <= now;
}
