import { createRemoteJWKSet, jwtVerify } from "jose";

const jwksByDomain = new Map();

function normalizedTeamDomain(value) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("CF_ACCESS_TEAM_DOMAIN is required");
  const withProtocol = raw.includes("://") ? raw : `https://${raw}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".cloudflareaccess.com")) {
    throw new Error("CF_ACCESS_TEAM_DOMAIN must be a cloudflareaccess.com HTTPS domain");
  }
  return url.hostname;
}

function remoteJwks(teamDomain) {
  let jwks = jwksByDomain.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksByDomain.set(teamDomain, jwks);
  }
  return jwks;
}

export async function verifyAccessJwt(token, options) {
  const teamDomain = normalizedTeamDomain(options.teamDomain);
  const audience = String(options.audience ?? "").trim();
  if (!token) throw new Error("Cloudflare Access token is missing");
  if (!audience) throw new Error("CF_ACCESS_AUD is required");

  const { payload } = await jwtVerify(
    token,
    options.jwks ?? remoteJwks(teamDomain),
    {
      issuer: `https://${teamDomain}`,
      audience,
      clockTolerance: 5,
    },
  );
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email) throw new Error("Cloudflare Access token does not contain an email");

  return {
    userId: typeof payload.sub === "string" && payload.sub ? payload.sub : `email:${email}`,
    email,
    displayName: email,
    fullName: null,
  };
}

export async function accessUserFromHeaders(requestHeaders, options) {
  const token = requestHeaders.get("cf-access-jwt-assertion");
  if (!token) return null;

  const user = await verifyAccessJwt(token, options);
  const forwardedEmail = requestHeaders.get("cf-access-authenticated-user-email")?.trim().toLowerCase();
  if (forwardedEmail && forwardedEmail !== user.email) {
    throw new Error("Cloudflare Access identity headers do not match");
  }
  return user;
}
