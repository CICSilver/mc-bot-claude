package local.xiaoke.bridge;

import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.EmptyBlockGetter;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.level.chunk.LevelChunk;
import net.minecraft.world.level.chunk.LevelChunkSection;
import net.minecraft.world.level.chunk.status.ChunkStatus;
import net.minecraft.world.level.chunk.storage.SerializableChunkData;

import java.io.ByteArrayOutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.zip.GZIPOutputStream;

/** Copies live chunk sections on the tick thread; scans detached copies and disk data off-thread. */
final class RegionSnapshots implements AutoCloseable {
    record State(String name, Map<String, String> properties, int color, boolean air, boolean solid, boolean fluid) {}
    record Volume(int minX, int minZ, int maxX, int maxZ, int minY, int maxY) {}
    record Snapshot(String snapshot, String worldId, RegionStore.Region region, Volume bounds,
                    String capturedFrom, String capturedTo, Map<String, Integer> sources,
                    List<int[]> missingChunks, List<State> palette, int[][] columns) {}

    static final class Job {
        final String id = UUID.randomUUID().toString();
        final RegionStore.Region region;
        volatile String status = "capturing";
        volatile String error;
        volatile int completedChunks;
        final int totalChunks;
        volatile byte[] gzip;
        Job(RegionStore.Region region) {
            this.region = region;
            RegionStore.Bounds b = region.readableBounds();
            totalChunks = ((b.maxX() >> 4) - (b.minX() >> 4) + 1) * ((b.maxZ() >> 4) - (b.minZ() >> 4) + 1);
        }
        Map<String, Object> info() {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("snapshot", id); result.put("region", region.id()); result.put("status", status);
            result.put("completedChunks", completedChunks); result.put("totalChunks", totalChunks);
            if (error != null) result.put("error", error);
            return result;
        }
    }

    private final MinecraftServer server;
    private final RegionStore store;
    private final Map<String, Job> jobs = new LinkedHashMap<>();
    private final ExecutorService worker = Executors.newSingleThreadExecutor(Thread.ofPlatform().name("region-capture").daemon().factory());
    RegionSnapshots(MinecraftServer server, RegionStore store) { this.server = server; this.store = store; }

    synchronized Job capture(String id, boolean refresh) {
        RegionStore.Region region = store.get(id);
        Job latest = null;
        for (Job job : jobs.values()) if (job.region.revision().equals(region.revision())) latest = job;
        if (latest != null && (latest.status.equals("capturing") || (!refresh && latest.status.equals("ready")))) return latest;
        if (jobs.values().stream().anyMatch(j -> j.status.equals("capturing"))) {
            throw new IllegalArgumentException("已有区域正在采集，请完成后再读取另一个区域");
        }
        while (jobs.size() >= 4) jobs.remove(jobs.keySet().iterator().next());
        Job job = new Job(region);
        jobs.put(job.id, job);
        worker.submit(() -> {
            try {
                job.gzip = collect(job);
                job.status = "ready";
            } catch (Exception e) {
                job.error = e.toString();
                job.status = "failed";
                XiaokeBridge.LOG.error("[region] 采集 {} 失败", id, e);
            }
        });
        return job;
    }
    synchronized Job get(String id, String region) {
        Job job = jobs.get(id);
        RegionStore.Region current = store.get(region);
        if (job == null || !job.region.id().equals(region) || !job.region.revision().equals(current.revision())) {
            throw new IllegalArgumentException("快照已失效，请重新获取区域总览");
        }
        return job;
    }

