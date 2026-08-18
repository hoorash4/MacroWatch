from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import requests
from google.auth.transport.requests import Request
from google.oauth2.service_account import Credentials


DRIVE_SCOPE = "https://www.googleapis.com/auth/drive"


def require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def main() -> int:
    if len(sys.argv) != 2:
        raise RuntimeError("Usage: upload_drive_backup.py <backup-file>")

    backup_path = Path(sys.argv[1])
    if not backup_path.is_file() or backup_path.stat().st_size == 0:
        raise RuntimeError(f"Backup file is missing or empty: {backup_path}")

    service_account = json.loads(require_env("GOOGLE_SERVICE_ACCOUNT_JSON"))
    credentials = Credentials.from_service_account_info(
        service_account,
        scopes=[DRIVE_SCOPE],
    )
    credentials.refresh(Request())

    file_id = require_env("GOOGLE_DRIVE_FILE_ID")
    response = requests.patch(
        f"https://www.googleapis.com/upload/drive/v3/files/{file_id}",
        params={"uploadType": "media", "fields": "id,name,modifiedTime,size"},
        headers={
            "Authorization": f"Bearer {credentials.token}",
            "Content-Type": "application/octet-stream",
        },
        data=backup_path.read_bytes(),
        timeout=120,
    )
    if not response.ok:
        raise RuntimeError(
            f"Google Drive upload failed: {response.status_code} {response.text[:1000]}"
        )

    result = response.json()
    print(
        "Google Drive backup updated: "
        f"{result.get('name', file_id)} ({result.get('size', '?')} bytes, "
        f"{result.get('modifiedTime', 'unknown time')})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

