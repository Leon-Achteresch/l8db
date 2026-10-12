import json
from pathlib import Path

root = Path(__file__).resolve().parent
path = root / 'manifest.json'
manifest = json.loads(path.read_text())
started = set(range(101, 105)) | set(range(123, 131)) | set(range(149, 157)) | set(range(175, 183))
for image in manifest['images']:
    if int(image['id']) in started or 'paletteRefinement' in image:
        continue
    if image['tone'] == 'Hell':
        palette = 'Light primary button fill must be muted dark steel/slate #425d76, with white label; selection fill #e3e8ed, underline #647d92.'
    else:
        palette = 'Dark primary button fill must be desaturated pale steel #b5c5d5, with dark ink label; selection fill #243442, underline #9cafbf.'
    constraint = 'HIGHEST PRIORITY CORPORATE COLOR LOCK: reference colors are deliberately almost neutral. '+palette+' Use these muted gray-blue colors for ALL primary buttons, active tabs, selection borders and workflow accents. Never use saturated cobalt, royal blue, electric blue or cyan buttons/underlines. Keep SQL keywords restrained muted blue too. The result must look like the SAME l8db brand as the real screenshot, with a different useful layout.'
    image['paletteRefinement'] = constraint
    image['prompt'] += '\n\n' + constraint
path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
print('Palette constraints refined; existing prompts preserved')
