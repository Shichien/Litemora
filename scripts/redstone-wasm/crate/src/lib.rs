//! 浏览器绑定: 在 wasm32 中加载结构文件并逐 tick 运行 Java 26.1.2 红石规则.
//!
//! 输出使用 JSON 字符串, 方块状态以 `minecraft:name[key=value,...]` 表示 (属性按名称排序).

use std::collections::BTreeMap;

use redstone_core::{
    Action, BlockEntityData, BlockPos, BlockStateId, Direction, EntityData, EntityId,
    ExecutionMode, Simulation, SimulationConfig, SparseWorld, TraceKind,
};
use redstone_io::{StructureFormat, StructureLoader, StructureStateResolver, StructureTransform};
#[allow(unused_imports)]
use redstone_java_26::StateResolver;
use redstone_java_26::{JAVA_DATA_VERSION, Java26Registry, Java26Rules, StateResolveError};
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

/// 站在压力板上的占位实体. 同一时刻只有一个.
const PLATE_ENTITY: EntityId = EntityId(0x4c49_5445);

fn compatible_source_release(version: i32) -> Option<&'static str> {
    match version {
        4903 => Some("26.2"),
        5023 => Some("26.3"),
        _ => None,
    }
}

struct RegistryResolver(Java26Registry);

impl StructureStateResolver for RegistryResolver {
    type Error = StateResolveError;

    fn resolve_state(
        &mut self,
        name: &str,
        properties: &BTreeMap<String, String>,
    ) -> Result<BlockStateId, Self::Error> {
        // Converted/older structures may omit properties such as waterlogged.
        // Fill only missing keys from the official default; invalid values still fail.
        let completed = self.0.complete_state_properties(name, properties)?;
        self.0.resolve_state(name, &completed)
    }

    fn complete_state_properties(
        &mut self,
        name: &str,
        properties: &BTreeMap<String, String>,
    ) -> Result<BTreeMap<String, String>, Self::Error> {
        self.0.complete_state_properties(name, properties)
    }

    fn air_state(&self) -> BlockStateId {
        self.0.air_state()
    }
}

fn state_string(registry: &Java26Registry, id: BlockStateId) -> String {
    match registry.state(id) {
        Some(definition) if definition.properties.is_empty() => definition.name.to_string(),
        Some(definition) => format!(
            "{}[{}]",
            definition.name,
            definition
                .properties
                .iter()
                .map(|(key, value)| format!("{key}={value}"))
                .collect::<Vec<_>>()
                .join(",")
        ),
        None => format!("unknown:state_{}", id.0),
    }
}

fn parse_format(format: &str) -> Result<StructureFormat, String> {
    match format
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase()
        .as_str()
    {
        "litematic" => Ok(StructureFormat::Litematic),
        "schem" => Ok(StructureFormat::SpongeSchematic),
        "nbt" | "structure" => Ok(StructureFormat::VanillaStructure),
        other => Err(format!("unsupported structure format: {other}")),
    }
}

/// Canonical runtime fields, rather than the stale NBT aliases retained by the loader.
fn effective_block_entity_fields(
    data: &BlockEntityData,
    current_tick: u64,
    is_comparator: bool,
) -> BTreeMap<String, Value> {
    let mut fields = data.fields.clone();
    if fields.contains_key("inventory") {
        fields.remove("Items");
        fields.remove("items");
        // The first-item shortcut is only read when canonical inventory is absent.
        fields.remove("item_id");
    }
    if fields.contains_key("cooldown") {
        fields.remove("TransferCooldown");
        fields.remove("transfer_cooldown");
        if fields
            .get("cooldown")
            .and_then(Value::as_i64)
            .is_some_and(|v| v <= 0)
        {
            fields.remove("cooldown");
        }
    }
    if is_comparator {
        // load_world uses these once; the live output is in the rules cache below.
        fields.remove("OutputSignal");
        fields.remove("comparator_output");
    }
    if data.kind == "minecraft:moving_piston"
        && let Some(settle_tick) = fields.get("settle_tick").and_then(Value::as_u64)
    {
        fields.insert(
            "settle_tick".to_owned(),
            json!(settle_tick.saturating_sub(current_tick)),
        );
    }
    fields
}

