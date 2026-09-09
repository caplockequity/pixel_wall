"""Original fixture transformer using the published Aseprite file specification.

After running external-tileset-source.lua twice with mode=rgba/indexed and
output=<directory>/<mode>-source.aseprite, run this script on that directory.
It assigns source native tileset ID 91 and writes a spec-valid external-only
reference using destination ID 47 and external resource registry ID 19.
No Aseprite implementation source is used.
"""
from pathlib import Path
import struct
import sys


def u16(data, at):
    return struct.unpack_from('<H', data, at)[0]


def u32(data, at):
    return struct.unpack_from('<I', data, at)[0]


def chunk(kind, data):
    return struct.pack('<IH', len(data) + 6, kind) + data


def transform(original, mode, external=False):
    frames, pos, found = [], 128, False
    for _ in range(u16(original, 6)):
        end = pos + u32(original, pos)
        header, chunks, at = bytearray(original[pos:pos + 16]), [], pos + 16
        while at < end:
            length, kind = u32(original, at), u16(original, at + 4)
            data = original[at + 6:at + length]
            at += length
            if kind == 0x2023:
                name_length = u16(data, 32)
                if data[34:34 + name_length].decode() == 'terrain':
                    found = True
                    data = struct.pack('<I', 91) + data[4:]
                    if external:
                        prefix = bytearray(data[:34 + name_length])
                        struct.pack_into('<I', prefix, 0, 47)
                        struct.pack_into('<I', prefix, 4, (u32(data, 4) & ~2) | 1)
                        data = bytes(prefix) + struct.pack('<II', 19, 91)
                        name = (mode + '-source.aseprite').encode()
                        registry = struct.pack('<I', 1) + bytes(8) + struct.pack('<IB', 19, 1) + bytes(7) + struct.pack('<H', len(name)) + name
                        chunks.append(chunk(0x2008, registry))
            chunks.append(chunk(kind, data))
        body = b''.join(chunks)
        struct.pack_into('<I', header, 0, len(body) + 16)
        struct.pack_into('<H', header, 6, len(chunks))
        struct.pack_into('<I', header, 12, len(chunks))
        frames.append(bytes(header) + body)
        pos = end
    if not found:
        raise ValueError('Original fixture must contain the terrain tileset')
    result = bytearray(original[:128] + b''.join(frames))
    struct.pack_into('<I', result, 0, len(result))
    return result


if __name__ == '__main__':
    directory = Path(sys.argv[1])
    for mode in ('rgba', 'indexed'):
        source = directory / (mode + '-source.aseprite')
        embedded = transform(source.read_bytes(), mode)
        source.write_bytes(embedded)
        (directory / (mode + '-external.aseprite')).write_bytes(transform(embedded, mode, True))
