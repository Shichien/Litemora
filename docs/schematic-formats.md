# Schematic format support

Litemora accepts `.litematic`, Sponge `.schem` (v1/v2/v3), legacy MCEdit `.schematic`, Axiom `.bp`, and ReplayMod `.mcpr` uploads. The server validates the extension and preserves the original bytes for download.

The browser parser identifies the binary structure before normalizing it. Litematic uses NBT regions and packed block states; Sponge uses palette plus VarInt block data; legacy MCEdit uses numeric `Blocks`/`Data` IDs mapped through the bundled Minecraft legacy table; Axiom support targets the Axiom Blueprint v1 container (magic `0A E5 BB 36`) with metadata `Version: 0` and gzip NBT chunk regions.

The installed `schematic-renderer`/Nucleation WASM import API supports Litematic, Sponge `schematic`, `mcstructure`, snapshot, MCA, and WorldZip. It does not import Axiom `.bp` or legacy `.schematic` directly. Litemora converts Axiom `.bp` and legacy `.schematic` to an internal Litematic buffer for preview. Sponge v1 is also converted because the installed renderer expects the newer Sponge layout; Sponge v2/v3 use the renderer's native path. The uploaded source remains unchanged.

The conversion path currently carries block states, dimensions, positions, palettes, and packed block data. Axiom preview conversion does not yet carry block entity NBT, entities, or sign/container contents. Legacy numeric IDs not present in the bundled table are rejected instead of being guessed. Axiom blueprints with unsupported versions or malformed section lengths are rejected.

The format tests exercise real NBT parsing, renderer round trips through the installed WASM, Axiom 4-bit and 5-bit palette packing across long boundaries, negative chunk coordinates, malformed inputs, extension validation, and upload/download byte preservation. A real 190,989-byte Litematic backup was parsed as one region with dimensions `245×240×245`; the renderer read `227,507` blocks and dimensions `245×240×245`.

Axiom structure reference: [Axiom Blueprint v1](https://github.com/nahkd123/file-structures-index/tree/main/includes/mc-schematic/axiom-blueprint-v1).