/// 与 wasm-bindgen 无关的模拟核心, 也供原生测试使用.
struct Core {
    simulation: Simulation<Java26Rules>,
    initialized: bool,
    data_version: Option<i32>,
    min: BlockPos,
    max: BlockPos,
    /// 结构区域的最小角. Sponge 结构的方块坐标从这里起算.
    region_min: BlockPos,
}

impl Core {
    fn from_bytes(bytes: &[u8], format: &str, strict: bool) -> Result<Self, String> {
        let format = parse_format(format)?;
        let mut resolver = RegistryResolver(Java26Registry::new());
        let loaded = StructureLoader::load_bytes(
            bytes,
            format,
            StructureTransform::default(),
            &mut resolver,
        )
        .map_err(|error| error.to_string())?;
        if let Some(version) = loaded.data_version
            && version > JAVA_DATA_VERSION
            && compatible_source_release(version).is_none()
        {
            return Err(format!(
                "尚未支持此原理图的数据版本 {version}"
            ));
        }
        Self::from_world(
            resolver.0,
            loaded.world,
            strict,
            loaded.data_version,
            loaded.min,
            loaded.max,
            loaded.region_min,
        )
    }

    fn from_world(
        registry: Java26Registry,
        world: SparseWorld,
        strict: bool,
        data_version: Option<i32>,
        min: BlockPos,
        max: BlockPos,
        region_min: BlockPos,
    ) -> Result<Self, String> {
        let mut simulation = Simulation::load(
            Java26Rules::new(registry),
            world,
            SimulationConfig {
                strict,
                trace: true,
                record_events: false,
                execution_mode: ExecutionMode::Interpreted,
                ..SimulationConfig::default()
            },
        )
        .map_err(|error| error.to_string())?;
        simulation
            .prepare_execution()
            .map_err(|error| error.to_string())?;
        Ok(Self {
            simulation,
            initialized: false,
            data_version,
            min,
            max,
            region_min,
        })
    }

    fn block_at(&self, pos: BlockPos) -> String {
        state_string(
            self.simulation.rules().registry(),
            self.simulation.world().get_block(pos),
        )
    }

    /// Observable cycle signature: blocks plus persistent auxiliary state.
    /// Not a complete Minecraft checkpoint: scheduled/block-event queues, RNG, world
    /// clocks and transient rule caches are omitted. Equality alone cannot prove rest.
    fn fingerprint(&self) -> String {
        let mut sum = 0u64;
        let mut xor = 0u64;
        for (pos, state) in self.simulation.world().iter_blocks() {
            let mut hash = 0xcbf2_9ce4_8422_2325u64;
            for value in [pos.x as u32, pos.y as u32, pos.z as u32, state.0] {
                for byte in value.to_le_bytes() {
                    hash = (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3);
                }
            }
            sum = sum.wrapping_add(hash);
            xor ^= hash.rotate_left(23);
        }
        format!("{sum:016x}{xor:016x}:{}", self.auxiliary_fingerprint())
    }

