"""Compose Chinese-labelled contact sheets and verify captured canvas pixels."""

import json
import hashlib
import os
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

from build_skin import PALETTE, validate

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "preview"
GRAY = (199, 199, 199)
TEXT = "#29272C"
FONT = os.environ.get("PIXEL_FONT", "C:/Windows/Fonts/msyh.ttc")


def label(image, xy, text, size=23, color=TEXT):
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(FONT, size)
    bounds = draw.textbbox(xy, text, font=font)
    assert bounds[2] <= image.width - 20, (text, bounds)
    draw.text(xy, text, font=font, fill=color)


def canvas(size, title, subtitle):
    image = Image.new("RGB", size, GRAY)
    label(image, (36, 24), title, 34)
    label(image, (38, 74), subtitle, 20)
    return image


def place(sheet, folder, name, x, y, title):
    label(sheet, (x + 20, y), title, 23)
    with Image.open(folder / f"{name}.png") as image:
        sheet.paste(image.convert("RGB"), (x + 10, y + 38))


def compose(folder):
    skin = Image.open(ROOT / "xiaoke-skin.png").convert("RGBA")
    validate(skin)
    checks = json.loads((folder / "render-checks.json").read_text())
    assert all(view["model"] == "slim" for view in checks.values())
    assert checks["walk_front"]["leftLegAngle"] * checks["walk_front"]["rightLegAngle"] < 0
    assert checks["turn"]["headAngle"] != 0
    for path in folder.glob("*.png"):
        image = Image.open(path).convert("RGB")
        mask = ImageChops.difference(image, Image.new("RGB", image.size, GRAY)).convert("L")
        bbox = mask.getbbox()
        assert bbox, (path.name, "blank canvas")
        x0, y0, x1, y1 = bbox
        assert x0 > 1 and y0 > 1 and x1 < image.width - 1 and y1 < image.height - 1, (path.name, "clipped", bbox)
        color_count = len(image.getcolors(image.width * image.height))
        assert color_count > 8, (path.name, "missing texture detail", color_count)
        checks[path.stem]["size"] = list(image.size)
        checks[path.stem]["bounds"] = list(bbox)
        checks[path.stem]["colors"] = color_count
    for a, b in (("front_three", "b_front"), ("back_three", "b_back"), ("front_three", "base_only")):
        assert checks[a]["angle"] == checks[b]["angle"]
        assert checks[a]["elevation"] == checks[b]["elevation"]
        assert ImageChops.difference(Image.open(folder / f"{a}.png").convert("RGB"),
                                     Image.open(folder / f"{b}.png").convert("RGB")).getbbox()
    assert checks["b_front"]["extras"] == checks["b_back"]["extras"] == 10
    assert checks["front_three"]["extras"] == checks["back_three"]["extras"] == 0

    overview = canvas((1600, 1250), "小克 · 原版像素皮肤 / 路线 A",
                      "64 × 64 RGBA  |  Alex 细手臂  |  同一张 PNG 的真实模型渲染  |  无额外几何")
    for index, (name, title) in enumerate((("front", "正面"), ("back", "背面"),
                                         ("right", "右侧"), ("left", "左侧"),
                                         ("front_three", "前 3/4"), ("back_three", "后 3/4"))):
        place(overview, folder, name, (index % 4) * 400, 125 + (index // 4) * 545, title)
    label(overview, (820, 670), "标准 UV · 最近邻放大 5 倍", 23)
    checker = Image.new("RGBA", (64, 64), "#A8A8A8")
    d = ImageDraw.Draw(checker)
    for y in range(0, 64, 4):
        for x in range(0, 64, 4):
            if (x // 4 + y // 4) % 2 == 0:
                d.rectangle((x, y, x + 3, y + 3), fill="#B9B9B9")
    checker.alpha_composite(skin)
    overview.paste(checker.resize((320, 320), Image.Resampling.NEAREST).convert("RGB"), (835, 735))
    label(overview, (835, 1080), "棋盘区域为透明像素", 19)
    label(overview, (1220, 670), "小尺寸识别检查", 23)
    with Image.open(folder / "small.png") as image:
        overview.paste(image.convert("RGB"), (1335, 755))
    label(overview, (1230, 925), "原生 96 × 128 视图，未放大", 19)
    label(overview, (1230, 967), "奶白长发 / 粉眼 / 橙色头饰", 19)
    label(overview, (1230, 999), "猫耳与尾巴仅为贴图暗示", 19)
    for i, key in enumerate(("hair", "purple", "white", "pink", "orange", "orange_dark")):
        ImageDraw.Draw(overview).rectangle((1230 + i * 49, 1060, 1266 + i * 49, 1096), fill=PALETTE[key])
    label(overview, (38, 1206), "制作预览，尚未游戏内验收或部署。徽章在近距离辨认；远看优先保留角色配色与脸部。", 20)
    overview.save(OUT / "xiaoke-preview.png")

    pose = canvas((1600, 725), "小克 · 姿势与图层检查",
                  "真实模型关节姿势  |  尾纹不跨腰腿关节  |  最右为关闭全部第二层后的基础皮肤")
    for index, (name, title) in enumerate((("walk_front", "行走 · 正面"), ("walk_back", "行走 · 背面"),
                                         ("turn", "转头与抬臂"), ("base_only", "仅基础层"))):
        place(pose, folder, name, index * 400, 125, title)
    label(pose, (38, 678), "短裙采用分腿纹样；动作时会分开。长发在头与躯干间也存在原版模型的固有断点。", 20)
    pose.save(OUT / "xiaoke-preview-walk.png")

    route = canvas((1000, 1270), "小克 · 路线 A / B 轮廓对照",
                   "相同 PNG、相机、姿势与光照；B 仅增加 6 个耳部方块 + 4 段尾巴")
    for name, x, y, title in (("front_three", 50, 135, "A · 原版 / 前 3/4"),
                              ("b_front", 550, 135, "B · 几何示意 / 前 3/4"),
                              ("back_three", 50, 675, "A · 原版 / 后 3/4"),
                              ("b_back", 550, 675, "B · 几何示意 / 后 3/4")):
        place(route, folder, name, x, y, title)
    label(route, (38, 1188), "B 需要模组，其他玩家也要装相应模组才看得到；具体同步方式待确认。", 20)
    label(route, (38, 1222), "B 仅供比较辨识度，不是 PNG 自带效果，未制作可部署模组文件。", 20)
    route.save(OUT / "xiaoke-preview-route-b.png")
    checks["skin_sha256"] = hashlib.sha256((ROOT / "xiaoke-skin.png").read_bytes()).hexdigest()
    (OUT / "checks.json").write_text(json.dumps(checks, indent=2) + "\n", encoding="utf-8")
    print("Saved 3 preview sheets; all 14 desktop/mobile canvases nonblank and unclipped.")


if __name__ == "__main__":
    compose(Path(sys.argv[1]))
