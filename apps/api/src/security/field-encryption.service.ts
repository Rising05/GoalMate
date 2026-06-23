import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";

export interface EncryptedField {
  ciphertext: string;
  keyVersion: string;
}

export interface NullableEncryptedField {
  ciphertext: string | null;
  keyVersion: string;
}

type KeyMap = Map<string, Buffer>;

const PREFIX = "enc";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

@Injectable()
export class FieldEncryptionService {
  private readonly keys: KeyMap;
  private readonly activeVersion: string;
  private readonly hashSecret: Buffer;

  constructor() {
    this.keys = this.loadKeys();
    this.activeVersion =
      process.env.FIELD_ENCRYPTION_ACTIVE_VERSION?.trim() ||
      Array.from(this.keys.keys())[0] ||
      "v1";
    this.hashSecret = this.loadHashSecret();
  }

  get activeKeyVersion() {
    return this.activeVersion;
  }

  encrypt(value: string): EncryptedField {
    const plaintext = value.trim();
    if (!plaintext) {
      return { ciphertext: plaintext, keyVersion: this.activeVersion };
    }

    if (this.isEncrypted(plaintext)) {
      return {
        ciphertext: plaintext,
        keyVersion: this.getKeyVersion(plaintext) ?? this.activeVersion
      };
    }

    const key = this.getKey(this.activeVersion);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      ciphertext: [
        PREFIX,
        this.activeVersion,
        this.toBase64Url(iv),
        this.toBase64Url(tag),
        this.toBase64Url(encrypted)
      ].join(":"),
      keyVersion: this.activeVersion
    };
  }

  encryptNullable(value: string | null | undefined): NullableEncryptedField {
    if (value === null || value === undefined) {
      return { ciphertext: null, keyVersion: this.activeVersion };
    }

    return this.encrypt(value);
  }

  decrypt(value: string): string {
    if (!this.isEncrypted(value)) {
      return value;
    }

    const parts = value.split(":");
    if (parts.length !== 5) {
      throw new Error("Encrypted field format is invalid");
    }

    const [, version, encodedIv, encodedTag, encodedCiphertext] = parts;
    const decipher = createDecipheriv(
      ALGORITHM,
      this.getKey(version),
      this.fromBase64Url(encodedIv),
      { authTagLength: TAG_BYTES }
    );
    decipher.setAuthTag(this.fromBase64Url(encodedTag));

    return Buffer.concat([
      decipher.update(this.fromBase64Url(encodedCiphertext)),
      decipher.final()
    ]).toString("utf8");
  }

  decryptNullable(value: string | null | undefined): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    return this.decrypt(value);
  }

  isEncrypted(value: string | null | undefined): value is string {
    return typeof value === "string" && value.startsWith(`${PREFIX}:`);
  }

  getKeyVersion(value: string | null | undefined): string | null {
    if (!this.isEncrypted(value)) {
      return null;
    }

    return value.split(":")[1] || null;
  }

  blindIndex(value: string | null | undefined): string | null {
    const normalized = this.normalize(value);
    if (!normalized) {
      return null;
    }

    return createHmac("sha256", this.hashSecret).update(normalized).digest("hex");
  }

  normalize(value: string | null | undefined) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  }

  private getKey(version: string) {
    const key = this.keys.get(version);
    if (!key) {
      throw new Error(`Field encryption key is not configured for version ${version}`);
    }

    return key;
  }

  private loadKeys(): KeyMap {
    const raw = process.env.FIELD_ENCRYPTION_KEYS?.trim();
    const keys = new Map<string, Buffer>();

    if (raw) {
      for (const pair of raw.split(",")) {
        const separator = pair.indexOf(":");
        if (separator <= 0) {
          continue;
        }
        const version = pair.slice(0, separator).trim();
        const encodedKey = pair.slice(separator + 1).trim();
        if (!version || !encodedKey) {
          continue;
        }
        keys.set(version, this.decodeKey(encodedKey));
      }
    }

    const legacyKey = process.env.FIELD_ENCRYPTION_KEY_V1?.trim();
    if (legacyKey && !keys.has("v1")) {
      keys.set("v1", this.decodeKey(legacyKey));
    }

    if (!keys.size && process.env.NODE_ENV !== "production") {
      keys.set("v1", Buffer.alloc(32, 7));
    }

    if (!keys.size) {
      throw new Error("FIELD_ENCRYPTION_KEYS is required in production");
    }

    return keys;
  }

  private loadHashSecret() {
    const raw =
      process.env.FIELD_ENCRYPTION_HASH_SECRET?.trim() ||
      process.env.FIELD_ENCRYPTION_KEY_V1?.trim();

    if (raw) {
      return this.decodeKey(raw);
    }

    if (process.env.NODE_ENV === "production") {
      throw new Error("FIELD_ENCRYPTION_HASH_SECRET is required in production");
    }

    return Buffer.alloc(32, 11);
  }

  private decodeKey(value: string) {
    const key = value.startsWith("base64:")
      ? Buffer.from(value.slice("base64:".length), "base64")
      : Buffer.from(value, "base64");

    if (key.length !== 32) {
      throw new Error("Field encryption keys must decode to 32 bytes");
    }

    return key;
  }

  private toBase64Url(value: Buffer) {
    return value.toString("base64url");
  }

  private fromBase64Url(value: string) {
    return Buffer.from(value, "base64url");
  }
}
