from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path

VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}


@dataclass
class Node:
    tag: str
    attrs: dict
    start: int
    end: int = 0
    parent: object = None
    children: list = field(default_factory=list)

    @property
    def classes(self):
        return set(self.attrs.get('class', '').split())

    def ancestors(self):
        node = self.parent
        while node:
            yield node
            node = node.parent


class SourceParser(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=False)
        self.source = source
        self.lines = [0]
        self.lines.extend(i + 1 for i, char in enumerate(source) if char == '\n')
        self.stack = []
        self.nodes = []
        self.feed(source)
        assert not self.stack, 'Unclosed source elements'

    def source_offset(self):
        line, column = self.getpos()
        return self.lines[line - 1] + column

    def add(self, tag, attrs):
        start = self.source_offset()
        parent = self.stack[-1] if self.stack else None
        node = Node(tag, dict(attrs), start, start + len(self.get_starttag_text()), parent)
        self.nodes.append(node)
        if parent:
            parent.children.append(node)
        return node

    def handle_starttag(self, tag, attrs):
        node = self.add(tag, attrs)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.add(tag, attrs)

    def handle_endtag(self, tag):
        assert self.stack and self.stack[-1].tag == tag, f'Unexpected closing {tag}'
        node = self.stack.pop()
        node.end = self.source.index('>', self.source_offset()) + 1


def region(node):
    for parent in (node, *node.ancestors()):
        strata = sorted(c for c in parent.classes if c.startswith('stratum--'))
        if strata:
            return '+'.join(strata)
        if 'stage' in parent.classes:
            return 'stage'
    return 'other'


def inventory(source):
    nodes = SourceParser(source).nodes
    for family in ('bee', 'bug', 'critter', 'fossil'):
        matches = [n for n in nodes if family in n.classes]
        print(f'{family}: {len(matches)}')
        for node in matches:
            print(' ', region(node), node.tag, node.attrs.get('class'), node.attrs.get('style', ''))
    stones = [n for n in nodes if 'stones' in n.classes]
    print(f'stone containers: {len(stones)}')
    for index, container in enumerate(stones):
        bits = [n for n in container.children if n.tag == 'i']
        print(index, region(container), container.attrs.get('class'), len(bits),
              container.attrs.get('style', '')[:90])


if __name__ == '__main__':
    inventory((Path(__file__).parent / 'before.html').read_text(encoding='utf-8'))
