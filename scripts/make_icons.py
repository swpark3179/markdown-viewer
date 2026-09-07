#!/usr/bin/env python3
"""앱 아이콘 자산을 다시 생성한다.

원본 이미지의 둥근 사각형 바깥쪽(흰 배경과 옅은 그림자)을 투명하게 지우고,
`src-tauri/icons/` 아래의 PNG 세트와 `icon.ico`를 다시 만든다.

사용법:

    pip install pillow numpy scipy
    python scripts/make_icons.py [원본이미지]

원본 이미지를 생략하면 `src-tauri/icons/icon.png`를 그대로 사용한다.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "src-tauri" / "icons"

# 아이콘 몸체로 볼 최대 밝기. 이 값보다 밝은 바깥쪽 픽셀은 배경으로 본다.
BODY_MAX_LEVEL = 180
# 색을 바깥으로 번지게 하기 전에 깎아낼 테두리 두께(px). 흰색이 섞인 경계 픽셀을 버린다.
EDGE_TRIM = 4
# PNG/ICO로 만들 정사각 크기.
PNG_SIZES = [16, 24, 32, 48, 64, 128, 256]
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def build_rgba(source: Path) -> Image.Image:
    """바깥 배경을 투명으로 바꾼 RGBA 이미지를 만든다."""
    image = Image.open(source).convert("RGBA")
    source_alpha = np.asarray(image.getchannel("A"))
    rgb = np.asarray(image.convert("RGB")).astype(np.int16)

    # 1. 아이콘 몸체를 찾는다.
    if (source_alpha < 128).any():
        # 이미 배경이 지워진 아이콘을 다시 넣은 경우. 모양을 그대로 물려받아
        # 여러 번 실행해도 테두리가 계속 깎이지 않게 한다.
        body = source_alpha >= 128
    else:
        # 어두운 픽셀을 몸체로 보고 내부의 밝은 부분(책 페이지, 글자)을 메운다.
        body = ndimage.binary_fill_holes(rgb.min(axis=2) < BODY_MAX_LEVEL)

    labels, count = ndimage.label(body)
    if count == 0:
        raise SystemExit(f"아이콘 몸체를 찾지 못했습니다: {source}")
    areas = ndimage.sum(body, labels, range(1, count + 1))
    body = labels == (int(np.argmax(areas)) + 1)

    # 2. 흰색이 섞인 경계 픽셀을 버리고, 그 안쪽 색을 바깥으로 번지게 한다.
    #    이렇게 해야 축소했을 때 가장자리에 흰 테가 남지 않는다.
    core = ndimage.binary_erosion(body, iterations=EDGE_TRIM)
    _, (iy, ix) = ndimage.distance_transform_edt(~core, return_indices=True)
    rgb = np.where(core[..., None], rgb, rgb[iy, ix])

    # 3. 몸체 모양을 알파 채널로 쓰고 계단 현상만 살짝 눌러 준다.
    alpha = Image.fromarray((body * 255).astype(np.uint8), "L")
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.6))

    out = Image.fromarray(rgb.astype(np.uint8), "RGB").convert("RGBA")
    out.putalpha(alpha)
    return out


def main() -> None:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else ICON_DIR / "icon.png"
    master = build_rgba(source)

    ICON_DIR.mkdir(parents=True, exist_ok=True)
    master.save(ICON_DIR / "icon.png")

    scaled = {}
    for size in PNG_SIZES:
        image = master.resize((size, size), Image.LANCZOS)
        scaled[size] = image
        image.save(ICON_DIR / f"{size}x{size}.png")
    scaled[256].save(ICON_DIR / "128x128@2x.png")

    largest = scaled[max(ICO_SIZES)]
    largest.save(
        ICON_DIR / "icon.ico",
        format="ICO",
        sizes=[(size, size) for size in ICO_SIZES],
    )
    print(f"{source} -> {ICON_DIR}")


if __name__ == "__main__":
    main()
