"""Build the collision and blast tables after checking them against Mojang's 26.1.2 state IDs."""
import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("official_blocks", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
official = json.loads(args.official_blocks.read_bytes())
path = Path(__file__).resolve().parents[2] / "node_modules/minecraft-data/minecraft-data/data/pc/26.1"
blocks = json.loads((path / "blocks.json").read_bytes())
shapes = json.loads((path / "blockCollisionShapes.json").read_bytes())
states = []
resistances = []
for block in blocks:
    name = block["name"]
    entries = official["minecraft:" + name]["states"]
    ids = [entry["id"] for entry in entries]
    if ids != list(range(block["minStateId"], block["maxStateId"] + 1)) or ids[0] != len(states):
        raise ValueError("Block state ID mismatch for " + name)
    default = next(entry["id"] for entry in entries if entry.get("default"))
    if default != block["defaultState"]:
        raise ValueError("Default state mismatch for " + name)
    refs = shapes["blocks"][name]
    states.extend(refs if isinstance(refs, list) else [refs] * len(ids))
    resistances.extend([block["resistance"]] * len(ids))
if len(blocks) != len(official):
    raise ValueError("Registry size mismatch")
boxes = shapes["shapes"]
table = {"states": states, "boxes": [boxes[str(i)] for i in range(len(boxes))], "resistance": resistances}
entities = json.loads((path / "entities.json").read_bytes())
table["living"] = sorted("minecraft:" + e["name"] for e in entities if "health" in e["metadataKeys"])
dimensions = {"minecraft:" + e["name"]: [e["width"], e["height"]] for e in entities}
args.output.with_name("entity_dimensions.json").write_text(json.dumps(dimensions, separators=(",", ":")), encoding="utf-8")
args.output.write_text(json.dumps(table, separators=(",", ":")), encoding="utf-8")
