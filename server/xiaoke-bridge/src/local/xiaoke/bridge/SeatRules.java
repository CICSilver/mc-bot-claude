package local.xiaoke.bridge;

import net.minecraft.core.BlockPos;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.CarpetBlock;
import net.minecraft.world.level.block.SlabBlock;
import net.minecraft.world.level.block.StairBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Half;
import net.minecraft.world.level.block.state.properties.SlabType;

/**
 * 哪些方块能坐。只依赖 Minecraft 的方块类，不依赖 Fabric，自测时可以在原版 Bootstrap 之后直接调用。
 */
final class SeatRules {
    private SeatRules() {}

    /**
     * 能坐的方块：下半的楼梯（half=bottom）、下半的台阶（type=bottom）、地毯（羊毛地毯和苔藓地毯）。
     * 倒放的楼梯、上半台阶、双台阶、苍白苔藓地毯（形状会带边）都不算。
     *
     * @return 种类；不能坐返回 null
     */
    static SeatMath.Kind kindOf(BlockState state) {
        if (state == null) {
            return null;
        }
        Block block = state.getBlock();
        if (block instanceof StairBlock) {
            if (state.hasProperty(StairBlock.HALF) && state.getValue(StairBlock.HALF) == Half.BOTTOM) {
                return SeatMath.Kind.STAIRS;
            }
            return null;
        }
        if (block instanceof SlabBlock) {
            if (state.hasProperty(SlabBlock.TYPE) && state.getValue(SlabBlock.TYPE) == SlabType.BOTTOM) {
                return SeatMath.Kind.SLAB;
            }
            return null;
        }
        if (block instanceof CarpetBlock) {
            return SeatMath.Kind.CARPET;
        }
        return null;
    }

    /** 这一格有没有碰撞箱（空气、花草之类算空）。 */
    static boolean isClear(BlockGetter level, BlockPos pos) {
        return level.getBlockState(pos).getCollisionShape(level, pos).isEmpty();
    }

    /** 坐的方块上面两格都得是空的，人才放得下。 */
    static boolean hasHeadroom(BlockGetter level, BlockPos seatBlock) {
        return isClear(level, seatBlock.above()) && isClear(level, seatBlock.above(2));
    }
}
