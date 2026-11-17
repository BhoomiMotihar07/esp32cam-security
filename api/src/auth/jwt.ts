/** HS256 JWTs. The payload carries only the user id; role and household are re-read per request. */
import { SignJWT, jwtVerify } from "jose";

const ISSUER = "esp32cam-security";
const TTL = "7d";

export async function signToken(userId: string, secret: string): Promise<string> {
  return new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuer(ISSUER).setIssuedAt().setExpirationTime(TTL).sign(new TextEncoder().encode(secret));
}

export async function verifyToken(token: string, secret: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { issuer: ISSUER });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
