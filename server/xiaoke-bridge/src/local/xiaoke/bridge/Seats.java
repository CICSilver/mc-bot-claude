package local.xiaoke.bridge;

import net.minecraft.commands.arguments.EntityAnchorArgument;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.Display;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityAttachment;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.Pose;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.StairBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import net.minecraft.world.phys.shapes.VoxelShape;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 坐在楼梯、台阶、地毯上。
 *
 * <p>座位是一个什么都不显示的 item_display（展示实体）：原版客户端把它画成"什么也没有"，
 * 它没有碰撞箱、点不到、不受重力、打不坏；玩家只要骑在任何实体上，原版客户端就会画成坐姿
 * （26.1 客户端 HumanoidMobRenderer 里 isPassenger 直接取 entity.isPassenger()）。
 * 选它而不选隐形盔甲架，是因为旁观模式的玩家能看到半透明的隐形盔甲架，展示实体则什么都看不到。
 *
 * <p>座位带记分板标签 xkb_seat，另外用 xkb_block:x,y,z 记下它属于哪个方块（重启后还能认出来）。
 */
final class Seats {
    private Seats() {}

    static final String SEAT_TAG = "xkb_seat";
    static final String BLOCK_TAG_PREFIX = "xkb_block:";

    /** 离方块中心多远以内才能坐。 */
    static final double MAX_SIT_DISTANCE = 3.0;
    /** 从硬盘读进来的座位，给这么多 tick 等乘客重新坐上（玩家重新登录时原版会把人放回座位上）。 */
    static final int LOAD_GRACE_TICKS = 20;
    /** 刚坐下这么多毫秒内，副手对方块的右键全部拦下（不然副手的火把之类会被顺手放出去）。 */
    static final long OFFHAND_BLOCK_MS = 300;

    private static final class Seat {
        final Display.ItemDisplay entity;
        final ServerLevel level;
        final BlockPos block;
        final SeatMath.JumpLatch jump = new SeatMath.JumpLatch();
        UUID riderId;
        int graceUntil;

        Seat(Display.ItemDisplay entity, ServerLevel level, BlockPos block, int graceUntil) {
            this.entity = entity;
            this.level = level;
            this.block = block;
            this.graceUntil = graceUntil;
        }
    }

    private static final Map<UUID, Seat> SEATS = new HashMap<>();
    private static final Map<UUID, Long> JUST_SAT = new HashMap<>();
    private static int currentTick;

    // ---------------------------------------------------------------- 右键方块

    static InteractionResult onUseBlock(Player player, Level level, InteractionHand hand, BlockHitResult hit) {
        try {
            if (level.isClientSide() || !(player instanceof ServerPlayer sp) || !(level instanceof ServerLevel sl)) {
                return InteractionResult.PASS;
            }
            if (hand != InteractionHand.MAIN_HAND) {
                return offHandAfterSitting(sp);
            }
            if (sp.isSpectator() || sp.isShiftKeyDown() || sp.isPassenger()) {
                return InteractionResult.PASS;
            }
            if (!sp.getMainHandItem().isEmpty()) {
                return InteractionResult.PASS;
            }
            BridgeConfig cfg = XiaokeBridge.config();
            if (!cfg.playersCanSit() && !cfg.isBot(sp.getGameProfile().name())) {
                return InteractionResult.PASS;
            }
            BlockPos pos = hit.getBlockPos();
            BlockState state = sl.getBlockState(pos);
            SeatMath.Kind kind = SeatRules.kindOf(state);
            if (kind == null) {
                return InteractionResult.PASS;
            }
            if (sp.position().distanceToSqr(Vec3.atCenterOf(pos)) > MAX_SIT_DISTANCE * MAX_SIT_DISTANCE) {
                return InteractionResult.PASS;
            }
            if (!SeatRules.hasHeadroom(sl, pos)) {
                return InteractionResult.PASS;
            }
            if (seatAt(sl, pos) != null) {
                return InteractionResult.PASS;
            }
            return sitDown(sp, sl, pos, state, kind) ? InteractionResult.SUCCESS : InteractionResult.PASS;
        } catch (VirtualMachineError e) {
            throw e;
        } catch (Throwable t) {
            XiaokeBridge.LOG.error("[xiaoke-bridge] 处理坐下时出错，按原版处理", t);
            return InteractionResult.PASS;
        }
    }

