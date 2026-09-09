"""Original CC0 ICC v2 test profile: D50-adapted sRGB primaries, linear TRCs.
Independent fixture generator; does not import PixelWall or Aseprite code.
"""
from pathlib import Path
from struct import pack

def fixed(v):
    return pack('>i', round(v * 65536))

def xyz(*values):
    return b'XYZ ' + bytes(4) + b''.join(fixed(v) for v in values)

label = b'Original audit linear RGB\0'
desc = b'desc' + bytes(4) + pack('>I', len(label)) + label + bytes(78)
curve = b'curv' + bytes(4) + pack('>IH', 1, 256) + bytes(2)
tags = [('desc', desc), ('wtpt', xyz(.9642, 1, .8249)),
        ('rXYZ', xyz(.4360747, .2225045, .0139322)),
        ('gXYZ', xyz(.3850649, .7168786, .0971045)),
        ('bXYZ', xyz(.1430804, .0606169, .7141733)),
        ('rTRC', curve), ('gTRC', curve), ('bTRC', curve),
        ('cprt', b'text' + bytes(4) + b'Original numerical fixture. CC0.\0')]
body = bytearray(132 + len(tags) * 12)
body[8:12] = pack('>I', 0x02100000)
for offset, text in [(12, b'mntr'), (16, b'RGB '), (20, b'XYZ '), (36, b'acsp'), (40, b'APPL'), (80, b'TEST')]:
    body[offset:offset + 4] = text
body[24:36] = pack('>6H', 2026, 9, 9, 0, 0, 0)
body[68:80] = b''.join(fixed(v) for v in [.9642, 1, .8249])
body[128:132] = pack('>I', len(tags))
for i, (signature, data) in enumerate(tags):
    offset = 132 + i * 12
    body[offset:offset + 12] = signature.encode('ascii') + pack('>II', len(body), len(data))
    body.extend(data)
    body.extend(bytes((-len(body)) % 4))
body[0:4] = pack('>I', len(body))
Path(__file__).with_name('linear.icc').write_bytes(body)
