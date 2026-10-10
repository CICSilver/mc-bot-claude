package local.xiaoke.bridge;

import net.minecraft.SharedConstants;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.entity.Avatar;
import net.minecraft.world.entity.EntityAttachment;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.level.EmptyBlockGetter;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.SlabBlock;
import net.minecraft.world.level.block.StairBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Half;
import net.minecraft.world.level.block.state.properties.SlabType;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.shapes.VoxelShape;

import java.util.List;

/**
 * 需要原版数据的自测：先跑原版 Bootstrap（不开服务器、不建世界），然后核对
 * 哪些方块能坐、方块碰撞箱的顶、楼梯 facing 的含义、两个挂点的实际数值。
 * 用法：java -cp build/classes;build/test-classes;<游戏 jar 和依赖> local.xiaoke.bridge.McCheck
 */
public final class McCheck {
    private static int passed;
    private static int failed;

    public static void main(String[] args) {
        SharedConstants.tryDetectVersion();
        Bootstrap.bootStrap();

        sittableChecks();
        shapeChecks();
        stairFacingChecks();
        attachmentChecks();
        blockTagChecks();
        handOverChecks();

        System.out.println("McCheck: 通过 " + passed + " 项，失败 " + failed + " 项");
        System.exit(failed > 0 ? 1 : 0);
    }

    private static void sittableChecks() {
        BlockState stairs = Blocks.OAK_STAIRS.defaultBlockState();
        check("橡木楼梯默认是下半", stairs.getValue(StairBlock.HALF) == Half.BOTTOM);
        check("下半楼梯能坐", SeatRules.kindOf(stairs) == SeatMath.Kind.STAIRS);
        check("倒放楼梯不能坐", SeatRules.kindOf(stairs.setValue(StairBlock.HALF, Half.TOP)) == null);
        for (Direction d : new Direction[] {Direction.NORTH, Direction.SOUTH, Direction.EAST, Direction.WEST}) {
            check("各个朝向的下半楼梯都能坐 " + d, SeatRules.kindOf(stairs.setValue(StairBlock.FACING, d)) == SeatMath.Kind.STAIRS);
        }
        check("铜楼梯（子类）也能坐", SeatRules.kindOf(Blocks.CUT_COPPER_STAIRS.defaultBlockState()) == SeatMath.Kind.STAIRS);

        BlockState slab = Blocks.OAK_SLAB.defaultBlockState();
        check("橡木台阶默认是下半", slab.getValue(SlabBlock.TYPE) == SlabType.BOTTOM);
        check("下半台阶能坐", SeatRules.kindOf(slab) == SeatMath.Kind.SLAB);
        check("上半台阶不能坐", SeatRules.kindOf(slab.setValue(SlabBlock.TYPE, SlabType.TOP)) == null);
        check("双台阶不能坐", SeatRules.kindOf(slab.setValue(SlabBlock.TYPE, SlabType.DOUBLE)) == null);
        check("铜台阶（子类）也能坐", SeatRules.kindOf(Blocks.CUT_COPPER_SLAB.defaultBlockState()) == SeatMath.Kind.SLAB);
        check("紫珀台阶能坐", SeatRules.kindOf(Blocks.PURPUR_SLAB.defaultBlockState()) == SeatMath.Kind.SLAB);

        check("白色地毯能坐", SeatRules.kindOf(Blocks.WHITE_CARPET.defaultBlockState()) == SeatMath.Kind.CARPET);
        check("苔藓地毯能坐", SeatRules.kindOf(Blocks.MOSS_CARPET.defaultBlockState()) == SeatMath.Kind.CARPET);
        check("苍白苔藓地毯不算", SeatRules.kindOf(Blocks.PALE_MOSS_CARPET.defaultBlockState()) == null);
        check("石头不能坐", SeatRules.kindOf(Blocks.STONE.defaultBlockState()) == null);
        check("空气不能坐", SeatRules.kindOf(Blocks.AIR.defaultBlockState()) == null);
        check("null 不能坐", SeatRules.kindOf(null) == null);
    }

    private static void shapeChecks() {
        check("下半台阶碰撞箱顶 = 坐面高度 0.5",
                near(top(Blocks.OAK_SLAB.defaultBlockState()), SeatMath.surfaceHeight(SeatMath.Kind.SLAB)));
        check("地毯碰撞箱顶 = 坐面高度 0.0625",
                near(top(Blocks.WHITE_CARPET.defaultBlockState()), SeatMath.surfaceHeight(SeatMath.Kind.CARPET)));
        check("下半楼梯碰撞箱顶 = 1.0（起身后站上去的高度）", near(top(Blocks.OAK_STAIRS.defaultBlockState()), 1.0));
        check("空气没有碰撞箱", shape(Blocks.AIR.defaultBlockState()).isEmpty());
        // 下半楼梯的下面那层是整块 0~0.5，所以坐面 0.5
        BlockState stairs = Blocks.OAK_STAIRS.defaultBlockState().setValue(StairBlock.FACING, Direction.NORTH);
        check("下半楼梯的低台阶面在 0.5（南半边 0.4 处有方块）", inside(stairs, 0.5, 0.4, 0.75));
        check("下半楼梯的低台阶面在 0.5（南半边 0.6 处是空的）", !inside(stairs, 0.5, 0.6, 0.75));
    }

