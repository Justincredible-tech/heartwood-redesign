"""One-shot, source-preserving decoration reduction, with a reproducible removal ledger."""
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re

from density_inventory import SourceParser, region

EVIDENCE = Path(__file__).resolve().parent
ROOT = EVIDENCE.parents[1]
SOURCE = ROOT / 'source'


def position(record):
    style = record['face'].attrs['style']
    values = {key: float(value) for key, value in re.findall(r'(left|top):(?:calc\()?([-\d.]+)%', style)}
    return values['top'], values['left'], record['face'].start


def distributed(records, count):
    ordered = sorted(records, key=position)
    return [ordered[int((index + .5) * len(ordered) / count)] for index in range(count)] if count else []


def summarize(nodes):
    counts = defaultdict(Counter)
    for node in nodes:
        area = region(node)
        for family in ('bee', 'bug', 'critter'):
            if family in node.classes:
                counts[area][family] += 1
        if 'stones' in node.classes:
            bits = [child for child in node.children if child.tag == 'i']
            counts[area]['stone_dom'] += len(bits)
            if 'stones--bed' not in node.classes:
                counts[area]['physical_rocks'] += len(bits)
                counts[area]['tablet_rocks'] += sum('stone--tablet-hidden' not in child.classes for child in bits)
                counts[area]['phone_rocks'] += sum(not child.classes.intersection({'stone--tablet-hidden', 'stone--phone-hidden'}) for child in bits)
    return dict(counts)


