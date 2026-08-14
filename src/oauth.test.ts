import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  buildAuthorizeUrl,
  clearPendingLogin,
  createPkce,
  exchangeCode,
  pendingLogin,
  refreshTokens,
  SCOPE,
  startLogin,
  VERIFICATION_REDIRECT,
} from "./oauth.js";

/** A fetch stand-in that records the form it was posted and replies with `reply`. */
function fakeFetch(reply: { status?: number; body: unknown }): {
  impl: typeof fetch;
  calls: Array<{ url: string; form: URLSearchParams }>;
} {
  const calls: Array<{ url: string; form: URLSearchParams }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), form: new URLSearchParams(String(init.body)) });
    return {
      ok: (reply.status ?? 200) < 400,
      status: reply.status ?? 200,
      text: async () => JSON.stringify(reply.body),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("the PKCE challenge is the S256 digest of the verifier", () => {
  const { verifier, challenge } = createPkce();
  assert.equal(challenge, createHash("sha256").update(verifier).digest("base64url"));
  // RFC 7636 requires 43..128 chars; 32 random bytes in base64url land on 43.
  assert.ok(verifier.length >= 43 && verifier.length <= 128, `verifier length ${verifier.length}`);
  assert.notEqual(verifier, challenge, "the verifier must never travel as the challenge");
});

test("two logins never reuse a verifier", () => {
  assert.notEqual(createPkce().verifier, createPkce().verifier);
});

test("the authorize URL asks for a code with S256 and the verification_code redirect", () => {
  const url = new URL(buildAuthorizeUrl({ clientId: "cid", challenge: "chal", state: "st" }));
  assert.equal(url.origin + url.pathname, "https://oauth.yandex.ru/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "cid");
  assert.equal(url.searchParams.get("code_challenge"), "chal");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), "st");
  // Without this redirect Yandex bounces to the app's registered callback and the
  // user never sees a code to paste back.
  assert.equal(url.searchParams.get("redirect_uri"), VERIFICATION_REDIRECT);
  // Omitting scope would hand out a token with every right the app holds — today
  // that is the same thing, but it stops being true the moment the app gains one.
  assert.equal(url.searchParams.get("scope"), SCOPE);
  assert.equal(url.searchParams.get("force_confirm"), "yes");
});

test("the pending login expires with the code it belongs to", () => {
  const t0 = 1_000_000;
  startLogin(t0);
  assert.ok(pendingLogin(t0 + 9 * 60_000), "still valid at 9 minutes");
  assert.equal(pendingLogin(t0 + 11 * 60_000), undefined, "gone at 11 minutes");
  clearPendingLogin();
});

test("starting a second login discards the first verifier", () => {
  const first = startLogin(1_000);
  const second = startLogin(2_000);
  assert.notEqual(first.state, second.state);
  assert.equal(pendingLogin(2_000)?.state, second.state);
  clearPendingLogin();
});

test("the code exchange sends the verifier and no client_secret", async () => {
  const { impl, calls } = fakeFetch({ body: { access_token: "a", refresh_token: "r", expires_in: 60 } });
  const result = await exchangeCode({
    code: "code-123",
    verifier: "ver-456",
    clientId: "cid",
    fetchImpl: impl,
  });

  assert.equal(result.access_token, "a");
  assert.equal(calls[0].url, "https://oauth.yandex.ru/token");
  assert.equal(calls[0].form.get("grant_type"), "authorization_code");
  assert.equal(calls[0].form.get("code"), "code-123");
  assert.equal(calls[0].form.get("code_verifier"), "ver-456");
  // The whole point of PKCE here: a public client ships no secret, so there is
  // nothing in the npm package worth extracting.
  assert.equal(calls[0].form.get("client_secret"), null);
});

test("a refresh posts the refresh token, still without a secret", async () => {
  const { impl, calls } = fakeFetch({ body: { access_token: "fresh" } });
  const result = await refreshTokens({ refreshToken: "rt", clientId: "cid", fetchImpl: impl });

  assert.equal(result.access_token, "fresh");
  assert.equal(calls[0].form.get("grant_type"), "refresh_token");
  assert.equal(calls[0].form.get("refresh_token"), "rt");
  assert.equal(calls[0].form.get("client_secret"), null);
});

test("an expired code explains that it is one-shot and 10 minutes long", async () => {
  const { impl } = fakeFetch({
    status: 400,
    body: { error: "invalid_grant", error_description: "Code has expired" },
  });
  await assert.rejects(
    () => exchangeCode({ code: "old", verifier: "v", clientId: "c", fetchImpl: impl }),
    /10 минут.*start_login/s,
  );
});

/**
 * What Yandex actually returns for a wrong or expired code — verified against the
 * live endpoint. Handling only the spec's `invalid_grant` sent the most common
 * failure of the whole flow (the code expires in 10 minutes) to the generic
 * branch, which relays "Invalid code" without saying a fresh one is needed.
 */
test("bad_verification_code gets the same advice as invalid_grant", async () => {
  const { impl } = fakeFetch({
    status: 400,
    body: { error: "bad_verification_code", error_description: "Invalid code" },
  });
  await assert.rejects(
    () => exchangeCode({ code: "nope", verifier: "v", clientId: "c", fetchImpl: impl }),
    /10 минут.*start_login/s,
  );
});

test("a bad app id is not reported as a bad code", async () => {
  const { impl } = fakeFetch({ status: 400, body: { error: "invalid_client" } });
  await assert.rejects(
    () => exchangeCode({ code: "c", verifier: "v", clientId: "wrong", fetchImpl: impl }),
    /invalid_client/,
  );
});

test("a 200 without an access_token is still a failure", async () => {
  const { impl } = fakeFetch({ body: { token_type: "bearer" } });
  await assert.rejects(
    () => exchangeCode({ code: "c", verifier: "v", clientId: "c", fetchImpl: impl }),
    /без access_token/,
  );
});
