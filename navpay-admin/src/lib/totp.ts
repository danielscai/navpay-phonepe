import { generateSecret, generateURI, verifySync } from "otplib";

export function generateTotpSecret(): string {
  return generateSecret();
}

export function buildOtpAuthUrl(opts: {
  issuer: string;
  accountName: string;
  secret: string;
}): string {
  return generateURI({
    strategy: "totp",
    issuer: opts.issuer,
    // Label shown in Google Authenticator
    label: `${opts.issuer}:${opts.accountName}`,
    secret: opts.secret,
    algorithm: "sha1",
    digits: 6,
    period: 30,
  });
}

export function verifyTotpCode(secret: string, token: string): boolean {
  const res = verifySync({
    strategy: "totp",
    secret,
    token,
    algorithm: "sha1",
    digits: 6,
    period: 30,
    // Allow small clock skew (+/- 1 step).
    epochTolerance: 30,
  });
  return res.valid === true;
}