def main():
    original = (EVIDENCE / 'before.html').read_text(encoding='utf-8')
    original_css = (EVIDENCE / 'before.css').read_text(encoding='utf-8')
    html_path, css_path = SOURCE / 'heartwood-site.html', SOURCE / 'css' / 'heartwood-site.css'
    assert html_path.read_bytes() == original.encode('utf-8'), 'Source HTML changed since baseline'
    assert css_path.read_bytes() == original_css.encode('utf-8'), 'Source CSS changed since baseline'
    nodes = SourceParser(original).nodes
    edits = []
    removed = []
    kept_animals = []
    keep_indices = {
        ('bee', 'stage'): {0, 2, 5, 7},
        ('bug', 'stage'): {0, 2, 3, 8, 10, 11, 13},
        ('bug', 'stratum--subsoil'): {1, 2, 4, 5, 7},
        ('bug', 'stratum--clay'): {0},
        ('critter', 'stratum--bedrock'): {0},
    }
    for (family, area), keep in keep_indices.items():
        matching = [node for node in nodes if family in node.classes and region(node) == area]
        assert len(keep) == len(matching) // 2
        for index, node in enumerate(matching):
            if index not in keep:
                edits.append((node.start, node.end, ''))
                removed.append({'family': family, 'region': area, 'original_index': index + 1,
                                'start': node.start, 'end': node.end})
            else:
                kept_animals.append({'family': family, 'region': area, 'original_index': index + 1,
                                     'class': node.attrs['class'], 'style': node.attrs.get('style', '')})

    wrappers = [node for node in nodes if 'stones' in node.classes]
    physical = []
    for wrapper_index, wrapper in enumerate(wrappers):
        if 'stones--bed' in wrapper.classes:
            continue
        bits = [node for node in wrapper.children if node.tag == 'i']
        beds = []
        if 'stones--in' in wrapper.classes:
            bed_wrapper = wrappers[wrapper_index - 1]
            assert 'stones--bed' in bed_wrapper.classes and bed_wrapper.parent is wrapper.parent
            beds = [node for node in bed_wrapper.children if node.tag == 'i']
            assert len(beds) == len(bits)
            assert all(bed.attrs == face.attrs for bed, face in zip(beds, bits))
        for index, face in enumerate(bits, 1):
            area = region(wrapper)
            bucket = 0 if area == 'stage' or index % 2 == 0 else (1 if index % 3 == 0 else 2)
            physical.append({'face': face, 'bed': beds[index - 1] if beds else None, 'index': index,
                             'wrapper': wrapper_index, 'region': area, 'palette': wrapper.attrs.get('style', ''),
                             'bucket': bucket})

    kept_starts = set()
    region_counts = {}
    for area in dict.fromkeys(record['region'] for record in physical):
        records = [record for record in physical if record['region'] == area]
        count = len(records)
        target = count // 2
        tablet_before = count if area == 'stage' else sum(record['index'] % 2 != 0 for record in records)
        phone_before = count if area == 'stage' else sum(record['index'] % 2 != 0 and record['index'] % 3 != 0 for record in records)
        quotas = {0: target} if area == 'stage' else {
            2: phone_before // 2,
            1: tablet_before // 2 - phone_before // 2,
            0: target - tablet_before // 2,
        }
        selected = []
        for bucket, quota in quotas.items():
            candidates = [record for record in records if record['bucket'] == bucket]
            palettes = defaultdict(list)
            for record in candidates:
                palettes[record['palette']].append(record)
            allocations = {palette: quota * len(group) // len(candidates) for palette, group in palettes.items()}
            remaining = quota - sum(allocations.values())
            order = sorted(palettes, key=lambda palette: (-(quota * len(palettes[palette]) % len(candidates)), palette))
            for palette in order[:remaining]:
                allocations[palette] += 1
            for palette, group in palettes.items():
                selected.extend(distributed(group, allocations[palette]))
        # Keep every original rock colour somewhere in each stratum, even for tiny groups.
        selected_palettes = Counter(record['palette'] for record in selected)
        for palette in dict.fromkeys(record['palette'] for record in records):
            if selected_palettes[palette]:
                continue
            candidates = [record for record in records if record['palette'] == palette]
            swaps = [(candidate, donor) for candidate in candidates for donor in selected
                     if donor['bucket'] == candidate['bucket'] and selected_palettes[donor['palette']] > 1]
            assert swaps, 'Cannot preserve a rare rock palette without changing visibility quotas'
            candidate, donor = sorted(swaps, key=lambda pair: (position(pair[0]), -selected_palettes[pair[1]['palette']]))[0]
            selected.remove(donor)
            selected.append(candidate)
            selected_palettes[donor['palette']] -= 1
            selected_palettes[palette] += 1
        assert len(selected) == target
        kept_starts.update(record['face'].start for record in selected)
        region_counts[area] = {'before': count, 'after': target, 'tablet_before': tablet_before,
                              'tablet_after': target if area == 'stage' else tablet_before // 2,
                              'phone_before': phone_before, 'phone_after': target if area == 'stage' else phone_before // 2,
                              'palettes_before': len({record['palette'] for record in records}),
                              'palettes_after': len(selected_palettes)}

    rock_ledger = []
    for record in physical:
        retained = record['face'].start in kept_starts
        parts = [record['face']] + ([record['bed']] if record['bed'] else [])
        classes = []
        if record['region'] != 'stage':
            if record['index'] % 2 == 0:
                classes.append('stone--tablet-hidden')
            if record['index'] % 3 == 0:
                classes.append('stone--phone-hidden')
        for part in parts:
            if not retained:
                edits.append((part.start, part.end, ''))
            elif classes:
                assert 'class' not in part.attrs
                edits.append((part.start, part.start + 2, '<i class="' + ' '.join(classes) + '"'))
        rock_ledger.append({'region': record['region'], 'wrapper': record['wrapper'], 'original_index': record['index'],
                            'paired': record['bed'] is not None, 'retained': retained, 'style': record['face'].attrs['style'],
                            'tablet_hidden': 'stone--tablet-hidden' in classes, 'phone_hidden': 'stone--phone-hidden' in classes})

    edits.sort(key=lambda edit: edit[0])
    assert all(left[1] <= right[0] for left, right in zip(edits, edits[1:])), 'Overlapping source edits'
    updated = original
    for start, end, replacement in reversed(edits):
        updated = updated[:start] + replacement + updated[end:]
    css = original_css.replace('.deep .stones > i:nth-child(2n)', '.deep .stones > i.stone--tablet-hidden')
    css = css.replace('.deep .stones > i:nth-child(3n)', '.deep .stones > i.stone--phone-hidden')
    retained_paths = {'bee-0', 'bee-2', 'bee-5', 'bee-7'}
    removed_paths = []
    for match in reversed(list(re.finditer(r'@keyframes (bee-\d+) \{', css))):
        if match.group(1) in retained_paths:
            continue
        depth, end = 1, match.end()
        while depth:
            depth += (css[end] == '{') - (css[end] == '}')
            end += 1
        css = css[:match.start()] + css[end:]
        removed_paths.append(match.group(1))
    assert set(removed_paths) == {'bee-1', 'bee-3', 'bee-4', 'bee-6', 'bee-8'}
    after_nodes = SourceParser(updated).nodes
    result = summarize(after_nodes)
    assert sum(values['physical_rocks'] for values in result.values()) == 254
    assert sum(values['bee'] for values in result.values()) == 4
    assert sum(values['bug'] for values in result.values()) == 13
    assert sum(values['critter'] for values in result.values()) == 1
    assert sum(values['tablet_rocks'] for values in result.values()) == 158
    assert sum(values['phone_rocks'] for values in result.values()) == 118
    html_path.write_bytes(updated.encode('utf-8'))
    css_path.write_bytes(css.encode('utf-8'))
    ledger = {'rock_counts': region_counts, 'after_counts': result, 'removed_animals': removed,
              'retained_animals': kept_animals, 'rock_instances': rock_ledger, 'removed_bee_keyframes': sorted(removed_paths),
              'source_html_sha256': hashlib.sha256(updated.encode()).hexdigest(),
              'source_css_sha256': hashlib.sha256(css.encode()).hexdigest(),
              'source_html_before_bytes': len(original.encode()), 'source_html_after_bytes': len(updated.encode()),
              'source_css_before_bytes': len(original_css.encode()), 'source_css_after_bytes': len(css.encode())}
    (EVIDENCE / 'removal-ledger.json').write_text(json.dumps(ledger, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'rock_counts': region_counts, 'after_counts': result, 'removed_bee_keyframes': sorted(removed_paths)}, indent=2))


if __name__ == '__main__':
    main()
