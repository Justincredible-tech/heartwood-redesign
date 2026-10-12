"""Export transparent path-only SVGs, preserving the approved wordmark layout."""
from pathlib import Path
from copy import deepcopy
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', NS)
def tag(name):
    return f'{{{NS}}}{name}'

trace = ET.parse(ROOT / 'wordmark-assets/oak-T-11-vector-trace.svg').getroot()
tree_path = trace.find(tag('path'))
assert tree_path is not None
original = ET.parse(ROOT / 'Heartwood-Young-Serif-oak-wordmark.svg').getroot()
source_image = original.find('.//' + tag('image'))
letters = original.find(tag('g'))
assert source_image is not None and letters is not None

wordmark = ET.Element(tag('svg'), {
    'width': '100%', 'height': '100%',
    'viewBox': original.get('viewBox'), 'version': '1.1',
    'preserveAspectRatio': 'xMidYMid meet',
    'role': 'img', 'aria-labelledby': 'title desc',
})
ET.SubElement(wordmark, tag('title'), {'id': 'title'}).text = 'Heartwood wordmark'
ET.SubElement(wordmark, tag('desc'), {'id': 'desc'}).text = 'Young Serif outlines with the oak T letter substitution, in charcoal on a transparent background. All artwork is vector paths.'
wordmark_group = ET.SubElement(wordmark, tag('g'), {'fill': '#20241f'})
for child in letters:
    if child.tag == tag('path'):
        wordmark_group.append(deepcopy(child))
    elif child.get('mask') == 'url(#oakShape)':
        group = ET.SubElement(wordmark_group, tag('g'), {
            'transform': f"translate({source_image.get('x')} {source_image.get('y')}) scale({float(source_image.get('width')) / 1254:.9f})",
        })
        group.append(deepcopy(tree_path))

isolated = ET.Element(tag('svg'), {
    'width': '100%', 'height': '100%', 'viewBox': '142 110 970 1031',
    'preserveAspectRatio': 'xMidYMid meet',
    'version': '1.1', 'role': 'img', 'aria-labelledby': 'title desc',
})
ET.SubElement(isolated, tag('title'), {'id': 'title'}).text = 'Oak capital T letterform'
ET.SubElement(isolated, tag('desc'), {'id': 'desc'}).text = 'The T-11 oak-curved-forks mark in charcoal, with branch-shaped negative space and a transparent background. All artwork is vector paths.'
isolated.append(deepcopy(tree_path))

outputs = [
    (wordmark, ROOT / 'Heartwood-Young-Serif-oak-wordmark-transparent.svg'),
    (isolated, ROOT / 'hardwood-T-11-oak-curved-forks-transparent.svg'),
]
for root, destination in outputs:
    assert not root.findall('.//' + tag('image'))
    assert not root.findall('.//' + tag('rect'))
    assert not root.findall('.//' + tag('text'))
    ET.indent(root, space='  ')
    ET.ElementTree(root).write(destination, encoding='utf-8', xml_declaration=True)
    print(destination.name, 'paths:', len(root.findall('.//' + tag('path'))), 'bytes:', destination.stat().st_size)
