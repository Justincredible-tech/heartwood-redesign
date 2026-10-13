"""Compare the base and new runs of check016.py: numbers side by side and pixel diffs of the frozen screenshots."""
import json, statistics, sys
from pathlib import Path
from PIL import Image, ImageChops

D = Path(sys.argv[1])
A, B = (json.loads((D / f"{n}.json").read_text(encoding="utf-8")) for n in ("base", "new"))


def diff(p, q, mask=None):
    x, y = Image.open(p).convert("RGB"), Image.open(q).convert("RGB")
    if x.size != y.size:
        return {"size": [x.size, y.size]}
    d = ImageChops.difference(x, y).convert("L")
    if mask:
        d = d.crop(mask)
    vals = list(d.getdata()); over = [v for v in vals if v > 8]
    return {"pixels_over_8": len(over), "pct": round(100 * len(over) / len(vals), 4), "max": max(vals), "mean_abs": round(sum(vals) / len(vals), 3),
            "over_32": sum(v > 32 for v in vals)}


out = {"pixels": {}, "control_same_build_twice": {}}
for tag in ("d1", "d2"):
    for name in ("idle", "hover", "filter", "focus", "dialog", "closed", "news"):
        out["pixels"][f"{tag}-{name}"] = diff(D / f"base-{tag}-{name}.png", D / f"new-{tag}-{name}.png")
for name in ("idle", "hover", "filter", "focus", "dialog", "closed", "news"):
    out["control_same_build_twice"][f"base d1 vs d1r {name}"] = diff(D / f"base-d1-{name}.png", D / f"base-d1r-{name}.png")
    out["control_same_build_twice"][f"new d1 vs d1r {name}"] = diff(D / f"new-d1-{name}.png", D / f"new-d1r-{name}.png")
for name in ("phone-idle", "webkit-idle", "webkit-hover"):
    out["pixels"][name] = diff(D / f"base-{name}.png", D / f"new-{name}.png")
for tag in ("d1", "d2"):
    for name in ("poster", "cover"):
        out["pixels"][f"{tag}-{name}"] = diff(D / f"base-{tag}-{name}.png", D / f"new-{tag}-{name}.png")


def hov(run, key, dpr):
    rs = [r for r in run["hover"] if r["dpr"] == dpr]
    return {k: statistics.median(r[key][k] for r in rs) for k in ("p50", "p95", "max", "over20", "over50")}


out["hover"] = {f"dpr{d}": {k: {"base": hov(A, k, d), "new": hov(B, k, d)} for k in ("tree", "network", "scroll_back")} for d in (1, 2)}
out["layers"] = {f"dpr{d}": {v: {k: statistics.median(r[k] for r in run["hover"] if r["dpr"] == d) for k in ("layers_top", "layer_mb_top", "layers_away", "layer_mb_away")}
                             for v, run in (("base", A), ("new", B))} for d in (1, 2)}
out["load"] = {v: {k: run["load"][k] for k in ("fcp", "lcp", "longtask_ms", "longtasks")} for v, run in (("base", A), ("new", B))}
for key in ("shots_dpr1", "shots_dpr2"):
    out[key] = {v: {k: run[key][k] for k in ("wrapped", "leaf_buttons", "dialog_open", "focus_returned", "poster", "cover")} for v, run in (("base", A), ("new", B))}
out["nav"] = {v: {k: x for k, x in run["nav"].items() if not k.endswith("log")} for v, run in (("base", A), ("new", B))}
out["phone_motion"] = {v: {k: x for k, x in run["phone_motion"].items() if not k.endswith("log")} for v, run in (("base", A), ("new", B))}
out["webkit"] = {v: {k: x for k, x in run["webkit"].items() if k != "log"} for v, run in (("base", A), ("new", B))}


def logs(run):
    found = {"errors": [], "console": [], "failed": [], "external": set()}
    def walk(o):
        if isinstance(o, dict):
            if set(o) >= {"errors", "console", "failed", "external"}:
                for k in ("errors", "console", "failed"): found[k] += o[k]
                found["external"].update(o["external"])
            else:
                for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(run); found["external"] = sorted(found["external"]); return found


out["logs"] = {"base": logs(A), "new": logs(B)}
(D / "comparison.json").write_text(json.dumps(out, indent=1, default=str), encoding="utf-8")
print(json.dumps(out, indent=1, default=str))
