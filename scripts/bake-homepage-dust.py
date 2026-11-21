"""Bake the homepage's top-down dust tiles from the bundled Java Edition pack."""
from pathlib import Path

from PIL import Image


PUBLIC = Path(__file__).resolve().parents[1] / "public"
TEXTURES = PUBLIC / "minecraft-default-pack/assets/minecraft/textures/block"
OUTPUT = PUBLIC / "homepage"
TILE = 16
# RedStoneWireBlock.getColorForPower(0) and (15), after Java float conversion.
TINTS = [(76, 0, 0), (255, 50, 0)]


def texture(name):
    with Image.open(TEXTURES / f"{name}.png") as image:
        return image.convert("RGBA")


def dust(name, tint):
    image = texture(f"redstone_dust_{name}")
    channels = [
        channel.point(lambda value: round(value * multiplier / 255))
        for channel, multiplier in zip(image.split(), tint)
    ]
    tinted = Image.merge("RGBA", (*channels, image.getchannel("A")))
    return Image.alpha_composite(tinted, texture("redstone_dust_overlay"))


def bake():
    rail = Image.new("RGBA", (6 * TILE, TILE))
    button = Image.new("RGBA", (3 * TILE, 4 * TILE))
    horizontal = []
    for state, tint in enumerate(TINTS):
        north_south = dust("line0", tint)
        line1 = dust("line1", tint)
        # redstone_wire.json rotates line1 by 270 degrees clockwise.
        east_west = line1.transpose(Image.Transpose.ROTATE_90)
        horizontal.append(east_west)
        # Vanilla multipart order for the south/east bend: dot, south, east.
        bend = dust("dot", tint)
        for tile, box in [(north_south, (0, 8, 16, 16)), (east_west, (8, 0, 16, 16))]:
            bend.alpha_composite(tile.crop(box), dest=box[:2])
        # CSS rotates the second column along with its repeating strip.
        for column, tile in enumerate((north_south, line1, bend)):
            rail.paste(tile, ((3 * state + column) * TILE, 0))

    for frame in range(4):
        for column in range(2):
            button.paste(horizontal[int(frame > column)], (column * TILE, frame * TILE))
        lamp = texture("redstone_lamp_on" if frame == 3 else "redstone_lamp")
        button.paste(lamp, (2 * TILE, frame * TILE))

    rail.save(OUTPUT / "redstone-rail.png")
    button.save(OUTPUT / "redstone-button.png")


if __name__ == "__main__":
    bake()
