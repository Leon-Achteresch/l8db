import hashlib
import json
import struct
import zlib
from collections import Counter
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile

root = Path(__file__).resolve().parent
manifest_path = root / 'manifest.json'
manifest = json.loads(manifest_path.read_text())
images = manifest['images']
ux = json.loads((root / 'ux-principles.json').read_text())
assert len(ux['principles']) == 30
assert len({principle['slug'] for principle in ux['principles']}) == 30
law_ids = {principle['slug'] for principle in ux['principles']}
assert all(set(image['lawIds']).issubset(law_ids) for image in images)
assert all((root / image['reference']).is_file() for image in images)
assert all(image['prompt'] and image['idea'] for image in images)
assert len(images) == 100
assert len({image['id'] for image in images}) == 100
assert sorted(Counter(image['style'] for image in images).values()) == [5] * 20
assert sorted(Counter(image['view'] for image in images).values()) == [5] * 20
assert len(list((root / 'images').glob('*.png'))) == 100
records = []
hashes = set()
for image in images:
    path = root / image['file']
    content = path.read_bytes()
    assert content[:8] == b'\x89PNG\r\n\x1a\n', image['id']
    position = 8
    compressed = []
    chunks = []
    while position < len(content):
        size = struct.unpack('>I', content[position:position + 4])[0]
        kind = content[position + 4:position + 8]
        payload = content[position + 8:position + 8 + size]
        checksum = struct.unpack('>I', content[position + 8 + size:position + 12 + size])[0]
        assert zlib.crc32(kind + payload) & 0xffffffff == checksum, image['id']
        if kind == b'IHDR':
            width, height = struct.unpack('>II', payload[:8])
            assert width >= 1000 and height >= 600, image['id']
        if kind == b'IDAT':
            compressed.append(payload)
        chunks.append(kind)
        position += size + 12
    assert chunks[-1] == b'IEND', image['id']
    assert zlib.decompress(b''.join(compressed)), image['id']
    digest = hashlib.sha256(content).hexdigest()
    assert digest not in hashes, image['id']
    hashes.add(digest)
    image['status'] = 'completed'
    image.pop('originalPath', None)
    image['width'] = width
    image['height'] = height
    image['bytes'] = len(content)
    image['sha256'] = digest
    records.append({'id': image['id'], 'file': image['file'], 'width': width, 'height': height, 'bytes': len(content), 'sha256': digest})

assert len(list((root / 'thumbnails').glob('*.jpg'))) == 100
manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
validation = {'imageCount': len(records), 'uniqueImages': len(hashes), 'styleCount': 20, 'imagesPerStyle': 5, 'viewCount': 20, 'imagesPerView': 5, 'previewCount': 100, 'method': 'built-in image_gen', 'pngIntegrity': 'passed', 'uxPrinciplesConsidered': 30, 'uxReview': 'Design criteria only; interaction and accessibility need implementation testing', 'images': records}
validation['themes'] = dict(Counter(image['tone'] for image in images))
validation['references'] = sorted({image['reference'] for image in images})
(root / 'validation.json').write_text(json.dumps(validation, indent=2, ensure_ascii=False) + '\n')
with (root / 'catalogue.csv').open('w') as handle:
    handle.write('id,design,view,tone,concept,file,width,height\n')
    for image in images:
        handle.write(','.join(str(image[key]) for key in ['id', 'style', 'view', 'tone', 'level', 'file', 'width', 'height']) + '\n')

archive = root / 'l8db-corporate-100-designs.zip'
with ZipFile(archive, 'w', compression=ZIP_STORED) as bundle:
    for path in sorted(root.rglob('*')):
        if not path.is_file() or path == archive or path.name.startswith('batch-') or path.name.endswith('.local') or path.name.startswith('.'):
            continue
        bundle.write(path, 'l8db-corporate-100-designs/' + str(path.relative_to(root)))
with ZipFile(archive) as bundle:
    assert len([name for name in bundle.namelist() if '/images/' in name and name.endswith('.png')]) == 100
    assert bundle.testzip() is None
print(json.dumps({'images': len(records), 'unique': len(hashes), 'styles': 20, 'views': 20, 'imageBytes': sum(record['bytes'] for record in records), 'archive': str(archive), 'archiveBytes': archive.stat().st_size}))
