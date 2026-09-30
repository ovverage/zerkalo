"""Reconstruct a locally signed APK without moving its private signing key.

The delta carries original signed bytes and copy ranges from a previous public
APK. Both the base and the completed output are checked with SHA-256. The target
hash and length are pinned independently in android-release.json.
"""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

base_path, delta_path, output_path = map(Path, sys.argv[1:])
expected = json.loads((Path(__file__).parent / 'android-release.json').read_text())
base = base_path.read_bytes()
with zipfile.ZipFile(delta_path) as archive:
    if archive.getinfo('recipe.json').file_size > 1_000_000 or archive.getinfo('literal.bin').file_size > expected['sizeBytes']:
        raise ValueError('Unexpected delta size')
    recipe = json.loads(archive.read('recipe.json'))
    literal = archive.read('literal.bin')
if hashlib.sha256(base).hexdigest() != recipe['baseSha256']:
    raise ValueError('Base APK hash mismatch')
if recipe['targetSha256'] != expected['sha256'] or recipe['size'] != expected['sizeBytes']:
    raise ValueError('Delta does not match the configured release')
result = bytearray()
for kind, start, length in recipe['segments']:
    if kind not in ('copy', 'literal') or type(start) is not int or type(length) is not int:
        raise ValueError('Invalid segment')
    source = base if kind == 'copy' else literal
    if start < 0 or length < 0 or start + length > len(source) or len(result) + length > expected['sizeBytes']:
        raise ValueError('Invalid segment range')
    result.extend(source[start:start + length])
if len(result) != expected['sizeBytes'] or hashlib.sha256(result).hexdigest() != expected['sha256']:
    raise ValueError('Reconstructed APK hash mismatch')
output_path.write_bytes(result)
output_path.with_suffix(output_path.suffix + '.sha256').write_text(f"{expected['sha256']}  {output_path.name}\n")
print(f'PASS: reconstructed {len(result)} signed bytes; SHA-256 {expected["sha256"]}')