    private byte[] collect(Job job) throws Exception {
        String started = Instant.now().toString();
        ServerLevel level = server.submit(() -> server.getLevel(ResourceKey.create(Registries.DIMENSION,
                Identifier.parse(job.region.dimension())))).get(15, TimeUnit.SECONDS);
        if (level == null) throw new IllegalArgumentException("维度未加载：" + job.region.dimension());
        RegionStore.Bounds b = job.region.readableBounds();
        int minY = level.getMinY(), maxY = level.getMaxY();
        int[][] columns = new int[(int) (b.width() * b.depth())][];
        List<State> palette = new ArrayList<>();
        Map<BlockState, Integer> ids = new IdentityHashMap<>();
        List<int[]> missing = new ArrayList<>();
        int live = 0, disk = 0;
        for (int cz = b.minZ() >> 4; cz <= b.maxZ() >> 4; cz++) {
            for (int cx = b.minX() >> 4; cx <= b.maxX() >> 4; cx++) {
                if (Thread.currentThread().isInterrupted()) throw new InterruptedException("区域服务已停止");
                if (!store.get(job.region.id()).revision().equals(job.region.revision())) {
                    throw new IllegalArgumentException("采集期间区域范围已修改或撤销");
                }
                final int xChunk = cx, zChunk = cz;
                LevelChunkSection[] sections = server.submit(() -> {
                    LevelChunk chunk = level.getChunkSource().getChunkNow(xChunk, zChunk);
                    if (chunk == null) return null;
                    return Arrays.stream(chunk.getSections()).map(LevelChunkSection::copy).toArray(LevelChunkSection[]::new);
                }).get(15, TimeUnit.SECONDS);
                if (sections != null) live++;
                else {
                    // Storage read does not add tickets, load entities, run ticks, or generate chunks.
                    var tag = level.getChunkSource().chunkMap.read(new ChunkPos(cx, cz)).get(15, TimeUnit.SECONDS);
                    if (tag.isPresent() && SerializableChunkData.getChunkStatusFromTag(tag.get()) == ChunkStatus.FULL) {
                        SerializableChunkData data = SerializableChunkData.parse(level, level.palettedContainerFactory(), tag.get());
                        if (data != null) {
                            sections = new LevelChunkSection[level.getSectionsCount()];
                            for (var section : data.sectionData()) {
                                int index = section.y() - level.getMinSectionY();
                                if (index >= 0 && index < sections.length) sections[index] = section.chunkSection();
                            }
                            disk++;
                        }
                    }
                }
                if (sections == null) missing.add(new int[] {cx, cz});
                else {
                    for (int z = Math.max(b.minZ(), cz * 16); z <= Math.min(b.maxZ(), cz * 16 + 15); z++) {
                        for (int x = Math.max(b.minX(), cx * 16); x <= Math.min(b.maxX(), cx * 16 + 15); x++) {
                            columns[(int) ((z - b.minZ()) * b.width() + x - b.minX())] = column(sections, x, z, minY, maxY, ids, palette);
                        }
                    }
                }
                job.completedChunks++;
            }
        }
        Snapshot snapshot = new Snapshot(job.id, store.worldId(), job.region,
                new Volume(b.minX(), b.minZ(), b.maxX(), b.maxZ(), minY, maxY), started, Instant.now().toString(),
                Map.of("live", live, "disk", disk, "missing", missing.size()), missing, palette, columns);
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (var out = new OutputStreamWriter(new GZIPOutputStream(bytes), StandardCharsets.UTF_8)) {
            RegionStore.JSON.toJson(snapshot, out);
        }
        return bytes.toByteArray();
    }

    static int[] column(LevelChunkSection[] sections, int x, int z, int minY, int maxY,
                        Map<BlockState, Integer> ids, List<State> palette) {
        int[] runs = new int[(maxY - minY + 1) * 3];
        int length = 0, last = -1, start = minY;
        for (int y = minY; y <= maxY; y++) {
            LevelChunkSection section = sections[(y - minY) >> 4];
            BlockState state = section == null ? Blocks.AIR.defaultBlockState() : section.getBlockState(x & 15, y & 15, z & 15);
            int id = ids.computeIfAbsent(state, key -> { palette.add(state(key)); return palette.size() - 1; });
            if (id != last) {
                if (last >= 0) { runs[length++] = start; runs[length++] = y - 1; runs[length++] = last; }
                last = id; start = y;
            }
        }
        runs[length++] = start; runs[length++] = maxY; runs[length++] = last;
        return Arrays.copyOf(runs, length);
    }
    private static State state(BlockState state) {
        Map<String, String> props = new LinkedHashMap<>();
        for (Property<?> property : state.getProperties()) props.put(property.getName(), propertyValue(state, property));
        return new State(BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString(), props,
                state.getMapColor(EmptyBlockGetter.INSTANCE, BlockPos.ZERO).col, state.isAir(),
                !state.getCollisionShape(EmptyBlockGetter.INSTANCE, BlockPos.ZERO).isEmpty(), !state.getFluidState().isEmpty());
    }
    private static <T extends Comparable<T>> String propertyValue(BlockState state, Property<T> property) {
        return property.getName(state.getValue(property));
    }
    @Override public void close() { worker.shutdownNow(); }
}
