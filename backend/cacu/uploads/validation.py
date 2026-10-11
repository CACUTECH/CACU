"""One authoritative allowlist for Python and the Next.js upload proxy."""
import base64
import json
import re
import subprocess
import sys
import threading
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from fastapi import HTTPException

PARSER_SLOTS = threading.BoundedSemaphore(2)
POLICY = json.loads(Path(__file__).with_name('policy.json').read_text(encoding='utf-8'))

@dataclass(frozen=True)
class ApprovedFile:
    data: bytes
    extension: str
    mime: str
    filename: str

def file_info(purpose: str, filename: str, mime: str, size: int):
    rule = POLICY['purposes'].get(purpose)
    if not rule:
        raise HTTPException(422, 'Unknown upload purpose')
    if not 0 < size <= rule['max_bytes']:
        raise HTTPException(413, 'File exceeds the allowed size or is empty')
    if not filename or len(filename) > 200 or any(c in filename for c in '/\\') or any(unicodedata.category(c).startswith('C') for c in filename):
        raise HTTPException(422, 'Invalid filename')
    extension = filename.rsplit('.', 1)[-1].lower()
    kind = next((key for key, value in POLICY['formats'].items() if extension in value['extensions']), None)
    if not kind or mime.lower().strip() != POLICY['formats'][kind]['mime']:
        raise HTTPException(422, 'Only matching PNG and JPEG images are allowed')
    # Metadata only: ASCII, no controls, quotes, paths, bidirectional marks or active markup.
    safe = re.sub(r'[^A-Za-z0-9 ._-]', '_', unicodedata.normalize('NFKC', filename))[:120]
    safe = safe.strip(' .') or f'upload.{kind}'
    if not safe.lower().endswith(tuple('.'+x for x in POLICY['formats'][kind]['extensions'])):
        safe = safe[:100] + '.' + kind
    return rule, kind, safe

def validate_file(purpose: str, filename: str, mime: str, data: bytes) -> ApprovedFile:
    rule, kind, safe = file_info(purpose, filename, mime, len(data))
    header = json.dumps({'purpose': purpose, 'kind': kind}).encode() + b'\n'
    if not PARSER_SLOTS.acquire(timeout=1):
        raise HTTPException(429, 'Image processing is busy. Please retry.')
    try:
        result = subprocess.run([sys.executable, '-m', 'cacu.uploads.worker'], input=header+data,
                                capture_output=True, timeout=10, check=False,
                                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
        if result.returncode != 0:
            raise HTTPException(422, 'Malformed, mismatched or unsafe image')
        output = json.loads(result.stdout)
        cleaned = base64.b64decode(output['data'], validate=True)
        if not cleaned or len(cleaned) > rule['max_bytes']:
            raise HTTPException(413, 'Processed image exceeds the allowed size')
        return ApprovedFile(cleaned, kind, POLICY['formats'][kind]['mime'], safe)
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(422, 'Image processing limit exceeded') from exc
    except (ValueError, KeyError) as exc:
        raise HTTPException(422, 'Unable to validate image') from exc
    finally:
        PARSER_SLOTS.release()
