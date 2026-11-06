"""Regenerates the JPEG fixtures with Pillow (libjpeg), i.e. with an encoder other than the plugin's.

Usage: python3 tests/fixtures/make_fixtures.py
"""
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent


def pattern(width, height):
    img = Image.new("RGB", (width, height))
    px = img.load()
    for y in range(height):
        for x in range(width):
            px[x, y] = (
                int(30 + 150 * (1 - x / width) * (1 - y / height)),
                int(40 + 90 * x / width),
                int(90 + 140 * x / width) if (x // 8 + y // 8) % 2 else 255,
            )
    return img


def main():
    small = pattern(64, 32)
    small.save(HERE / "pil-420-64x32.jpg", quality=85, subsampling=2)
    small.save(HERE / "pil-444-64x32.jpg", quality=85, subsampling=0)
    small.save(HERE / "pil-422-64x32.jpg", quality=85, subsampling=1)
    small.save(HERE / "pil-progressive-64x32.jpg", quality=85, subsampling=2, progressive=True)
    small.convert("L").save(HERE / "pil-gray-64x32.jpg", quality=85)
    small.save(HERE / "pil-restart-64x32.jpg", quality=85, subsampling=2, restart_marker_blocks=4)
    # A native panel frame produced by libjpeg, standing in for SignalRGB's own JPEG output.
    pattern(960, 480).save(HERE / "pil-420-960x480.jpg", quality=80, subsampling=2)
    pattern(960, 480).save(HERE / "pil-444-960x480.jpg", quality=80, subsampling=0)


if __name__ == "__main__":
    main()
