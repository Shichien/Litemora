# Raw ReplayMod decoder and generated data

The browser entry point is `../replaymod-loader.js`, exporting `loadReplayMod(input, { onProgress, signal, limits })`. `input` is an `ArrayBuffer` or `Uint8Array`; the worker takes ownership of its buffer. `../replaymod-parser.js` exports `parseReplayMod` and `decodeRecording` for tests and non-worker use. No Minecraft server or Node protocol package runs in the browser.

## Supported Java protocols

| Protocol | Exact accepted Minecraft versions | Validation |
| --- | --- | --- |
| 763 | 1.20, 1.20.1 | Original public 1.20.1 MCPR plus independent binary tests |
| 765 | 1.20.3, 1.20.4 | Original public 1.20.4 MCPR plus independent binary tests |
| 767 | 1.21, 1.21.1 | Independent binary packet tests |
| 769 | 1.21.4 | Independent binary packet tests; minecart layout independently checked against vanilla |

Versions outside this table, and a version/protocol mismatch, produce `UNSUPPORTED_VERSION` with the complete supported list. MCPR file format versions 10–14 are accepted for protocol 763; newer protocols require format 14 and its login/configuration transition. This list describes network decoding support, not pixel-identical vanilla client simulation.

## Data source and generation

Run `node src/js/replaymod/data/generate-tables.mjs` after deliberately reviewing an update to the installed `minecraft-data` package. The checked-in protocol modules were generated from **minecraft-data 3.105.0**, whose npm package declares the MIT license. Attribution: [PrismarineJS/node-minecraft-data](https://github.com/PrismarineJS/node-minecraft-data) and its [Minecraft data repository](https://github.com/PrismarineJS/minecraft-data). The generator runs in Node; generated modules consist only of static JavaScript data.

Each module contains protocol packet ID maps and schemas, exact block-state property ranges, opacity/bounding-box hints, entity IDs, and item IDs. All known play packets are either decoded or explicitly listed as non-world UI/audio/lighting/control traffic. An unknown packet ID, unknown block/entity/item ID, or unhandled world packet fails instead of quietly dropping a world mutation. Non-world packet counts remain visible in `stats.ignoredPackets`.

`../replaymod-data.js` corrects known 3.105.0 schema issues:

- Optional global positions include both the dimension string and packed block position.
- 1.20.4 particle metadata consumes the numeric particle ID and its data; older vibration destinations use a resource-location discriminator and float entity eye height.
- 1.21.4 teleport packets contain double positions/velocities, float angles, and relative flags. Dust particles use packed integer colors; trail particles include a target, color, and duration.
- Experimental 1.21.4 minecart steps contain six big-endian doubles, two angle bytes, and a float weight, **54 bytes per step**. The upstream table's float vectors are incorrect.

Wire references: [ReplayStudio packet-stream state machine](https://github.com/ReplayMod/ReplayStudio/blob/master/src/main/java/com/replaymod/replaystudio/io/ReplayInputStream.java), [ReplayStudio player camera packet](https://github.com/ReplayMod/ReplayStudio/blob/master/src/main/java/com/replaymod/replaystudio/protocol/packets/PacketPlayerPositionRotation.java), [current 1.21.4 protocol definitions](https://github.com/PrismarineJS/minecraft-data/blob/master/data/pc/1.21.4/proto.yml), and [MCProtocolLib 1.21.4 minecart reader at commit 7cc247026c6bff700c644d545942f7733ebb6ad0](https://github.com/GeyserMC/MCProtocolLib/blob/7cc247026c6bff700c644d545942f7733ebb6ad0/protocol/src/main/java/org/geysermc/mcprotocollib/protocol/packet/ingame/clientbound/entity/ClientboundMoveMinecartPacket.java). The minecart format was also checked against the vanilla 1.21.4 client JAR, SHA-1 `a7e5a6024bfd3cd614625aa05629adf760020304`.

## Decoder contract

The result contains `{ format: 'replaymod', metadata, durationMs, initialCamera, events, blockStates, entityTypes, warnings, stats }`. `metadata.kind` is `replaymod`; metadata also includes the Minecraft version, numeric protocol, duration, generator, date, server name, file format version, player entity ID, and the source player list when present.

Every event has **`timeMs`**, an integer timestamp in milliseconds, and `type`. Original packet order is preserved for equal timestamps. Durations are `max(metadata.duration, lastPacketTimestamp)`, and short declared durations produce a warning. Initial camera is `{ x, y, z, yaw, pitch, dimension }` or `null`; ReplayMod's recorder UUID is matched to its actual entity rather than the synthetic negative join-game ID. Angles use Minecraft degrees.

Core events:

- `dimension`: `dimension`, `dimensionType`, `minY`, `height`. Reset chunks/entities/camera.
- `chunk`: chunk coordinates `x,z`, `sections: [{ y, states: Uint32Array(4096) }]`, and `blockEntities`. Replace the complete old chunk, including omitted air sections. Section `y` is an absolute section coordinate. Index is `x + (z << 4) + (localY << 8)`.
- `unloadChunk`: chunk coordinates `x,z`.
- `block`: block coordinates `x,y,z` and numeric `state`; `blocks`: `changes` with the same fields.
- `blockEntity`: `x,y,z,blockEntityType,data`; embedded chunk entries use `type` for their block-entity type ID.
- `blockAction`: `x,y,z,action,parameter,blockId,block` (namespaced name).
- `entitySpawn`: `id,uuid,entityType,x,y,z,yaw,pitch,data`. `type` is the event discriminator; entity kind is **`entityType`**.
- `entityMove`: `id,x,y,z,yaw,pitch,relative:false`, with deltas resolved against recorded entity state.
- `entityRemove`: `ids`; `entityData`: `id,metadata,item?`. Item stacks are `{id,name,count,nbt?,components?,removedComponents?}` or `null`.
- `camera`: `x,y,z,yaw,pitch,dimension`.

The decoder also preserves equipment, velocity, head angles, passenger/leash relationships, pickup, biome changes, camera targets, vehicle/minecart steps, and world/entity effects. `blockStates[state]` contains `{ name, properties, transparent, boundingBox }`; names are namespaced and state zero is air. Replaying the events from the beginning reconstructs a seek; playback must copy section arrays before mutating them.

## Bounds and malformed data

Defaults: archive 128 MiB, total advertised expanded ZIP content 384 MiB, raw packet stream 256 MiB, metadata 256 KiB, packet 8 MiB, 256 ZIP entries, 2,000,000 records, 500,000 events, 100,000 live entities, 1,024-block dimension height, seven-day duration, and a 192 MiB decoded allocation budget. Caller overrides may only lower these limits.

The decoded budget estimates chunk buffers, decoded arrays/objects/strings, and retained event payloads; it is not an exact JavaScript heap measurement. ZIP inflation, protocol tables, the raw stream, and temporary decoder buffers also consume memory. Central-directory checks run before JSZip loading, inflation stops on size overflow, and extracted metadata/recording CRCs are checked. ZIP64/split/encrypted archives, unsafe or duplicate paths, malformed lengths, excessive nesting, invalid palettes, nonfinite coordinates, and invalid world/dimension coordinates are rejected. Network strings use UTF-8; NBT strings use Java modified UTF-8, including nulls and surrogate pairs.

## Scope and observable limitations

World data comes exclusively from **`recording.tmcpr`**. Any `redstone/render-v2.bin` sidecar is ignored. Full chunks, chunk replacements/unloads, single/multi block updates, pre-1.21.4 explosion block destruction, spawn/movement/teleport/removal, item metadata, and dimension changes are decoded.

Piston block actions need client behavior beyond packet decoding and emit `PISTON_SIMULATION_REQUIRED`; renderer-side support determines fidelity for sticky/slime/honey and moving blocks. Custom plugin/mod payloads emit `CUSTOM_PAYLOAD`; unsupported mod registry IDs fail. Experimental minecart interpolation steps are retained, while the generic entity transform follows the final step and emits a warning. Biome changes and server-forced look-at packets are retained with renderer-support warnings. Lighting, particles outside entity metadata, sounds, player skins, resource packs, UI, and client-side physics are not reconstructed by this parser.

Vanilla-generated section padding is accepted only when bounded and all zero. An inflated advisory non-air count (observed in the genuine 1.20.4 sample) produces `SECTION_COUNT_MISMATCH`; the validated 4096-state palette remains authoritative.

Tests: `node --test tests/replaymod-parser.test.mjs`. These use independent hand-written binary encoders and exercise the actual playback class. An optional genuine raw packet excerpt is tested when downloaded locally; its provenance and extraction instructions are in `tests/fixtures/replaymod/README.md`. Third-party recording bytes are not redistributed.