    /**
     * 原版客户端主手右键没反应时，会接着用副手再右键一次。刚坐下的人，这一下拦掉，
     * 并把背包重新同步给客户端（客户端可能已经"预先"把副手的方块放出去、数量减了一个）。
     */
    private static InteractionResult offHandAfterSitting(ServerPlayer sp) {
        Long t = JUST_SAT.get(sp.getUUID());
        if (t != null && System.currentTimeMillis() - t < OFFHAND_BLOCK_MS && sp.isPassenger()) {
            sp.containerMenu.sendAllDataToRemote();
            return InteractionResult.FAIL;
        }
        return InteractionResult.PASS;
    }

    private static boolean sitDown(ServerPlayer sp, ServerLevel sl, BlockPos pos, BlockState state, SeatMath.Kind kind) {
        Display.ItemDisplay seat = new Display.ItemDisplay(EntityType.ITEM_DISPLAY, sl);
        double x = pos.getX() + 0.5;
        double z = pos.getZ() + 0.5;
        seat.setPos(x, pos.getY(), z);

        // 两个挂点直接问实体要（默认分别是 0.6 和 0，推导见 SeatMath 的类注释）。
        // 玩家的挂点按站立姿势取：startRiding 会把姿势设成 STANDING，坐着时也一直是它；
        // 要是按当前姿势取，正在游泳/滑翔的人没有 VEHICLE 挂点（回退成 0），会算低 0.6 格。
        double riderAttachY = sp.getDimensions(Pose.STANDING).attachments()
                .get(EntityAttachment.VEHICLE, 0, sp.getYRot()).y;
        double seatAttachY = seat.getPassengerRidingPosition(sp).y - seat.getY();
        double seatY = SeatMath.seatY(SeatMath.surfaceY(pos.getY(), kind), riderAttachY, seatAttachY);

        Float stairYaw = null;
        if (kind == SeatMath.Kind.STAIRS && state.hasProperty(StairBlock.FACING)) {
            Direction facing = state.getValue(StairBlock.FACING);
            stairYaw = SeatMath.sitterYawForStairFacing(facing.getSerializedName());
        }
        float yaw = stairYaw != null ? stairYaw : sp.getYRot();
        seat.snapTo(x, seatY, z, yaw, 0.0f);
        seat.addTag(SEAT_TAG);
        seat.addTag(blockTag(pos));

        if (!sl.addFreshEntity(seat)) {
            return false;
        }
        Seat record = register(seat, sl, pos, 0);
        if (!sp.startRiding(seat, true, false)) {
            SEATS.remove(seat.getUUID());
            seat.discard();
            return false;
        }
        record.riderId = sp.getUUID();
        record.graceUntil = 0; // 自己刚放的座位不需要宽限：人一下来就收走
        if (stairYaw != null) {
            face(sp, stairYaw);
        }
        if (!XiaokeBridge.config().isBot(sp.getGameProfile().name())) {
            showStandUpHint(sp);
        }
        JUST_SAT.put(sp.getUUID(), System.currentTimeMillis());
        XiaokeBridge.LOG.info("[xiaoke-bridge] {} 坐在 {} ({}, {}, {})",
                sp.getGameProfile().name(), kind.name().toLowerCase(java.util.Locale.ROOT),
                pos.getX(), pos.getY(), pos.getZ());
        return true;
    }

    /**
     * 让玩家转向 yaw，俯仰角不变。服务端改 yRot 客户端不会跟着转，所以用原版的"看向某点"包
     * （ClientboundPlayerLookAtPacket，/tp ... facing 用的就是它），它不会让人下坐骑。
     * 目标点放在 50 格外，客户端那边眼睛位置有一点点差别也不影响朝向。
     */
    private static void face(ServerPlayer sp, float yaw) {
        // 俯仰角限制在 ±80°，免得正上/正下方时水平方向算不出来
        double pitch = Math.max(-80.0, Math.min(80.0, sp.getXRot()));
        double[] dir = SeatMath.viewVector(yaw, pitch);
        Vec3 eye = sp.getEyePosition();
        sp.lookAt(EntityAnchorArgument.Anchor.EYES, eye.add(dir[0] * 50.0, dir[1] * 50.0, dir[2] * 50.0));
    }

