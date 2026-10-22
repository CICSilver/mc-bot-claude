package local.xiaoke.bridge;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import net.minecraft.SharedConstants;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.level.chunk.LevelChunkSection;

public final class RegionCheck {
    private static int checks;
    private static void check(boolean value, String name) {
        if (!value) throw new AssertionError(name);
        checks++;
    }
    public static void main(String[] args) throws Exception {
        Path dir = Files.createTempDirectory(Path.of("."), "region-check-");
        Path file = dir.resolve("regions.json");
        try {
            RegionStore store = new RegionStore(file);
            RegionStore.Bounds bounds = new RegionStore.Bounds(-31, -20, 4, 7);
            var home = store.put("home", "region", "alice", "minecraft:overworld", bounds, 32, false);
            check(home.readableBounds().minX() == -63 && home.readableBounds().maxZ() == 39, "buffer and negative coordinates");
            RegionStore reloaded = new RegionStore(file);
            check(reloaded.worldId().equals(store.worldId()) && reloaded.get("home").equals(home), "registration survives reload");
            try {
                store.remove("home", "bob", false);
                throw new AssertionError("owner check");
            } catch (IllegalArgumentException expected) { checks++; }
            var updated = store.put("home", "region", "alice", "minecraft:overworld", bounds, 0, false);
            check(!updated.revision().equals(home.revision()), "resize invalidates snapshots");
            store.remove("home", "alice", false);
            check(new RegionStore(file).all().isEmpty(), "revocation persists");

            Regions.Selection selection = new Regions.Selection("minecraft:overworld");
            check(selection.picking(), "selection starts armed");
            selection.first = new net.minecraft.core.BlockPos(4, 90, 7);
            selection.second = new net.minecraft.core.BlockPos(-31, 64, -20);
            check(!selection.picking() && selection.bounds().equals(bounds), "two clicks resolve horizontal bounds independently of Y");
            check(bounds.adjust("east", 12).equals(new RegionStore.Bounds(-31, -20, 16, 7)), "expand east moves east edge");
            check(bounds.adjust("west", 12).equals(new RegionStore.Bounds(-43, -20, 4, 7)), "expand west moves west edge");
            check(bounds.adjust("north", 12).equals(new RegionStore.Bounds(-31, -32, 4, 7)), "expand north uses negative Z");
            check(bounds.adjust("south", 12).equals(new RegionStore.Bounds(-31, -20, 4, 19)), "expand south uses positive Z");
            for (String direction : java.util.List.of("north", "south", "east", "west")) {
                check(bounds.adjust(direction, 12).adjust(direction, -12).equals(bounds), "shrink reverses expansion: " + direction);
            }
            var resized = bounds.resize(80, 60);
            check(resized.equals(new RegionStore.Bounds(-31, -20, 48, 39)), "size fixes northwest corner and counts inclusive blocks");
            selection.setBounds(resized, 90);
            check(selection.bounds().equals(resized) && !selection.picking(), "resized draft stays out of right-click selection mode");
            try {
                bounds.adjust("south", -28);
                throw new AssertionError("shrink consumed whole selection");
            } catch (IllegalArgumentException expected) { checks++; }

            SharedConstants.tryDetectVersion();
            Bootstrap.bootStrap();
            var palette = new ArrayList<RegionSnapshots.State>();
            var runs = RegionSnapshots.column(new LevelChunkSection[24], -1, -1, -64, 319, new IdentityHashMap<>(), palette);
            check(runs.length == 3 && runs[0] == -64 && runs[1] == 319, "full-height column encoding");
            check(palette.get(runs[2]).air(), "known air has a palette entry");
            System.out.println("RegionCheck: passed " + checks);
        } finally {
            Files.deleteIfExists(file);
            Files.deleteIfExists(dir);
        }
    }
}
