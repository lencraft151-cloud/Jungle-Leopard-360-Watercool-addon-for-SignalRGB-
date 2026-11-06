"""Independent check of what the plugin sends to the panel, using Pillow (libjpeg) as the decoder.

Usage (from the repository root): python3 tests/crosscheck/pillow_crosscheck.py
Requires Node >= 20.6 and Pillow.
"""
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, JpegImagePlugin

ROOT = Path(__file__).resolve().parents[2]
MAX_FRAME = 80 * 1024

# Where the face's red (top-left) and green (top-right) markers must land on the physical 960x480 panel.
EXPECTED = {
    "landscape": {(50, 50): "red", (910, 50): "green"},
    "upside-down": {(909, 429): "red", (49, 429): "green"},
    "portrait-right": {(50, 429): "red", (50, 49): "green"},
    "portrait-left": {(909, 50): "red", (909, 430): "green"},
    "square": {(290, 50): "red", (670, 50): "green", (100, 240): "fill", (860, 240): "fill"},
}
COLORS = {"red": (255, 0, 0), "green": (0, 255, 0), "fill": (0x20, 0x30, 0x40)}


def close(a, b, tolerance=48):
    return all(abs(x - y) <= tolerance for x, y in zip(a, b))


def main():
    failures = 0
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            ["node", "--import", "./tests/helpers/register.mjs", "tests/crosscheck/capture-frames.mjs", tmp],
            cwd=ROOT, check=True,
        )
        for jpg in sorted(Path(tmp).glob("*.jpg")):
            data = jpg.read_bytes()
            img = Image.open(jpg)
            img.load()
            problems = []
            if img.size != (960, 480):
                problems.append(f"size {img.size}")
            if JpegImagePlugin.get_sampling(img) != 2:
                problems.append("not 4:2:0")
            if img.info.get("progressive"):
                problems.append("progressive")
            if len(data) > MAX_FRAME:
                problems.append(f"{len(data)} bytes > 80 KB")
            rgb = img.convert("RGB")
            for (x, y), name in EXPECTED.get(jpg.stem, {}).items():
                got = rgb.getpixel((x, y))
                if not close(got, COLORS[name]):
                    problems.append(f"pixel ({x},{y}) is {got}, expected {name}")
            status = "OK " if not problems else "FAIL"
            failures += bool(problems)
            print(f"{status} {jpg.stem:15s} {len(data):6d} B  {'; '.join(problems)}")
            if len(sys.argv) > 1:
                Path(sys.argv[1]).mkdir(parents=True, exist_ok=True)
                (Path(sys.argv[1]) / jpg.name).write_bytes(data)
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