    /// Persistent non-block state for wire-only warm-up comparisons. No absolute clock.
    fn auxiliary_fingerprint(&self) -> String {
        let rules = self.simulation.rules();
        let world = self.simulation.world();
        let is_comparator = |pos| {
            rules
                .registry()
                .state(world.get_block(pos))
                .is_some_and(|state| state.name.as_ref() == "minecraft:comparator")
        };
        let mut block_entities = world
            .block_entities()
            .filter_map(|(pos, data)| {
                let mut fields = effective_block_entity_fields(
                    data,
                    self.simulation.current_tick().0,
                    is_comparator(*pos),
                );
                if let Some(state) = rules.registry().state(world.get_block(*pos))
                    && state
                        .property("sculk_sensor_phase")
                        .is_some_and(|phase| phase != "active")
                {
                    // An idle sensor overwrites this value before it can be read by a comparator.
                    fields.remove("last_vibration_frequency");
                    fields.remove("LastVibrationFrequency");
                    if fields.is_empty() {
                        return None;
                    }
                }
                Some((*pos, json!([pos.x, pos.y, pos.z, data.kind, fields,])))
            })
            .collect::<Vec<_>>();
        block_entities.sort_by_key(|(pos, _)| *pos);
        let mut entities = world
            .entities()
            .map(|(id, data)| (*id, json!([id.0, data.kind, data.position, data.fields])))
            .collect::<Vec<_>>();
        entities.sort_by_key(|(id, _)| *id);
        let mut comparators = world
            .iter_blocks()
            .filter_map(|(pos, _)| {
                is_comparator(pos).then(|| {
                    (
                        pos,
                        json!([
                            pos.x,
                            pos.y,
                            pos.z,
                            rules
                                .comparator_output_cache()
                                .get(&pos)
                                .copied()
                                .unwrap_or(0),
                        ]),
                    )
                })
            })
            .collect::<Vec<_>>();
        comparators.sort_by_key(|(pos, _)| *pos);
        let value = json!({
            "blockEntities": block_entities.into_iter().map(|(_, value)| value).collect::<Vec<_>>(),
            "entities": entities.into_iter().map(|(_, value)| value).collect::<Vec<_>>(),
            "comparators": comparators.into_iter().map(|(_, value)| value).collect::<Vec<_>>(),
        });
        let hash = value
            .to_string()
            .bytes()
            .fold(0xcbf2_9ce4_8422_2325u64, |hash, byte| {
                (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
            });
        format!("{hash:016x}")
    }

    /// Explicit initialization preserves raw construction for diagnostics and consumes
    /// initialization trace at the current tick (zero when called before stepping).
    fn initialize(&mut self) -> Result<Vec<Value>, String> {
        if self.initialized {
            return Ok(Vec::new());
        }
        self.simulation
            .initialize()
            .map_err(|error| error.to_string())?;
        self.initialized = true;
        Ok(vec![self.take_frame()])
    }

    fn action(pos: BlockPos, kind: &str) -> Result<Action, String> {
        Ok(match kind {
            "use" => Action::UseBlock { pos },
            "lever" => Action::PullLever { pos },
            "button" => Action::PressButton { pos },
            "target" => Action::HitTarget {
                pos,
                face: Direction::Up,
                arrow: true,
                location: [
                    f64::from(pos.x) + 0.5,
                    f64::from(pos.y) + 1.0,
                    f64::from(pos.z) + 0.5,
                ],
            },
            "step" => Action::StepOnBlock { pos },
            "lightning" => Action::StrikeLightningRod { pos },
            "plate_on" | "cart_on" => Action::SpawnEntity {
                id: Some(PLATE_ENTITY),
                data: EntityData {
                    kind: if kind == "cart_on" {
                        "minecraft:minecart"
                    } else {
                        "minecraft:player"
                    }
                    .to_owned(),
                    position: [
                        f64::from(pos.x) + 0.5,
                        f64::from(pos.y) + 0.1,
                        f64::from(pos.z) + 0.5,
                    ],
                    fields: BTreeMap::new(),
                },
            },
            "plate_off" => Action::RemoveEntity { id: PLATE_ENTITY },
            other => return Err(format!("unsupported interaction: {other}")),
        })
    }

    fn step_once(&mut self, actions: &[Action]) -> Result<Value, String> {
        self.simulation
            .step_with_actions(actions)
            .map_err(|error| error.to_string())?;
        Ok(self.take_frame())
    }

    fn take_frame(&mut self) -> Value {
        let trace = self.simulation.take_trace();
        let registry = self.simulation.rules().registry();
        let mut changes = Vec::new();
        let mut unsupported = Vec::new();
        for event in trace {
            match event.kind {
                TraceKind::BlockChanged {
                    pos,
                    old_state,
                    new_state,
                    cause,
                } => changes.push(json!({
                    "x": pos.x,
                    "y": pos.y,
                    "z": pos.z,
                    "state": state_string(registry, new_state),
                    "previousState": state_string(registry, old_state),
                    "microStep": event.micro_step.0,
                    "cause": cause,
                })),
                TraceKind::UnsupportedTrigger { pos, behavior } => unsupported.push(json!({
                    "x": pos.x,
                    "y": pos.y,
                    "z": pos.z,
                    "behavior": behavior,
                })),
                _ => {}
            }
        }
        json!({
            "tick": self.simulation.current_tick().0,
            "changes": changes,
            "unsupported": unsupported,
            "pendingScheduledTicks": self.simulation.pending_scheduled_ticks() + self.simulation.rules().pending_vibrations(),
        })
    }

    fn info(&self) -> Value {
        let registry = self.simulation.rules().registry();
        let mut unsupported = BTreeMap::<String, usize>::new();
        let mut blocks = 0usize;
        for (_, state) in self.simulation.world().iter_blocks() {
            blocks += 1;
            if let Some(definition) = registry.state(state)
                && !definition.supported
            {
                *unsupported.entry(definition.name.to_string()).or_default() += 1;
            }
        }
        json!({
            "tick": self.simulation.current_tick().0,
            "dataVersion": self.data_version,
            "sourceRelease": self.data_version.and_then(compatible_source_release),
            "min": [self.min.x, self.min.y, self.min.z],
            "max": [self.max.x, self.max.y, self.max.z],
            "regionMin": [self.region_min.x, self.region_min.y, self.region_min.z],
            "blocks": blocks,
            "unsupported": unsupported,
        })
    }
}

#[wasm_bindgen(start)]
pub fn start() {
    std::panic::set_hook(Box::new(|info| {
        wasm_bindgen::throw_str(&format!("redstone-wasm panic: {info}"));
    }));
}

#[wasm_bindgen]
pub struct RedstoneSim(Core);

#[wasm_bindgen]
impl RedstoneSim {
    /// `format`: `litematic` | `schem` | `nbt`. `strict` 为 true 时遇到未实现主动行为的方块直接报错.
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: &[u8], format: &str, strict: bool) -> Result<RedstoneSim, JsError> {
        Core::from_bytes(bytes, format, strict)
            .map(Self)
            .map_err(|error| JsError::new(&error))
    }

