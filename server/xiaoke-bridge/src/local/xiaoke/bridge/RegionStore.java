package local.xiaoke.bridge;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Region registrations belong to the world, not to the bot or its current position. */
final class RegionStore {
    static final Gson JSON = new GsonBuilder().disableHtmlEscaping().create();
    static final int MAX_SPAN = 512;

    record Bounds(int minX, int minZ, int maxX, int maxZ) {
        Bounds {
            if (minX > maxX || minZ > maxZ) throw new IllegalArgumentException("选区边界顺序错误");
        }
        long width() { return (long) maxX - minX + 1; }
        long depth() { return (long) maxZ - minZ + 1; }
        Bounds resize(int width, int depth) {
            if (width < 1 || depth < 1) throw new IllegalArgumentException("选区长宽至少为 1 格");
            return new Bounds(minX, minZ, minX + width - 1, minZ + depth - 1).expand(0);
        }
        Bounds adjust(String direction, int distance) {
            int x0 = minX, z0 = minZ, x1 = maxX, z1 = maxZ;
            switch (direction) {
                case "north" -> z0 -= distance;
                case "south" -> z1 += distance;
                case "east" -> x1 += distance;
                case "west" -> x0 -= distance;
                default -> throw new IllegalArgumentException("方向使用 north、south、east 或 west");
            }
            if (x0 > x1 || z0 > z1) throw new IllegalArgumentException("收缩后的选区长宽至少为 1 格");
            return new Bounds(x0, z0, x1, z1).expand(0);
        }
        Bounds expand(int n) {
            if (n < 0 || n > 128) throw new IllegalArgumentException("周边范围需要在 0 到 128 格之间");
            Bounds b = new Bounds(Math.subtractExact(minX, n), Math.subtractExact(minZ, n),
                    Math.addExact(maxX, n), Math.addExact(maxZ, n));
            if (b.width() > MAX_SPAN || b.depth() > MAX_SPAN) {
                throw new IllegalArgumentException("包含周边的范围最多 512 x 512 格，请缩小选区或周边范围");
            }
            return b;
        }
        boolean contains(int x, int z) { return x >= minX && x <= maxX && z >= minZ && z <= maxZ; }
    }

    record Region(String id, String kind, String owner, String dimension, Bounds bounds,
                  int buffer, String revision, String updatedAt) {
        Bounds readableBounds() { return bounds.expand(buffer); }
    }

    private record Data(String worldId, List<Region> regions) {}
    private final Path file;
    private final String worldId;
    private Map<String, Region> regions = new LinkedHashMap<>();

    RegionStore(Path file) throws IOException {
        this.file = file;
        if (Files.exists(file)) {
            Data data = JSON.fromJson(Files.readString(file, StandardCharsets.UTF_8), Data.class);
            worldId = data.worldId();
            for (Region r : data.regions()) regions.put(r.id(), r);
        } else {
            worldId = UUID.randomUUID().toString();
            persist(regions);
        }
    }

    String worldId() { return worldId; }
    synchronized List<Region> all() { return List.copyOf(regions.values()); }
    synchronized Region get(String id) {
        Region r = regions.get(id);
        if (r == null) throw new IllegalArgumentException("区域不存在或已撤销：" + id);
        return r;
    }
    synchronized Region put(String id, String kind, String owner, String dimension, Bounds bounds,
                            int buffer, boolean operator) throws IOException {
        if (!id.matches("[a-z][a-z0-9_-]{0,31}")) {
            throw new IllegalArgumentException("区域 ID 请使用小写英文字母、数字、下划线或短横线，最多 32 字符");
        }
        checkOwner(id, owner, operator);
        bounds.expand(buffer);
        Region r = new Region(id, kind, owner, dimension, bounds, buffer,
                UUID.randomUUID().toString(), Instant.now().toString());
        Map<String, Region> next = new LinkedHashMap<>(regions);
        next.put(id, r);
        persist(next);
        regions = next;
        return r;
    }
    synchronized void remove(String id, String owner, boolean operator) throws IOException {
        get(id);
        checkOwner(id, owner, operator);
        Map<String, Region> next = new LinkedHashMap<>(regions);
        next.remove(id);
        persist(next);
        regions = next;
    }
    private void checkOwner(String id, String owner, boolean operator) {
        Region old = regions.get(id);
        if (old != null && !operator && !old.owner().equals(owner)) {
            throw new IllegalArgumentException("只能修改自己登记的区域");
        }
    }
    private void persist(Map<String, Region> next) throws IOException {
        Files.createDirectories(file.getParent());
        Path temp = Files.createTempFile(file.getParent(), "regions-", ".tmp");
        try {
            Files.writeString(temp, JSON.toJson(new Data(worldId, List.copyOf(next.values()))), StandardCharsets.UTF_8);
            Files.move(temp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally {
            Files.deleteIfExists(temp);
        }
    }
}
