package local.xiaoke.bridge;

import java.util.List;
import java.util.function.UnaryOperator;

/**
 * 从一排格子里一组一组拿东西交出去，对方收不下的放回原格。不碰 Minecraft（格子里是什么由 {@link Ops} 说了算），方便单独自测；
 * {@link HandOver} 用它在小克和玩家的背包之间挪 ItemStack。
 */
final class Transfer {
    private Transfer() {}

    interface Ops<S> {
        boolean isEmpty(S stack);
        String id(S stack);
        int count(S stack);
        /** 从 stack 里分出 n 个成为新的一组（stack 自己少 n 个）。 */
        S split(S stack, int n);
        void grow(S stack, int n);
    }

    static <S> int count(List<S> slots, Ops<S> ops, String itemId) {
        int n = 0;
        for (S s : slots) {
            if (!ops.isEmpty(s) && ops.id(s).equals(itemId)) {
                n += ops.count(s);
            }
        }
        return n;
    }

    /**
     * 拿最多 count 个 itemId 交给 give。give 返回收不下的那部分（可以就是传进去的那一组，数量变少了；收完了返回空的或 null）；
     * 收不下的放回原来那一格，然后就停（对方满了）。返回真正给出去的个数。
     */
    static <S> int move(List<S> slots, Ops<S> ops, String itemId, int count, UnaryOperator<S> give) {
        int moved = 0;
        for (int i = 0; i < slots.size() && moved < count; i++) {
            S slot = slots.get(i);
            if (ops.isEmpty(slot) || !ops.id(slot).equals(itemId)) {
                continue;
            }
            int take = Math.min(count - moved, ops.count(slot));
            S part = ops.split(slot, take);
            S left = give.apply(part);
            int leftCount = left == null || ops.isEmpty(left) ? 0 : ops.count(left);
            moved += take - leftCount;
            if (leftCount > 0) {
                if (ops.isEmpty(slot)) {
                    slots.set(i, left);
                } else {
                    ops.grow(slot, leftCount);
                }
                break;
            }
        }
        return moved;
    }
}
