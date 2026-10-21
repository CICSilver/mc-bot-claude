package local.xiaoke.bridge;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.RequiredArgumentBuilder;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.SharedSuggestionProvider;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.game.ClientboundBlockUpdatePacket;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.storage.LevelResource;
import net.minecraft.world.phys.BlockHitResult;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

final class Regions {
    private Regions() {}
    static RegionStore store;
    private static RegionHttp http;
    private static final Map<UUID, Selection> selections = new HashMap<>();
    private static int ticks;

    static final class Selection {
        final String dimension;
        BlockPos first;
        BlockPos second;
        long lastClick;
        String editingId;
        Selection(String dimension) { this.dimension = dimension; }
        boolean picking() { return second == null; }
        RegionStore.Bounds bounds() {
            if (second == null) throw new IllegalArgumentException("请先右键选完两个角");
            return new RegionStore.Bounds(Math.min(first.getX(), second.getX()), Math.min(first.getZ(), second.getZ()),
                    Math.max(first.getX(), second.getX()), Math.max(first.getZ(), second.getZ()));
        }
        void setBounds(RegionStore.Bounds bounds, int y) {
            first = new BlockPos(bounds.minX(), y, bounds.minZ());
            second = new BlockPos(bounds.maxX(), y, bounds.maxZ());
        }
    }

    static void start(MinecraftServer server) {
        try {
            store = new RegionStore(server.getWorldPath(LevelResource.ROOT).resolve("region-planner/regions.json"));
            http = new RegionHttp(server, store, Integer.getInteger("region.planner.port", 25620));
            XiaokeBridge.LOG.info("[region] 只读区域接口已启动，登记区域 {} 个", store.all().size());
        } catch (IOException | RuntimeException e) {
            store = null;
            XiaokeBridge.LOG.error("[region] 区域服务启动失败", e);
        }
    }
    static void stop() {
        if (http != null) http.close();
        http = null;
        store = null;
        selections.clear();
    }
    static void disconnect(ServerPlayer player) { selections.remove(player.getUUID()); }

    static boolean consumes(Player player) {
        Selection s = selections.get(player.getUUID());
        return s != null && (s.picking() || System.currentTimeMillis() - s.lastClick < 400);
    }

    static InteractionResult onUseBlock(Player player, Level level, InteractionHand hand, BlockHitResult hit) {
        if (!(player instanceof ServerPlayer sp) || !(level instanceof ServerLevel sl) || !consumes(player)) {
            return InteractionResult.PASS;
        }
        // Restore predicted client placement as well as suppressing both hands on the server.
        sp.connection.send(new ClientboundBlockUpdatePacket(sl, hit.getBlockPos()));
        sp.connection.send(new ClientboundBlockUpdatePacket(sl, hit.getBlockPos().relative(hit.getDirection())));
        sp.containerMenu.sendAllDataToRemote();
        if (hand != InteractionHand.MAIN_HAND) return InteractionResult.FAIL;
        Selection s = selections.get(sp.getUUID());
        long now = System.currentTimeMillis();
        if (!s.picking() || now - s.lastClick < 400) return InteractionResult.FAIL;
        if (!s.dimension.equals(sl.dimension().identifier().toString())) {
            sp.sendSystemMessage(Component.literal("两个角必须在同一维度。用 /region select 重新选择。"));
            return InteractionResult.FAIL;
        }
        s.lastClick = now;
        if (s.first == null) {
            s.first = hit.getBlockPos().immutable();
            sp.sendSystemMessage(Component.literal("已选第一个角，请右键对角的方块。"));
        } else {
            s.second = hit.getBlockPos().immutable();
            RegionStore.Bounds b = s.bounds();
            sp.sendSystemMessage(Component.literal("选区 " + b.width() + " x " + b.depth() + " 格，面积 "
                    + b.width() * b.depth() + "。右键已恢复。保存：/region save home buffer 32；临时分享：/region share hillside"));
        }
        return InteractionResult.FAIL;
    }

    static void tick(MinecraftServer server) {
        if (++ticks % 20 != 0) return;
        for (ServerPlayer p : server.getPlayerList().getPlayers()) {
            Selection s = selections.get(p.getUUID());
            if (s == null || s.first == null || !s.dimension.equals(p.level().dimension().identifier().toString())) continue;
            ServerLevel level = p.level();
            dot(level, p, s.first.getX() + 0.5, s.first.getY() + 1.1, s.first.getZ() + 0.5);
            if (s.second == null) continue;
            RegionStore.Bounds b = s.bounds();
            double y = Math.max(s.first.getY(), s.second.getY()) + 1.1;
            int step = Math.max(1, (int) Math.ceil(Math.max(b.width(), b.depth()) / 48.0));
            for (int x = b.minX(); x <= b.maxX() + 1; x += step) {
                dot(level, p, x, y, b.minZ()); dot(level, p, x, y, b.maxZ() + 1);
            }
            for (int z = b.minZ(); z <= b.maxZ() + 1; z += step) {
                dot(level, p, b.minX(), y, z); dot(level, p, b.maxX() + 1, y, z);
            }
        }
    }
    private static void dot(ServerLevel level, ServerPlayer player, double x, double y, double z) {
        level.sendParticles(player, ParticleTypes.END_ROD, true, true, x, y, z, 1, 0, 0, 0, 0);
    }