    /**
     * 动作栏提示怎么起身。按键用 keybind 组件，客户端按各人自己绑的键显示（有人把潜行改成了 Ctrl）。
     * 原版坐上去时也会在同一个位置提示"按下 潜行键 来脱离"，这条紧跟在后面发，会把它换掉。
     */
    private static void showStandUpHint(ServerPlayer sp) {
        sp.sendSystemMessage(Component.literal("按 ")
                .append(Component.keybind("key.sneak"))
                .append(" 或 ")
                .append(Component.keybind("key.jump"))
                .append(" 起身"), true);
    }

    // ---------------------------------------------------------------- 座位登记

    private static String blockTag(BlockPos pos) {
        return BLOCK_TAG_PREFIX + pos.getX() + "," + pos.getY() + "," + pos.getZ();
    }

    /** 从 xkb_block:x,y,z 标签读回方块位置；没有或坏了返回 null。 */
    static BlockPos parseBlockTag(Iterable<String> tags) {
        for (String tag : tags) {
            if (!tag.startsWith(BLOCK_TAG_PREFIX)) {
                continue;
            }
            String[] parts = tag.substring(BLOCK_TAG_PREFIX.length()).split(",");
            if (parts.length != 3) {
                return null;
            }
            try {
                return new BlockPos(Integer.parseInt(parts[0].trim()),
                        Integer.parseInt(parts[1].trim()),
                        Integer.parseInt(parts[2].trim()));
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }

    private static Seat register(Display.ItemDisplay entity, ServerLevel level, BlockPos block, int graceTicks) {
        Seat existing = SEATS.get(entity.getUUID());
        if (existing != null && existing.entity == entity) {
            return existing;
        }
        Seat seat = new Seat(entity, level, block, currentTick + graceTicks);
        SEATS.put(entity.getUUID(), seat);
        return seat;
    }

    private static Seat seatAt(ServerLevel level, BlockPos pos) {
        for (Seat s : SEATS.values()) {
            if (s.level == level && s.block.equals(pos) && !s.entity.isRemoved()) {
                return s;
            }
        }
        return null;
    }

    /** 实体加入世界时（包括刚放的、区块加载、重启后读盘、玩家重新登录带回来的座位）。 */
    static void onEntityLoad(Entity entity, ServerLevel level) {
        try {
            if (!(entity instanceof Display.ItemDisplay display) || !entity.entityTags().contains(SEAT_TAG)) {
                return;
            }
            BlockPos block = parseBlockTag(entity.entityTags());
            if (block == null) {
                // 没有方块标签的旧座位：按座位高度往回推（座位在坐面下 0.1 左右，往上抬 0.2 再取整就是方块所在格）
                block = BlockPos.containing(entity.getX(), entity.getY() + 0.2, entity.getZ());
            }
            // 读盘进来时多半还没人坐（玩家重新登录要等一下才会被放回座位上），给一点宽限再判断要不要删
            register(display, level, block, LOAD_GRACE_TICKS);
        } catch (VirtualMachineError e) {
            throw e;
        } catch (Throwable t) {
            XiaokeBridge.LOG.warn("[xiaoke-bridge] 登记座位时出错", t);
        }
    }

    static void onEntityUnload(Entity entity, ServerLevel level) {
        try {
            Seat s = SEATS.get(entity.getUUID());
            if (s != null && s.entity == entity) {
                SEATS.remove(entity.getUUID());
            }
        } catch (VirtualMachineError e) {
            throw e;
        } catch (Throwable t) {
            XiaokeBridge.LOG.warn("[xiaoke-bridge] 注销座位时出错", t);
        }
    }

    // ---------------------------------------------------------------- 每 tick 清理

    static void onServerTick(MinecraftServer server) {
        currentTick = server.getTickCount();
        if (!SEATS.isEmpty()) {
            for (Seat s : new ArrayList<>(SEATS.values())) {
                try {
                    checkSeat(server, s);
                } catch (VirtualMachineError e) {
                    throw e;
                } catch (Throwable t) {
                    XiaokeBridge.LOG.warn("[xiaoke-bridge] 检查座位时出错，直接收掉这个座位", t);
                    SEATS.remove(s.entity.getUUID());
                    try {
                        s.entity.ejectPassengers();
                        s.entity.discard();
                    } catch (VirtualMachineError e) {
                        throw e;
                    } catch (Throwable ignored) {
                        // 收不掉就算了，下次加载时还会再判断
                    }
                }
            }
        }
        if (!JUST_SAT.isEmpty() && currentTick % 20 == 0) {
            long now = System.currentTimeMillis();
            Iterator<Map.Entry<UUID, Long>> it = JUST_SAT.entrySet().iterator();
            while (it.hasNext()) {
                if (now - it.next().getValue() > 5_000) {
                    it.remove();
                }
            }
        }
    }

    private static void checkSeat(MinecraftServer server, Seat s) {
        Display.ItemDisplay e = s.entity;
        if (e.isRemoved()) {
            SEATS.remove(e.getUUID());
            return;
        }
        List<Entity> passengers = e.getPassengers();
        if (!passengers.isEmpty()) {
            Entity rider = passengers.get(0);
            s.riderId = rider.getUUID();
            boolean blockGone = SeatRules.kindOf(s.level.getBlockState(s.block)) == null;
            // 按跳跃键起身（潜行键起身是原版自己处理的，人下来以后走下面"没人坐了"那条路）
            boolean jumped = rider instanceof ServerPlayer p && s.jump.update(p.getLastClientInput().jump());
            if (blockGone || jumped) {
                // 方块被挖了、换了，或者按了跳跃：把人放下来，收掉座位
                e.ejectPassengers();
                nudgeUp(server, s, s.riderId);
                removeSeat(s);
            }
            return;
        }
        if (currentTick < s.graceUntil) {
            return;
        }
        // 没人坐了（按潜行下来、被传送走、下线、死亡……）：收掉座位，刚下来的人往上挪到方块顶上
        nudgeUp(server, s, s.riderId);
        removeSeat(s);
    }

    private static void removeSeat(Seat s) {
        SEATS.remove(s.entity.getUUID());
        if (!s.entity.isRemoved()) {
            s.entity.discard();
        }
    }

    /**
     * 原版下坐骑时把人放在座位实体的位置（展示实体高度为 0，就是座位那一点），
     * 也就是坐面下面一点点，人会卡在楼梯里。这里把还待在原地的人挪到方块碰撞箱的顶上：
     * 楼梯顶 +1.0、台阶顶 +0.5、地毯顶 +0.0625。走远了、被传送走了、又骑上别的东西了，就不管。
     */
    private static void nudgeUp(MinecraftServer server, Seat s, UUID riderId) {
        if (riderId == null) {
            return;
        }
        ServerPlayer p = server.getPlayerList().getPlayer(riderId);
        if (p == null || p.isRemoved() || !p.isAlive() || p.isPassenger() || p.isSpectator()) {
            return;
        }
        if (p.level() != s.level) {
            return;
        }
        if (p.position().distanceToSqr(s.entity.position()) > 2.0 * 2.0) {
            return;
        }
        BlockState state = s.level.getBlockState(s.block);
        VoxelShape shape = state.getCollisionShape(s.level, s.block);
        if (shape.isEmpty()) {
            return; // 方块没了，让人自然落下
        }
        double top = s.block.getY() + shape.max(Direction.Axis.Y);
        if (top > s.block.getY() + 1.0 + 1.0e-6) {
            return; // 换成了比一格还高的东西（栅栏、墙），不往上挪
        }
        if (p.getY() >= top - 1.0e-4) {
            return;
        }
        if (!SeatRules.hasHeadroom(s.level, s.block)) {
            return;
        }
        p.teleportTo(s.entity.getX(), top, s.entity.getZ());
    }

    static void clear() {
        SEATS.clear();
        JUST_SAT.clear();
    }
}
