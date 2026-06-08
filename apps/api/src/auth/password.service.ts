import { Injectable } from "@nestjs/common";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const ITERATIONS = 210_000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";

@Injectable()
export class PasswordService {
  hash(password: string) {
    const salt = randomBytes(16).toString("base64url");
    const derivedKey = pbkdf2Sync(
      password,
      salt,
      ITERATIONS,
      KEY_LENGTH,
      DIGEST
    ).toString("base64url");

    return `pbkdf2$${ITERATIONS}$${salt}$${derivedKey}`;
  }

  verify(password: string, storedHash: string) {
    const [scheme, iterationsRaw, salt, expectedKey] = storedHash.split("$");

    if (scheme !== "pbkdf2" || !iterationsRaw || !salt || !expectedKey) {
      return false;
    }

    const iterations = Number(iterationsRaw);

    if (!Number.isInteger(iterations) || iterations <= 0) {
      return false;
    }

    const actual = pbkdf2Sync(
      password,
      salt,
      iterations,
      KEY_LENGTH,
      DIGEST
    );
    const expected = Buffer.from(expectedKey, "base64url");

    return expected.length === actual.length && timingSafeEqual(actual, expected);
  }
}