    pub fn info(&self) -> String {
        self.0.info().to_string()
    }

    /// 当前世界的全部非空气方块: `[[x, y, z, "state"], ...]`.
    pub fn blocks(&self) -> String {
        let registry = self.0.simulation.rules().registry();
        let blocks = self
            .0
            .simulation
            .world()
            .iter_blocks()
            .map(|(pos, state)| json!([pos.x, pos.y, pos.z, state_string(registry, state)]))
            .collect::<Vec<_>>();
        Value::Array(blocks).to_string()
    }

    pub fn block_at(&self, x: i32, y: i32, z: i32) -> String {
        self.0.block_at(BlockPos::new(x, y, z))
    }

    /// Observable state signature, not a complete Minecraft checkpoint.
    pub fn fingerprint(&self) -> String {
        self.0.fingerprint()
    }

    /// Inventories, block entities, entities and live comparator outputs, excluding blocks.
    pub fn auxiliary_fingerprint(&self) -> String {
        self.0.auxiliary_fingerprint()
    }

    /// Reconcile initial block state once. Returns frame[] without advancing time;
    /// subsequent calls return []. Construction itself intentionally remains raw.
    pub fn initialize(&mut self) -> Result<String, JsError> {
        self.0
            .initialize()
            .map(|frames| Value::Array(frames).to_string())
            .map_err(|error| JsError::new(&error))
    }

    pub fn tick(&self) -> f64 {
        self.0.simulation.current_tick().0 as f64
    }

    /// 在下一 tick 开始时对方块执行一次交互并推进该 tick.
    /// `kind`: `use` | `lever` | `button` | `plate_on` | `plate_off`.
    pub fn interact(&mut self, x: i32, y: i32, z: i32, kind: &str) -> Result<String, JsError> {
        let action =
            Core::action(BlockPos::new(x, y, z), kind).map_err(|error| JsError::new(&error))?;
        let frame = self
            .0
            .step_once(&[action])
            .map_err(|error| JsError::new(&error))?;
        Ok(Value::Array(vec![frame]).to_string())
    }

