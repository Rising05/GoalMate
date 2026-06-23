# Sensitive Data Encryption Runbook

## Data Classification

| Class | Fields | Protection |
| --- | --- | --- |
| High sensitive | `passwordHash`, WeChat `openId`/`unionId`, admin raw-view reasons, membership audit reasons | Password hash never exported; WeChat IDs encrypted plus HMAC blind index; admin reasons encrypted with audit trail |
| Sensitive user text | Goal description/baseline/constraints/reward, check-in content/mood/difficulty, score appeal reason/facts, reward description, failure report narrative | Application-layer AES-256-GCM with key version |
| Operational metadata | AI call logs, quota records, reminder status, upload lifecycle, aggregate metrics | Minimized fields, no full AI input, no key metadata in user export |

## Threat Model

- Database snapshot leakage must not reveal sensitive user text or WeChat identifiers without the application key.
- Admin raw-content access must require `SUPER_ADMIN`, a reason, and an audit log entry.
- AI providers must receive only the fields required for the current capability.
- User export must decrypt only the current user's data and must not include `*KeyVersion`, blind indexes, password hashes, or provider secrets.

## Key Configuration

Set `FIELD_ENCRYPTION_KEYS` in production:

```text
FIELD_ENCRYPTION_KEYS=v1:base64:<32-byte-base64-key>
FIELD_ENCRYPTION_ACTIVE_VERSION=v1
FIELD_ENCRYPTION_HASH_SECRET=base64:<32-byte-base64-key>
```

Keep old key versions in `FIELD_ENCRYPTION_KEYS` until every row using that version has been rotated.

## Migration

1. Apply Prisma migration `20260623090000_add_sensitive_data_encryption`.
2. Deploy the application with encryption keys configured.
3. Dry-run historical encryption:

```bash
npm exec -w @goalmate/api tsx src/security/encrypt-sensitive-fields.script.ts -- --dry-run
```

4. Run the migration script:

```bash
npm exec -w @goalmate/api tsx src/security/encrypt-sensitive-fields.script.ts
```

5. Verify a direct DB read shows `enc:<version>:` for covered fields and no full plaintext in `ai_jobs.payload`.

## Rollback

Do not drop key columns during rollback. The application decryptor is backward compatible with legacy plaintext and encrypted rows. If code rollback is required, keep `FIELD_ENCRYPTION_KEYS` available and pause the migration script; existing encrypted rows require the P1-2 compatible application to display plaintext.

## Rotation

1. Add new key to `FIELD_ENCRYPTION_KEYS`, for example `v1:...,v2:...`.
2. Set `FIELD_ENCRYPTION_ACTIVE_VERSION=v2`.
3. Redeploy.
4. Re-run the migration script to re-encrypt old rows with `v2`.
5. Remove `v1` only after all `*KeyVersion` values no longer reference it and backups containing `v1` ciphertext have expired.