    /** facing=north 时高的那半边（靠背）应该在北边（z 小的那边），坐的人脸朝南。 */
    private static void stairFacingChecks() {
        BlockState north = Blocks.OAK_STAIRS.defaultBlockState().setValue(StairBlock.FACING, Direction.NORTH);
        check("facing=north 时北半边上层是实心（靠背在 facing 那边）", inside(north, 0.5, 0.75, 0.25));
        check("facing=north 时南半边上层是空的", !inside(north, 0.5, 0.75, 0.75));
        BlockState east = Blocks.OAK_STAIRS.defaultBlockState().setValue(StairBlock.FACING, Direction.EAST);
        check("facing=east 时东半边上层是实心", inside(east, 0.75, 0.75, 0.5));
        check("facing=east 时西半边上层是空的", !inside(east, 0.25, 0.75, 0.5));

        for (Direction d : new Direction[] {Direction.NORTH, Direction.SOUTH, Direction.EAST, Direction.WEST}) {
            Float yaw = SeatMath.sitterYawForStairFacing(d.getSerializedName());
            float expected = d.getOpposite().toYRot();
            check("楼梯 " + d + " 的坐姿朝向 = 反方向的 toYRot()",
                    yaw != null && near(((yaw % 360f) + 360f) % 360f, ((expected % 360f) + 360f) % 360f));
        }
    }

    private static void attachmentChecks() {
        double displayHeight = EntityType.ITEM_DISPLAY.getDimensions().height();
        check("item_display 高度是 0", near(displayHeight, 0.0));
        double displayPassenger = EntityType.ITEM_DISPLAY.getDimensions().attachments()
                .getClamped(EntityAttachment.PASSENGER, 0, 0.0f).y;
        check("item_display 的 PASSENGER 挂点 y = " + SeatMath.DEFAULT_DISPLAY_PASSENGER_ATTACH_Y
                        + "（实际 " + displayPassenger + "）",
                near(displayPassenger, SeatMath.DEFAULT_DISPLAY_PASSENGER_ATTACH_Y));
        double playerVehicle = EntityType.PLAYER.getDimensions().attachments()
                .get(EntityAttachment.VEHICLE, 0, 0.0f).y;
        check("玩家的 VEHICLE 挂点 y = " + SeatMath.DEFAULT_PLAYER_VEHICLE_ATTACH_Y + "（实际 " + playerVehicle + "）",
                near(playerVehicle, SeatMath.DEFAULT_PLAYER_VEHICLE_ATTACH_Y));
        check("Avatar.DEFAULT_VEHICLE_ATTACHMENT.y = 0.6", near(Avatar.DEFAULT_VEHICLE_ATTACHMENT.y, 0.6));
        // 朝向转动不应改变挂点的高度
        double rotated = EntityType.PLAYER.getDimensions().attachments().get(EntityAttachment.VEHICLE, 0, 137.0f).y;
        check("挂点高度跟朝向无关", near(rotated, playerVehicle));
    }

    private static void blockTagChecks() {
        check("能读回方块标签", new BlockPos(1, -2, 3).equals(Seats.parseBlockTag(List.of("xkb_seat", "xkb_block:1,-2,3"))));
        check("没有方块标签返回 null", Seats.parseBlockTag(List.of("xkb_seat")) == null);
        check("坏的方块标签返回 null", Seats.parseBlockTag(List.of("xkb_block:1,x,3")) == null);
        check("段数不对返回 null", Seats.parseBlockTag(List.of("xkb_block:1,2")) == null);
        for (SeatMath.Kind kind : SeatMath.Kind.values()) {
            for (int y : new int[] {-64, -1, 0, 64, 319}) {
                double seatY = SeatMath.seatY(SeatMath.surfaceY(y, kind),
                        SeatMath.DEFAULT_PLAYER_VEHICLE_ATTACH_Y, SeatMath.DEFAULT_DISPLAY_PASSENGER_ATTACH_Y);
                check("没有方块标签时按座位高度推回方块（" + kind + ", y=" + y + "）",
                        BlockPos.containing(10.5, seatY + 0.2, -3.5).equals(new BlockPos(10, y, -4)));
            }
        }
    }

    // ------------------------------------------------------------ 工具

    private static VoxelShape shape(BlockState state) {
        return state.getCollisionShape(EmptyBlockGetter.INSTANCE, BlockPos.ZERO);
    }

    private static double top(BlockState state) {
        return shape(state).max(Direction.Axis.Y);
    }

    private static boolean inside(BlockState state, double x, double y, double z) {
        for (AABB box : shape(state).toAabbs()) {
            if (box.contains(x, y, z)) {
                return true;
            }
        }
        return false;
    }

    private static boolean near(double a, double b) {
        return Math.abs(a - b) < 1.0e-6;
    }

    // 递东西：命令里的物品 id 和注册表里的对得上
    private static void handOverChecks() {
        check("面包的 id 是 bread", net.minecraft.core.registries.BuiltInRegistries.ITEM.getKey(net.minecraft.world.item.Items.BREAD).getPath().equals("bread"));
        check("命令里写了命名空间、大写也认", HandOver.stripNamespace("minecraft:Bread").equals("bread"));
        check("没写命名空间照旧", HandOver.stripNamespace("cooked_cod").equals("cooked_cod"));
    }

    private static void check(String name, boolean ok) {
        if (ok) {
            passed++;
        } else {
            failed++;
            System.out.println("  失败: " + name);
        }
    }
}
