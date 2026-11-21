import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import net.minecraft.SharedConstants;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.level.EmptyBlockGetter;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;

// Run with JDK 25 and the server and library jars extracted from Mojang's 26.1 server bundle:
// java -cp <classpath> scripts/GenerateSelectionShapes.java <minecraft-data blocks.json> <output.json>
class GenerateSelectionShapes {
    public static void main(String[] args) throws Exception {
        SharedConstants.tryDetectVersion();
        Bootstrap.bootStrap();
        var definitions = JsonParser.parseString(Files.readString(Path.of(args[0]))).getAsJsonArray();
        var shapes = new LinkedHashMap<List<List<Double>>, Integer>();
        var stateShapes = new ArrayList<Integer>();
        for (var entry : definitions) {
            JsonObject definition = entry.getAsJsonObject();
            int first = definition.get("minStateId").getAsInt();
            int last = definition.get("maxStateId").getAsInt();
            var block = Block.stateById(first).getBlock();
            if (first != stateShapes.size()
                || !BuiltInRegistries.BLOCK.getKey(block).getPath().equals(definition.get("name").getAsString())
                || Block.getId(block.defaultBlockState()) != definition.get("defaultState").getAsInt()
                || block.getStateDefinition().getPossibleStates().size() != last - first + 1) {
                throw new IllegalArgumentException("State registry mismatch at " + definition.get("name"));
            }
            for (int id = first; id <= last; id++) {
                var boxes = outline(Block.stateById(id));
                stateShapes.add(shapes.computeIfAbsent(boxes, key -> shapes.size()));
            }
        }
        if (stateShapes.size() != Block.BLOCK_STATE_REGISTRY.size()) {
            throw new IllegalArgumentException("Incomplete state registry");
        }
        var data = new LinkedHashMap<String, Object>();
        data.put("version", SharedConstants.getCurrentVersion().name());
        data.put("shapes", shapes.keySet());
        data.put("states", stateShapes);
        Files.writeString(Path.of(args[1]), new Gson().toJson(data) + "\n");
    }

    private static List<List<Double>> outline(BlockState state) {
        var level = EmptyBlockGetter.INSTANCE;
        var shape = state.getShape(level, BlockPos.ZERO);
        // Both schematic renderers place plant models at the cell center. Remove
        // the positional jitter only for states whose outline actually moves.
        if (state.hasOffsetFunction()
            && !shape.toAabbs().equals(state.getShape(level, new BlockPos(1, 0, 1)).toAabbs())) {
            shape = shape.move(state.getOffset(BlockPos.ZERO).scale(-1));
        }
        return shape.toAabbs().stream()
            .map(box -> List.of(box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ))
            .toList();
    }
}
