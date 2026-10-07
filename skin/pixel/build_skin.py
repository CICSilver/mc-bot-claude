"""Build the vanilla 64x64 slim skin. Requires Pillow; no source art is resized."""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageColor


PALETTE = {
    "hair": "#F4E9D6",
    "hair_light": "#FFF5E5",
    "hair_shadow": "#D7BFA1",
    "face": "#FFF0DE",
    "fur": "#F4E9D6",
    "purple": "#403346",
    "purple_light": "#58435B",
    "purple_dark": "#2C2632",
    "white": "#F8F7F3",
    "white_shadow": "#CECCD4",
    "pink": "#E38BAE",
    "pink_light": "#F4BDD0",
    "eye": "#B84F7C",
    "eye_dark": "#69344F",
    "gold": "#E9BD59",
    "gold_shadow": "#A87B38",
    "orange": "#D97757",
    "orange_dark": "#C15F3C",
    "ink": "#26212A",
}

INK = {
    "h": "hair", "H": "hair_light", "s": "hair_shadow", "f": "face",
    "d": "purple", "D": "purple_dark", "l": "purple_light",
    "w": "white", "g": "white_shadow", "p": "pink", "P": "pink_light",
    "e": "eye", "E": "eye_dark", "y": "gold", "Y": "gold_shadow",
    "o": "orange", "O": "orange_dark", "k": "ink",
}

# Each face is addressed in standard skin UV space, including the slim-arm gaps.
PARTS = {
    "head": (0, 0, 8, 8, 8), "hat": (32, 0, 8, 8, 8),
    "body": (16, 16, 8, 12, 4), "jacket": (16, 32, 8, 12, 4),
    "right_arm": (40, 16, 3, 12, 4), "right_sleeve": (40, 32, 3, 12, 4),
    "left_arm": (32, 48, 3, 12, 4), "left_sleeve": (48, 48, 3, 12, 4),
    "right_leg": (0, 16, 4, 12, 4), "right_trouser": (0, 32, 4, 12, 4),
    "left_leg": (16, 48, 4, 12, 4), "left_trouser": (0, 48, 4, 12, 4),
}
BASE = ("head", "body", "right_arm", "left_arm", "right_leg", "left_leg")


def faces(part):
    u, v, w, h, d = PARTS[part]
    return {
        "top": (u + d, v, w, d), "bottom": (u + d + w, v, w, d),
        "right": (u, v + d, d, h), "front": (u + d, v + d, w, h),
        "left": (u + d + w, v + d, d, h),
        "back": (u + 2 * d + w, v + d, w, h),
    }


class Skin:
    def __init__(self):
        self.image = Image.new("RGBA", (64, 64))

    def rect(self, part, face, x, y, w, h, color):
        ox, oy, fw, fh = faces(part)[face]
        assert 0 <= x < x + w <= fw and 0 <= y < y + h <= fh
        rgba = ImageColor.getrgb(PALETTE[color]) + (255,)
        for py in range(y, y + h):
            for px in range(x, x + w):
                self.image.putpixel((ox + px, oy + py), rgba)

    def fill(self, part, color):
        for face, (_, _, w, h) in faces(part).items():
            self.rect(part, face, 0, 0, w, h, color)

    def pattern(self, part, face, rows, x=0, y=0):
        _, _, fw, fh = faces(part)[face]
        assert rows and len({len(row) for row in rows}) == 1
        assert x + len(rows[0]) <= fw and y + len(rows) <= fh
        for py, row in enumerate(rows):
            for px, char in enumerate(row):
                if char != ".":
                    self.rect(part, face, x + px, y + py, 1, 1, INK[char])


