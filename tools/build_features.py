"""Build feature policy shared by artifact consumers; no runtime switches."""

FEATURE_NAMES = ('night', 'phone', 'tree-effects', 'network-effects')
FEATURE_FIELDS = ('night', 'phone', 'treeEffects', 'networkEffects')


def resolve_exclusions(value=None):
    if value is None:
        names = []
    elif isinstance(value, str) and value:
        names = value.split(',')
    elif isinstance(value, (list, tuple)):
        names = list(value)
    else:
        raise ValueError('Feature exclusion requires a nonempty string or array')
    if any(type(name) is not str or name not in FEATURE_NAMES for name in names):
        raise ValueError('Unknown or empty build feature exclusion')
    if len(set(names)) != len(names):
        raise ValueError('Duplicate build feature exclusion')
    excluded = [name for name in FEATURE_NAMES if name in names]
    return dict(zip(FEATURE_FIELDS, (name not in excluded for name in FEATURE_NAMES)), excluded=excluded)


def manifest_features(manifest, *, expected=None, allow_legacy=False):
    if 'features' not in manifest and allow_legacy:
        features = resolve_exclusions()
    else:
        features = manifest.get('features')
        if not isinstance(features, dict) or any(type(features.get(key)) is not bool for key in FEATURE_FIELDS):
            raise ValueError('Build feature metadata is missing or invalid')
        excluded = features.get('excluded')
        if not isinstance(excluded, list) or features != resolve_exclusions(excluded):
            raise ValueError('Build feature metadata contradicts its exclusions')
    if expected is not None and features != resolve_exclusions(expected):
        raise ValueError('Build features differ from the explicitly requested delivery profile')
    return features