    private interface Operation { String run(CommandSourceStack source) throws IOException; }
    private static int run(CommandSourceStack source, Operation operation) {
        try {
            if (store == null) throw new IllegalArgumentException("区域服务尚未启动，请查看服务端日志");
            String message = operation.run(source);
            source.sendSuccess(() -> Component.literal(message), false);
            return 1;
        } catch (IOException | IllegalArgumentException e) {
            source.sendFailure(Component.literal(e.getMessage()));
            return 0;
        }
    }
    private static boolean operator(CommandSourceStack s) {
        return Commands.hasPermission(Commands.LEVEL_GAMEMASTERS).test(s);
    }
    private static String owner(CommandSourceStack source) {
        return source.getPlayer() == null ? "console" : source.getPlayer().getUUID().toString();
    }
    private static RequiredArgumentBuilder<CommandSourceStack, String> id() {
        return Commands.argument("id", StringArgumentType.word()).suggests((ctx, builder) ->
                SharedSuggestionProvider.suggest(store == null ? java.util.List.of() : store.all().stream().map(RegionStore.Region::id).toList(), builder));
    }
    static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("region")
            .executes(ctx -> run(ctx.getSource(), s -> "/region select 后右键两个角，用 expand/shrink/size 微调，再 save home buffer 32。修改已有区域：/region edit home"))
            .then(Commands.literal("select").requires(s -> s.getPlayer() != null).executes(ctx -> run(ctx.getSource(), s -> {
                selections.put(s.getPlayer().getUUID(), new Selection(s.getLevel().dimension().identifier().toString()));
                return "选区模式已开启。右键两个角的方块；取消：/region cancel";
            })))
            .then(Commands.literal("cancel").executes(ctx -> run(ctx.getSource(), s -> {
                if (s.getPlayer() != null) selections.remove(s.getPlayer().getUUID());
                return "已取消选区，右键恢复正常。";
            })))
            .then(Commands.literal("edit").requires(s -> s.getPlayer() != null).then(id().executes(ctx -> run(ctx.getSource(), s -> {
                RegionStore.Region r = store.get(StringArgumentType.getString(ctx, "id"));
                authorized(s, r);
                if (!r.dimension().equals(s.getLevel().dimension().identifier().toString())) {
                    throw new IllegalArgumentException("请进入 " + r.dimension() + " 后再编辑此区域");
                }
                Selection selected = new Selection(r.dimension());
                selected.setBounds(r.bounds(), s.getPlayer().blockPosition().getY() - 1);
                selected.editingId = r.id();
                selections.put(s.getPlayer().getUUID(), selected);
                return "已载入 " + describe(r) + "。用 expand/shrink/size 微调，/region save 确认，/region cancel 放弃。";
            }))))
            .then(adjustCommand("expand", 1))
            .then(adjustCommand("shrink", -1))
            .then(Commands.literal("size").requires(s -> s.getPlayer() != null)
                .then(Commands.argument("width", IntegerArgumentType.integer(1, RegionStore.MAX_SPAN))
                    .then(Commands.argument("depth", IntegerArgumentType.integer(1, RegionStore.MAX_SPAN)).executes(ctx -> run(ctx.getSource(), s -> {
                        Selection selected = selection(s);
                        RegionStore.Bounds next = selected.bounds().resize(IntegerArgumentType.getInteger(ctx, "width"), IntegerArgumentType.getInteger(ctx, "depth"));
                        selected.setBounds(next, Math.max(selected.first.getY(), selected.second.getY()));
                        return selectionDescription(selected) + "。西北角保持不变。";
                    })))))
            .then(Commands.literal("save").executes(ctx -> save(ctx.getSource(), null, null, null)).then(id()
                .executes(ctx -> save(ctx.getSource(), StringArgumentType.getString(ctx, "id"), null, null))
                .then(Commands.literal("buffer").then(Commands.argument("blocks", IntegerArgumentType.integer(0, 128))
                    .executes(ctx -> save(ctx.getSource(), StringArgumentType.getString(ctx, "id"), null, IntegerArgumentType.getInteger(ctx, "blocks")))))))
            .then(Commands.literal("share").then(id().executes(ctx -> save(ctx.getSource(), StringArgumentType.getString(ctx, "id"), "selection", 0))))
            .then(Commands.literal("list").executes(ctx -> run(ctx.getSource(), s -> store.all().isEmpty()
                ? "尚无共享区域。用 /region select 开始。" : String.join("\n", store.all().stream().map(Regions::describe).toList()))))
            .then(Commands.literal("info").then(id().executes(ctx -> run(ctx.getSource(), s -> describe(store.get(StringArgumentType.getString(ctx, "id")))))))
            .then(Commands.literal("buffer").then(id().then(Commands.argument("blocks", IntegerArgumentType.integer(0, 128)).executes(ctx -> run(ctx.getSource(), s -> {
                RegionStore.Region r = store.get(StringArgumentType.getString(ctx, "id"));
                return describe(store.put(r.id(), r.kind(), r.owner(), r.dimension(), r.bounds(), IntegerArgumentType.getInteger(ctx, "blocks"), authorized(s, r)));
            })))))
            .then(Commands.literal("delete").then(id().executes(ctx -> remove(ctx.getSource(), StringArgumentType.getString(ctx, "id")))))
            .then(Commands.literal("revoke").then(id().executes(ctx -> remove(ctx.getSource(), StringArgumentType.getString(ctx, "id"))))));
    }
    private static LiteralArgumentBuilder<CommandSourceStack> adjustCommand(String command, int sign) {
        return Commands.literal(command).requires(s -> s.getPlayer() != null)
            .then(Commands.argument("direction", StringArgumentType.word()).suggests((ctx, builder) ->
                SharedSuggestionProvider.suggest(java.util.List.of("north", "south", "east", "west"), builder))
                .then(Commands.argument("blocks", IntegerArgumentType.integer(1, RegionStore.MAX_SPAN)).executes(ctx -> run(ctx.getSource(), s -> {
                    Selection selected = selection(s);
                    RegionStore.Bounds next = selected.bounds().adjust(StringArgumentType.getString(ctx, "direction"), sign * IntegerArgumentType.getInteger(ctx, "blocks"));
                    selected.setBounds(next, Math.max(selected.first.getY(), selected.second.getY()));
                    return selectionDescription(selected);
                }))));
    }
    private static Selection selection(CommandSourceStack source) {
        Selection selected = source.getPlayer() == null ? null : selections.get(source.getPlayer().getUUID());
        if (selected == null) throw new IllegalArgumentException("先用 /region select 右键两个角，或 /region edit 载入已有区域");
        if (!selected.dimension.equals(source.getLevel().dimension().identifier().toString())) {
            throw new IllegalArgumentException("请返回选区所在维度 " + selected.dimension);
        }
        return selected;
    }
    private static String selectionDescription(Selection selected) {
        RegionStore.Bounds b = selected.bounds();
        return "选区 " + b.width() + " x " + b.depth() + " 格，面积 " + b.width() * b.depth()
                + "，x=" + b.minX() + ".." + b.maxX() + " z=" + b.minZ() + ".." + b.maxZ() + "。尚未保存";
    }
    private static boolean authorized(CommandSourceStack source, RegionStore.Region r) {
        if (!operator(source) && !r.owner().equals(owner(source))) throw new IllegalArgumentException("只能修改自己登记的区域");
        return true;
    }
    private static int save(CommandSourceStack source, String id, String kind, Integer buffer) {
        return run(source, s -> {
            Selection selected = selection(s);
            String target = id != null ? id : selected.editingId;
            if (target == null) throw new IllegalArgumentException("新选区请指定 ID，例如 /region save home buffer 32");
            RegionStore.Region previous = target.equals(selected.editingId) ? store.get(target) : null;
            if (previous != null) authorized(s, previous);
            String targetKind = kind != null ? kind : previous == null ? "region" : previous.kind();
            int targetBuffer = buffer != null ? buffer : previous == null ? 32 : previous.buffer();
            String targetOwner = previous == null ? owner(s) : previous.owner();
            RegionStore.Region r = store.put(target, targetKind, targetOwner, selected.dimension, selected.bounds(), targetBuffer, operator(s));
            selections.remove(s.getPlayer().getUUID());
            return "已共享给规划 MCP：" + describe(r) + "。现在可以在聊天里让 AI 读取 " + target + "。";
        });
    }
    private static int remove(CommandSourceStack source, String id) {
        return run(source, s -> {
            store.remove(id, owner(s), operator(s));
            return "已撤销 " + id + " 的数据访问，游戏中的方块保持原样。";
        });
    }
    private static String describe(RegionStore.Region r) {
        RegionStore.Bounds b = r.bounds();
        return r.id() + " [" + r.kind() + "] " + r.dimension() + " x=" + b.minX() + ".." + b.maxX()
                + " z=" + b.minZ() + ".." + b.maxZ() + "，" + b.width() + " x " + b.depth() + "，周边 " + r.buffer() + " 格";
    }
}
