"""Extend Litemora's default pack with Java 26.1.2 redstone component models."""
import argparse
import json
import re
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


def chest_model(part, oxidation):
    # ChestModel.create{Single,Double}BodyLayer uses a 64x64 unfolded texture.
    def cube(start, end, v):
        x, y, z = (b - a for a, b in zip(start, end))
        uv = {
            "north": (z, v+z, z+x, v+z+y), "south": (2*z+x, v+z, 2*(z+x), v+z+y),
            "west": (0, v+z, z, v+z+y), "east": (z+x, v+z, 2*z+x, v+z+y),
            "down": (z, v, z+x, v+z), "up": (z+x, v+z, z+2*x, v),
        }
        if part != "single":
            del uv["west" if part == "left" else "east"]
        return {"from": start, "to": end, "faces": {
            side: {"uv": [n / 4 for n in rect], "texture": "#chest"} for side, rect in uv.items()
        }}

    x0, x1, latch = {"single": (1, 15, 7), "left": (0, 15, 0), "right": (1, 16, 15)}[part]
    texture = "copper" + ("_" + oxidation if oxidation else "") + ("_" + part if part != "single" else "")
    particle = oxidation + "_copper" if oxidation else "copper_block"
    return {"textures": {"particle": "minecraft:block/" + particle, "chest": "minecraft:entity/chest/" + texture},
            "elements": [cube([x0, 0, 1], [x1, 10, 15], 19), cube([x0, 9, 1], [x1, 14, 15], 0),
                         cube([latch, 7, 15], [latch + (2 if part == "single" else 1), 11, 16], 0)]}


def update(jar, root, pack):
    if json.loads(jar.read("version.json"))["id"] != "26.1.2":
        raise ValueError("Expected Java 26.1.2")
    base = "assets/minecraft/"
    files = {}
    seen = set()
    def visit(path, override=None):
        if path in seen:
            return
        seen.add(path)
        data = (json.dumps(override, separators=(",", ":")).encode() if override else jar.read(path))
        if path not in pack.NameToInfo:
            files[path] = data
        if path.endswith(".json"):
            obj = json.loads(data)
            for ref in re.findall(r'"(?:model|parent)"\s*:\s*"(minecraft:[^"]+)"', data.decode()):
                mp = base + "models/" + ref.split(":")[1] + ".json"
                if mp not in seen:
                    visit(mp)
            if "textures" in obj:
                for ref in obj["textures"].values():
                    if isinstance(ref, str) and not ref.startswith("#"):
                        visit(base + "textures/" + ref.split(":")[-1] + ".png")

    for path in jar.namelist():
        if not path.startswith(base + "blockstates/"):
            continue
        name = Path(path).stem
        if name.endswith(("_shelf", "lightning_rod")):
            visit(path)
        elif name.endswith("copper_chest"):
            oxidation = name.removeprefix("waxed_").removesuffix("copper_chest").rstrip("_")
            variants = {}
            for part in ("single", "left", "right"):
                model = "block/" + "_".join(filter(None, [oxidation, "copper_chest", part]))
                visit(base + "models/" + model + ".json", chest_model(part, oxidation))
                for face, angle in (("south", 0), ("west", 90), ("north", 180), ("east", 270)):
                    variants[f"facing={face},type={part}"] = {"model": "minecraft:" + model, "y": angle}
            visit(path, {"variants": variants})
    for path, data in sorted(files.items()):
        dst = root / path
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(data)
        pack.writestr(ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0)), data, compress_type=ZIP_DEFLATED)
    return len(files)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("client", type=Path)
    parser.add_argument("public", type=Path)
    args = parser.parse_args()
    with ZipFile(args.client) as jar, ZipFile(args.public / "minecraft-default-pack.pack", "a") as pack:
        print(update(jar, args.public / "minecraft-default-pack", pack), "assets added")