def build():
    s = Skin()
    s.fill("head", "hair")
    s.pattern("head", "front", [
        "shhHHhhs", "hhHHHHhh", "hHffffHh", "hfEffEfh",
        "fEeffeEf", "fPpffpPf", "hffffffh", "shffffhs",
    ])
    # Broad hair panels rather than individual strands.
    for face in ("left", "right", "back"):
        s.pattern("head", face, [
            "shHHHhhs", "hhHHHhhh", "hhHHhhsh", "hHHhhhsh",
            "hHHhhhsh", "hHhhhssh", "hhhhhshh", "shhsshhs",
        ])
    s.pattern("head", "top", [
        "shhsshhs", "hhHHHhhh", "hHHHHHhh", "hHHHhHhh",
        "hhHHhHhh", "hhHHhhhh", "shhhhhhs", "sshhhhss",
    ])
    s.pattern("hat", "front", [
        "H......H", "HP....PH", "HHH..HHH", "ohHhhHho",
        "h......h", "h......h", "s......s", "........",
    ])
    # Ear markings stop at the standard hat shell; they are not extra geometry.
    for face in ("left", "right"):
        rows = [
            "H.......", "HP......", "HD...D..", ".oODoo..",
            "..ooo...", ".oODoo..", "..D.D...", "..s.hh..",
        ]
        if face == "right":
            rows = [row[::-1] for row in rows]
        s.pattern("hat", face, rows)
    s.pattern("hat", "top", [
        "HH....HH", "HP....PH", "H......H", "...s....",
        "...H....", "........", "........", "........",
    ])
    s.pattern("hat", "back", [
        "........", "........", "........", "D......D",
        "O......O", "D......D", ".H....H.", ".hs..sh.",
    ])

    s.fill("body", "purple")
    s.pattern("body", "front", [
        "shwwwwhs", "hhpPpPhh", "hhdyYdhh", "hdwwwwdh",
        "hdwwwwwh", "hdwwwwwh", "dwwwwwwd", "dwwwwwwd",
        "dwwwwwwd", "dwwwwwwd", "dlwwwwld", "ddgwwgdd",
    ])
    # The badge occupies exactly 5x4 pixels; legs remain independent of the apron.
    s.rect("body", "front", 1, 5, 6, 4, "white")
    s.pattern("body", "front", [".ooo.", "okoko", "ooooo", ".o.o."], 2, 5)
    s.pattern("body", "back", [
        "shHHHHhs", "hhHHHhhh", "hhHHHhhs", "hhHhhhhs",
        "shhddhhs", "dsddddsd", "dwddwddd", "dgwggdhh",
        "dwddwdsh", "dgddgdhh", "dlddhhsd", "dddddddd",
    ])
    for face in ("left", "right"):
        s.pattern("body", face, [
            "hhhh", "hHhh", "hHhh", "hhhs", "shhd", "dhhd",
            "dhsd", "dhdd", "dsdd", "dldd", "dldd", "dddd",
        ])
    s.pattern("body", "top", ["hhhhhhhh", "hdwwwwdh", "hdwwwwdh", "hhhhhhhh"])
    s.pattern("jacket", "front", [".w....w.", "........", "........", "........",
                                       "........", "........", "........", "........",
                                       ".w......", ".w....w.", "..w..w..", "...ww..."])
    s.pattern("jacket", "back", ["........", "........", "........", "........",
                                      ".h....h.", "........", ".w..w...", "..wgg...",
                                      "........", "........", "........", "........"])

    for side in ("left", "right"):
        arm, sleeve = f"{side}_arm", f"{side}_sleeve"
        s.fill(arm, "fur")
        for face, (_, _, w, _) in faces(arm).items():
            if face in ("top", "bottom"):
                continue
            s.rect(arm, face, 0, 0, w, 3, "purple")
            s.rect(arm, face, 0, 3, w, 1, "purple_light")
            s.rect(arm, face, 0, 4, w, 1, "white")
            s.rect(arm, face, 0, 8, w, 1, "white_shadow")
            s.rect(arm, face, 0, 9, w, 1, "white")
            s.rect(sleeve, face, 0, 3, w, 1, "white")
            s.rect(sleeve, face, 0, 9, w, 1, "white")
        s.rect(arm, "top", 0, 0, 3, 4, "purple")
        s.pattern(arm, "front", ["hHh", "shs"], 0, 10)
        s.pattern(arm, side, ["d..d", ".dd.", "h..h"], 0, 8)
        s.pattern(arm, "bottom", ["hhh", "hPh", "hph", "hhh"])
        leg, outer = f"{side}_leg", f"{side}_trouser"
        s.fill(leg, "fur")
        s.rect(leg, "top", 0, 0, 4, 4, "purple_dark")
        for face in ("front", "left", "right", "back"):
            s.pattern(leg, face, ["dldd", "dldd", "ddld", "dldd", "gwwg", "whhw"])
            s.pattern(outer, face, ["....", "....", "....", "....", "w..w"])
            s.rect(leg, face, 0, 10, 4, 1, "hair_light")
        s.pattern(leg, "front", ["hHHh", "shhs"], 0, 10)
        s.pattern(leg, "back", ["shhs", "hhhh", "hHhh", "hHhh"], 0, 6)
        s.rect(leg, "bottom", 0, 0, 4, 4, "hair_shadow")
    validate(s.image)
    return s.image


def validate(image):
    assert image.size == (64, 64) and image.mode == "RGBA"
    assert set(image.getchannel("A").tobytes()) <= {0, 255}
    used = set()
    for part in PARTS:
        for ox, oy, w, h in faces(part).values():
            for y in range(oy, oy + h):
                for x in range(ox, ox + w):
                    assert (x, y) not in used, (part, x, y)
                    used.add((x, y))
                    if part in BASE:
                        assert image.getpixel((x, y))[3] == 255, (part, x, y)
    for y in range(64):
        for x in range(64):
            if (x, y) not in used:
                assert image.getpixel((x, y))[3] == 0, ("unused UV", x, y)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--palette", action="store_true")
    args = parser.parse_args()
    if args.palette:
        print(json.dumps(PALETTE))
    else:
        path = Path(__file__).with_name("xiaoke-skin.png")
        build().save(path)
        print(f"Saved {path} (64x64 RGBA, slim; UV and alpha checked)")