    /// 推进 `ticks` 个游戏刻, 返回每刻的方块变化帧.
    pub fn step(&mut self, ticks: u32) -> Result<String, JsError> {
        let mut frames = Vec::with_capacity(ticks as usize);
        for _ in 0..ticks {
            frames.push(
                self.0
                    .step_once(&[])
                    .map_err(|error| JsError::new(&error))?,
            );
        }
        Ok(Value::Array(frames).to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plate_core() -> (Core, BlockPos) {
        let mut registry = Java26Registry::new();
        let stone = registry
            .resolve_state("minecraft:stone", &BTreeMap::new())
            .unwrap();
        let plate = registry
            .state_by_name("minecraft:oak_pressure_plate", [("powered", "false")])
            .unwrap();
        let mut world = SparseWorld::new(registry.air_state());
        world.set_block(BlockPos::new(0, 0, 0), stone).unwrap();
        let plate_pos = BlockPos::new(0, 1, 0);
        world.set_block(plate_pos, plate).unwrap();
        let core = Core::from_world(
            registry,
            world,
            true,
            None,
            BlockPos::ZERO,
            plate_pos,
            BlockPos::ZERO,
        )
        .unwrap();
        (core, plate_pos)
    }

    #[test]
    fn stepping_on_and_off_a_pressure_plate_round_trips_the_fingerprint() {
        let (mut core, plate_pos) = plate_core();
        let initial = core.fingerprint();
        assert_eq!(
            core.block_at(plate_pos),
            "minecraft:oak_pressure_plate[powered=false]"
        );

        core.step_once(&[Core::action(plate_pos, "plate_on").unwrap()])
            .unwrap();
        for _ in 0..5 {
            core.step_once(&[]).unwrap();
        }
        assert_eq!(
            core.block_at(plate_pos),
            "minecraft:oak_pressure_plate[powered=true]"
        );
        assert_ne!(core.fingerprint(), initial);

        core.step_once(&[Core::action(plate_pos, "plate_off").unwrap()])
            .unwrap();
        for _ in 0..40 {
            core.step_once(&[]).unwrap();
        }
        assert_eq!(
            core.block_at(plate_pos),
            "minecraft:oak_pressure_plate[powered=false]"
        );
        assert_eq!(core.fingerprint(), initial);
    }

    #[test]
    fn missing_structure_properties_use_official_defaults_without_hiding_invalid_values() {
        let mut resolver = RegistryResolver(Java26Registry::new());
        let partial = BTreeMap::from([("type".to_owned(), "top".to_owned())]);
        let id = resolver
            .resolve_state("minecraft:smooth_stone_slab", &partial)
            .unwrap();
        assert_eq!(
            state_string(&resolver.0, id),
            "minecraft:smooth_stone_slab[type=top,waterlogged=false]"
        );
        let invalid = BTreeMap::from([("type".to_owned(), "sideways".to_owned())]);
        assert!(
            resolver
                .resolve_state("minecraft:smooth_stone_slab", &invalid)
                .is_err()
        );
        assert!(
            resolver
                .resolve_state("minecraft:unknown_block", &BTreeMap::new())
                .is_err()
        );
    }

    fn resolve(
        registry: &mut Java26Registry,
        name: &str,
        properties: &[(&str, &str)],
    ) -> BlockStateId {
        let properties = properties
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect();
        let properties = registry
            .complete_state_properties(name, &properties)
            .unwrap();
        registry.resolve_state(name, &properties).unwrap()
    }

    fn core_with_entity(name: &str, fields: BTreeMap<String, Value>) -> Core {
        let mut registry = Java26Registry::new();
        let state = resolve(&mut registry, name, &[]);
        let mut world = SparseWorld::new(registry.air_state());
        world.set_block(BlockPos::ZERO, state).unwrap();
        world.set_block_entity(
            BlockPos::ZERO,
            BlockEntityData {
                kind: name.to_owned(),
                fields,
            },
        );
        Core::from_world(
            registry,
            world,
            true,
            None,
            BlockPos::ZERO,
            BlockPos::ZERO,
            BlockPos::ZERO,
        )
        .unwrap()
    }

    fn block_map(core: &Core) -> BTreeMap<(i32, i32, i32), String> {
        core.simulation
            .world()
            .iter_blocks()
            .map(|(pos, state)| {
                (
                    (pos.x, pos.y, pos.z),
                    state_string(core.simulation.rules().registry(), state),
                )
            })
            .collect()
    }

    #[test]
    fn same_blocks_with_different_inventory_have_different_signatures() {
        let fields = |count| {
            BTreeMap::from([
                (
                    "inventory".to_owned(),
                    if count == 0 {
                        json!([])
                    } else {
                        json!([{"slot": 0, "item_id": "minecraft:stone", "count": count}])
                    },
                ),
                ("item_count".to_owned(), json!(count)),
                ("slot_count".to_owned(), json!(9)),
                ("capacity".to_owned(), json!(576)),
            ])
        };
        let empty = core_with_entity("minecraft:dropper", fields(0));
        let filled = core_with_entity("minecraft:dropper", fields(1));
        assert_eq!(block_map(&empty), block_map(&filled));
        assert_ne!(empty.fingerprint(), filled.fingerprint());
        assert_ne!(
            empty.auxiliary_fingerprint(),
            filled.auxiliary_fingerprint()
        );
        let mut stale_fields = fields(1);
        stale_fields.insert("Items".to_owned(), json!([]));
        stale_fields.insert("item_id".to_owned(), json!("minecraft:dirt"));
        let stale = core_with_entity("minecraft:dropper", stale_fields);
        assert_eq!(
            filled.fingerprint(),
            stale.fingerprint(),
            "retained NBT aliases must not hide canonical state"
        );
    }

    #[test]
    fn comparator_cache_changes_signature_without_changing_blocks() {
        let make = |output| {
            core_with_entity(
                "minecraft:comparator",
                BTreeMap::from([("OutputSignal".to_owned(), json!(output))]),
            )
        };
        let zero = make(0);
        let seven = make(7);
        assert_eq!(block_map(&zero), block_map(&seven));
        assert_eq!(
            zero.simulation
                .rules()
                .comparator_output_cache()
                .get(&BlockPos::ZERO)
                .copied(),
            Some(0)
        );
        assert_eq!(
            seven
                .simulation
                .rules()
                .comparator_output_cache()
                .get(&BlockPos::ZERO)
                .copied(),
            Some(7)
        );
        let zero_data = zero
            .simulation
            .world()
            .block_entity(BlockPos::ZERO)
            .unwrap();
        let seven_data = seven
            .simulation
            .world()
            .block_entity(BlockPos::ZERO)
            .unwrap();
        assert_eq!(
            effective_block_entity_fields(zero_data, 0, true),
            effective_block_entity_fields(seven_data, 0, true)
        );
        assert_ne!(zero.auxiliary_fingerprint(), seven.auxiliary_fingerprint());
        assert_ne!(zero.fingerprint(), seven.fingerprint());
    }

    #[test]
    fn neutral_cooldown_and_shifted_piston_time_do_not_break_signatures() {
        let baseline = BlockEntityData {
            kind: "minecraft:hopper".to_owned(),
            fields: BTreeMap::new(),
        };
        let zero = BlockEntityData {
            kind: baseline.kind.clone(),
            fields: BTreeMap::from([
                ("cooldown".to_owned(), json!(0)),
                ("TransferCooldown".to_owned(), json!(8)),
            ]),
        };
        assert_eq!(
            effective_block_entity_fields(&baseline, 0, false),
            effective_block_entity_fields(&zero, 100, false)
        );
        let moving = |settle_tick| BlockEntityData {
            kind: "minecraft:moving_piston".to_owned(),
            fields: BTreeMap::from([
                ("settle_tick".to_owned(), json!(settle_tick)),
                ("moved_state".to_owned(), json!(1)),
            ]),
        };
        assert_eq!(
            effective_block_entity_fields(&moving(12), 10, false),
            effective_block_entity_fields(&moving(102), 100, false)
        );
        assert_ne!(
            effective_block_entity_fields(&moving(12), 10, false),
            effective_block_entity_fields(&moving(103), 100, false)
        );
    }

    #[test]
    fn entities_change_auxiliary_state_and_removal_restores_it() {
        let (mut core, _) = plate_core();
        let initial_blocks = block_map(&core);
        let initial = core.fingerprint();
        let auxiliary = core.auxiliary_fingerprint();
        core.step_once(&[Core::action(BlockPos::new(10, 0, 0), "plate_on").unwrap()])
            .unwrap();
        assert_eq!(block_map(&core), initial_blocks);
        assert_ne!(core.fingerprint(), initial);
        assert_ne!(core.auxiliary_fingerprint(), auxiliary);
        core.step_once(&[Core::action(BlockPos::ZERO, "plate_off").unwrap()])
            .unwrap();
        assert_eq!(core.fingerprint(), initial);
    }

    #[test]
    fn initialization_is_explicit_idempotent_and_trace_replays_exactly() {
        let mut registry = Java26Registry::new();
        let source = resolve(&mut registry, "minecraft:redstone_block", &[]);
        let stone = resolve(&mut registry, "minecraft:stone", &[]);
        let wire = resolve(&mut registry, "minecraft:redstone_wire", &[("power", "0")]);
        let lamp = resolve(
            &mut registry,
            "minecraft:redstone_lamp",
            &[("lit", "false")],
        );
        let mut world = SparseWorld::new(registry.air_state());
        for (pos, state) in [
            (BlockPos::ZERO, source),
            (BlockPos::new(1, -1, 0), stone),
            (BlockPos::new(1, 0, 0), wire),
            (BlockPos::new(2, 0, 0), lamp),
        ] {
            world.set_block(pos, state).unwrap();
        }
        let mut core = Core::from_world(
            registry,
            world,
            true,
            None,
            BlockPos::new(0, -1, 0),
            BlockPos::new(2, 0, 0),
            BlockPos::ZERO,
        )
        .unwrap();
        assert!(
            core.block_at(BlockPos::new(1, 0, 0)).contains("power=0"),
            "constructor must remain raw"
        );
        let mut replay = block_map(&core);
        let frames = core.initialize().unwrap();
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0]["tick"], 0);
        assert!(!frames[0]["changes"].as_array().unwrap().is_empty());
        let apply = |replay: &mut BTreeMap<(i32, i32, i32), String>, frame: &Value| {
            for change in frame["changes"].as_array().unwrap() {
                let pos = (
                    change["x"].as_i64().unwrap() as i32,
                    change["y"].as_i64().unwrap() as i32,
                    change["z"].as_i64().unwrap() as i32,
                );
                assert_eq!(
                    replay
                        .get(&pos)
                        .map(String::as_str)
                        .unwrap_or("minecraft:air"),
                    change["previousState"].as_str().unwrap()
                );
                assert!(change["microStep"].as_u64().is_some());
                assert!(!change["cause"].as_str().unwrap().is_empty());
                let state = change["state"].as_str().unwrap();
                if state == "minecraft:air" {
                    replay.remove(&pos);
                } else {
                    replay.insert(pos, state.to_owned());
                }
            }
        };
        apply(&mut replay, &frames[0]);
        assert_eq!(replay, block_map(&core));
        assert!(core.simulation.take_trace().is_empty());
        let fingerprint = core.fingerprint();
        let pending = core.simulation.pending_scheduled_ticks();
        assert_eq!(frames[0]["pendingScheduledTicks"], pending);
        assert!(core.initialize().unwrap().is_empty());
        assert_eq!(core.simulation.current_tick().0, 0);
        assert_eq!(core.fingerprint(), fingerprint);
        assert_eq!(core.simulation.pending_scheduled_ticks(), pending);
        for _ in 0..4 {
            let frame = core.step_once(&[]).unwrap();
            apply(&mut replay, &frame);
            assert_eq!(replay, block_map(&core));
        }
        assert!(core.initialize().unwrap().is_empty());
    }

    #[test]
    fn unknown_interactions_and_formats_are_rejected() {
        assert!(Core::action(BlockPos::ZERO, "dance").is_err());
        assert!(parse_format("schematic").is_err());
        assert!(parse_format(".LITEMATIC").is_ok());
    }
}
