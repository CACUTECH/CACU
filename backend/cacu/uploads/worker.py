"""Disposable parser process; no files, network or user-controlled imports."""
import base64
import io
import json
import struct
import sys
import warnings
import zlib
from PIL import Image, ImageOps, PngImagePlugin
from .validation import POLICY


def clean_image(data, purpose, kind):
    rule = POLICY['purposes'][purpose]
    if kind == 'png':
        if not data.startswith(b'\x89PNG\r\n\x1a\n'):
            raise ValueError('signature')
        position, ended, chunks = 8, False, 0
        while position < len(data):
            chunks += 1
            if chunks > 2048 or position + 12 > len(data):
                raise ValueError('chunks')
            length = struct.unpack('>I', data[position:position+4])[0]
            name = data[position+4:position+8]
            stop = position+12+length
            if stop > len(data) or name in {b'acTL', b'fcTL', b'fdAT'}:
                raise ValueError('animated or malformed')
            if zlib.crc32(data[position+4:stop-4]) & 0xffffffff != struct.unpack('>I', data[stop-4:stop])[0]:
                raise ValueError('CRC')
            if name == b'IEND':
                if length or stop != len(data): raise ValueError('trailing payload')
                ended = True
            position = stop
        if not ended: raise ValueError('end marker')
    elif not (data.startswith(b'\xff\xd8\xff') and data.endswith(b'\xff\xd9')):
        raise ValueError('signature or trailing payload')
    PngImagePlugin.MAX_TEXT_CHUNK = 262144
    PngImagePlugin.MAX_TEXT_MEMORY = 1048576
    Image.MAX_IMAGE_PIXELS = rule['max_pixels']
    with warnings.catch_warnings():
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(data), formats=['PNG', 'JPEG']) as image:
            if image.format != POLICY['formats'][kind]['parser'] or getattr(image, 'n_frames', 1) != 1:
                raise ValueError('format')
            for value in image.info.values():
                raw = value.encode('utf-8', errors='ignore') if isinstance(value, str) else value if isinstance(value, bytes) else b''
                lowered = raw.lower()
                if any(marker in lowered for marker in [b'<script', b'<html', b'<svg', b'javascript:', b'<?php']) or raw.startswith((b'MZ', b'\x7fELF')):
                    raise ValueError('active metadata payload')
            width, height = image.size
            if not width or not height or max(width, height) > rule['max_dimension'] or width*height > rule['max_pixels']:
                raise ValueError('dimensions')
            image.verify()
        with Image.open(io.BytesIO(data), formats=['PNG', 'JPEG']) as image:
            image.load()
            image = ImageOps.exif_transpose(image)
            mode = 'RGBA' if kind == 'png' else 'RGB'
            # Fresh pixel-only image prevents propagating EXIF, text, profiles and other metadata.
            converted = image.convert(mode)
            fresh = Image.new(mode, converted.size)
            fresh.paste(converted)
            output = io.BytesIO()
            fresh.save(output, format=POLICY['formats'][kind]['parser'], **({'quality':90} if kind == 'jpg' else {}))
            cleaned = output.getvalue()
            if len(cleaned) > rule['max_bytes']: raise ValueError('output size')
            return cleaned


def main():
    try:
        if sys.platform != 'win32':
            import resource
            resource.setrlimit(resource.RLIMIT_AS, (384*1024*1024, 384*1024*1024))
            resource.setrlimit(resource.RLIMIT_CPU, (6, 6))
        header = sys.stdin.buffer.readline(256)
        params = json.loads(header)
        data = sys.stdin.buffer.read(3145729)
        if not 0 < len(data) <= POLICY['purposes'][params['purpose']]['max_bytes']: raise ValueError('size')
        cleaned = clean_image(data, params['purpose'], params['kind'])
        sys.stdout.buffer.write(json.dumps({'data':base64.b64encode(cleaned).decode()}).encode())
    except Exception:
        # Never emit parser messages, file metadata or bytes to logs.
        raise SystemExit(1)

if __name__ == '__main__': main()
