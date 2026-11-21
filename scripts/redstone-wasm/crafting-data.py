"""Extract the Java 26.1.2 crafting table from the official client JAR."""
import argparse
import json
from functools import cache
from pathlib import Path
from zipfile import ZipFile


# FuelValues.vanillaBurnTimes at the default 200-tick cooking time.
FUEL_GROUPS = {
    50: (
        'bamboo scaffolding '
    ),
    67: (
        '#wool_carpets '
    ),
    100: (
        '#wool #wooden_buttons stick #saplings bowl dead_bush '
        'short_dry_grass tall_dry_grass azalea flowering_azalea leaf_litter '
    ),
    150: (
        '#wooden_slabs bamboo_mosaic_slab '
    ),
    200: (
        '#signs wooden_shovel wooden_sword wooden_spear wooden_hoe wooden_axe '
        'wooden_pickaxe #wooden_doors '
    ),
    300: (
        '#logs #bamboo_blocks #planks bamboo_mosaic #wooden_stairs bamboo_mosaic_stairs '
        '#wooden_trapdoors #wooden_pressure_plates #wooden_shelves #wooden_fences #fence_gates note_block '
        'bookshelf chiseled_bookshelf lectern jukebox chest trapped_chest '
        'crafting_table daylight_detector #banners bow fishing_rod ladder '
        'crossbow loom barrel cartography_table fletching_table smithing_table '
        'composter mangrove_roots '
    ),
    800: (
        '#hanging_signs '
    ),
    1200: (
        '#boats '
    ),
    1600: (
        'coal charcoal '
    ),
    2400: (
        'blaze_rod '
    ),
    4001: (
        'dried_kelp_block '
    ),
    16000: (
        'coal_block '
    ),
    20000: (
        'lava_bucket '
    ),
}


def extract(jar):
    if json.loads(jar.read("version.json"))["id"] != "26.1.2":
        raise ValueError("Expected the Minecraft Java 26.1.2 client")

    @cache
    def items(reference):
        if not reference.startswith("#"):
            return [reference]
        namespace, path = reference[1:].split(":")
        tag = json.loads(jar.read(f"data/{namespace}/tags/item/{path}.json"))
        return sorted({item for child in tag["values"] for item in items(child)})

    groups = {}

    def ingredient(value):
        references = value if isinstance(value, list) else [value]
        group = tuple(sorted({item for ref in references for item in items(ref)}))
        return groups.setdefault(group, len(groups))

    fuels = {item: ticks for ticks, names in FUEL_GROUPS.items() for name in names.split()
             for item in items(("#minecraft:" + name[1:]) if name.startswith("#") else ("minecraft:" + name))}
    for excluded in items("#minecraft:non_flammable_wood"):
        fuels.pop(excluded, None)
    cooking = {key: {} for key in ("smelting", "blasting", "smoking")}
    recipes = []
    for path in sorted(jar.namelist()):
        if not path.startswith("data/minecraft/recipe/") or not path.endswith(".json"):
            continue
        recipe = json.loads(jar.read(path))
        if recipe["type"] == "minecraft:crafting_shaped":
            rows = recipe["pattern"]
            width = len(rows[0])
            slots = [ingredient(recipe["key"][key]) if key != " " else None
                     for row in rows for key in row]
        elif recipe["type"] == "minecraft:crafting_shapeless":
            width = 0
            slots = [ingredient(value) for value in recipe["ingredients"]]
        elif recipe["type"].split(":")[-1] in cooking:
            category = recipe["type"].split(":")[-1]
            references = recipe["ingredient"]
            if isinstance(references, str):
                references = [references]
            for item in sorted({it for ref in references for it in items(ref)}):
                cooking[category][item] = [recipe["result"], recipe["cookingtime"]]
            continue
        else:
            continue
        recipes.append([width, slots, recipe["result"]])
    return {"groups": list(groups), "recipes": recipes, "cooking": cooking, "fuels": fuels}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("client", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    with ZipFile(args.client) as jar:
        data = extract(jar)
    args.output.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
