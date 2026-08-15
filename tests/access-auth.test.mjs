import assert from "node:assert/strict";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { accessUserFromHeaders, verifyAccessJwt } from "../lib/access-auth.mjs";

const issuer = "https://team.cloudflareaccess.com";
const audience = "access-audience";
const { privateKey, publicKey } = await generateKeyPair("RS256");
const publicJwk = { ...(await exportJWK(publicKey)), alg: "RS256", kid: "test-key", use: "sig" };
const jwks = createLocalJWKSet({ keys: [publicJwk] });

async function token(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: "Owner@Example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setSubject("access-user")
    .setIssuer(issuer)
    .setAudience(overrides.audience ?? audience)
    .setIssuedAt(now)
    .setExpirationTime(overrides.expiresAt ?? now + 300)
    .sign(privateKey);
}

test("valid Cloudflare Access JWT yields a normalized user", async () => {
  const user = await verifyAccessJwt(await token(), { teamDomain: issuer, audience, jwks });
  assert.deepEqual(user, { userId: "access-user", email: "owner@example.com", displayName: "owner@example.com", fullName: null });
});

test("expired and wrong-audience Access JWTs are rejected", async () => {
  await assert.rejects(() => token({ expiresAt: 1 }).then((jwt) => verifyAccessJwt(jwt, { teamDomain: issuer, audience, jwks })));
  await assert.rejects(() => token({ audience: "wrong" }).then((jwt) => verifyAccessJwt(jwt, { teamDomain: issuer, audience, jwks })));
});

test("a forged email header without a valid JWT is ignored", async () => {
  const nakedHeaders = new Headers({ "cf-access-authenticated-user-email": "owner@example.com" });
  assert.equal(await accessUserFromHeaders(nakedHeaders, { teamDomain: issuer, audience, jwks }), null);

  const mismatched = new Headers({
    "cf-access-jwt-assertion": await token(),
    "cf-access-authenticated-user-email": "attacker@example.com",
  });
  await assert.rejects(() => accessUserFromHeaders(mismatched, { teamDomain: issuer, audience, jwks }), /do not match/);
});
