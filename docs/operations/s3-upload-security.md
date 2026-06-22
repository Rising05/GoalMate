# S3 Upload and Malware-Scanning Operations

## Production configuration

Set `UPLOAD_STORAGE_PROVIDER=S3`, `FILE_SCANNER_PROVIDER=CLAMAV`, `UPLOAD_SCAN_ASYNC=true`, `BULLMQ_ENABLED=true`, and provide the S3/ClamAV variables from `.env.example`. Production startup rejects local storage, the mock scanner, or synchronous/no-queue scanning.

The S3 bucket must be private with block-public-access enabled. Grant the application role only `s3:PutObject`, `s3:GetObject`, `s3:HeadObject`, `s3:DeleteObject`, and `s3:ListBucket` for the configured evidence prefix. Enable server-side encryption, bucket versioning, access logging, and a lifecycle rule for noncurrent/deleted objects. Access keys belong in the deployment secret manager, never `.env` committed to Git.

For browser direct uploads, configure bucket CORS for the exact Web origins:

```json
[
  {
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type", "x-amz-checksum-sha256"],
    "ExposeHeaders": ["etag", "x-amz-checksum-sha256"],
    "MaxAgeSeconds": 900
  }
]
```

S3-compatible OSS/COS endpoints can be used through `S3_ENDPOINT`, region, and path-style settings, but must pass the same checksum, private-bucket, signed-download, deletion, and versioning tests before deployment.

## State machine

`PENDING_UPLOAD` -> completion callback -> `UPLOADED/PENDING` -> Worker `SCANNING` -> `READY/CLEAN`, `QUARANTINED/INFECTED`, or `SCAN_FAILED/FAILED`.

Only `READY/CLEAN` assets can be downloaded or attached to a check-in. Completion validates provider-reported length/type/checksum, downloads the private object for structured magic-byte/image/PDF validation, then queues ClamAV. Scan timeout or scanner errors never default to clean.

Deletion uses `DELETION_PENDING` -> `DELETED` or `DELETE_FAILED`. Cleanup retries deletion, expires abandoned uploads, retries bounded failed scans, removes quarantined objects after retention, and deletes old storage objects that have no database record. Run cleanup with the scheduler or audited `POST /admin/upload-assets/cleanup`.

## Incident handling

- A spike in `QUARANTINED`, `SCAN_FAILED`, or `DELETE_FAILED` is an incident signal. Do not manually mark assets clean.
- Keep infected objects private and inaccessible. Preserve only for the configured short quarantine retention, then delete through the cleanup worker.
- Rotate S3 credentials after suspected leakage and inspect bucket access logs by object key and trace ID.
- If ClamAV signatures are stale or unavailable, pause new evidence acceptance rather than bypass scanning.
