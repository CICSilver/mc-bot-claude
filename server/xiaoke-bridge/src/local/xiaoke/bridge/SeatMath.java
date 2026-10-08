package local.xiaoke.bridge;

/**
 * 坐下相关的纯计算。不碰任何 Minecraft 类，所以能在没有服务端的情况下单独自测。
 *
 * <h2>座位高度怎么算的</h2>
 *
 * 原版（26.1）让乘客跟着坐骑走的代码是 {@code Entity.positionRider}，用 javap 读出来是：
 * <pre>
 *   乘客 Pos = 坐骑.getPassengerRidingPosition(乘客) − 乘客.getVehicleAttachmentPoint(坐骑)
 *            = 坐骑 Pos + 坐骑的 PASSENGER 挂点 − 乘客的 VEHICLE 挂点
 * </pre>
 * 两个挂点在 26.1 里的值（同样是 javap 读 {@code EntityType} 的静态初始化得到的）：
 * <ul>
 *   <li>座位用的 {@code item_display}：{@code sized(0, 0)}，没有单独设 passengerAttachments，
 *       PASSENGER 挂点按 {@code AT_HEIGHT} 回退到"实体高度"，也就是 0。</li>
 *   <li>玩家：{@code vehicleAttachment(Avatar.DEFAULT_VEHICLE_ATTACHMENT)}，
 *       值是 {@code (0, 0.6, 0)}；站立和潜行两种姿势里也是同一个值。</li>
 * </ul>
 * 所以 乘客脚底 y = 座位 y + 0 − 0.6 = 座位 y − 0.6。
 *
 * <p>设坐面高度为 S（楼梯、台阶是方块 y + 0.5，地毯是方块 y + 0.0625）。
 * 我们希望乘客脚底 y = S − {@link #SIT_DEPTH}（默认 0.7，坐姿时屁股大约在脚底往上 0.7 格，
 * 这样屁股正好落在坐面上）。倒推：
 * <pre>
 *   座位 y = S − SIT_DEPTH + 乘客 VEHICLE 挂点 − 座位 PASSENGER 挂点
 *          = S − 0.7 + 0.6 − 0
 *          = S − 0.1
 * </pre>
 * 运行时两个挂点是直接问实体要的（玩家如果被改了体型大小也能跟着对），
 * 上面的 0.6 和 0 只是默认值，自测里会核对原版数据确实是这两个数。
 *
 * <p>进游戏微调只改 {@link #SIT_DEPTH} 这一个数。
 */
public final class SeatMath {
    private SeatMath() {}

    /** 能坐的东西的种类。 */
    public enum Kind { STAIRS, SLAB, CARPET }

    /**
     * 唯一需要在游戏里微调的数：坐下后，玩家脚底（Pos.y）比坐面低多少格。
     * 看起来悬空就调大一点，陷进方块里就调小一点。
     */
    public static final double SIT_DEPTH = 0.7;

    /** 26.1 原版默认值：玩家的 VEHICLE 挂点高度（Avatar.DEFAULT_VEHICLE_ATTACHMENT.y）。只用来写注释和自测。 */
    public static final double DEFAULT_PLAYER_VEHICLE_ATTACH_Y = 0.6;

    /** 26.1 原版默认值：item_display 的 PASSENGER 挂点高度（尺寸 0x0，回退到高度 0）。只用来写注释和自测。 */
    public static final double DEFAULT_DISPLAY_PASSENGER_ATTACH_Y = 0.0;

    /** 坐面相对方块底部的高度。 */
    public static double surfaceHeight(Kind kind) {
        switch (kind) {
            case STAIRS:
            case SLAB:
                return 0.5;
            case CARPET:
                return 1.0 / 16.0;
            default:
                throw new IllegalArgumentException("不认识的种类: " + kind);
        }
    }

    /** 坐面的世界 y 坐标。 */
    public static double surfaceY(int blockY, Kind kind) {
        return blockY + surfaceHeight(kind);
    }

    /**
     * 座位实体应该放的 y。
     *
     * @param surfaceY             坐面的世界 y
     * @param riderVehicleAttachY  乘客（玩家）的 VEHICLE 挂点 y，默认 0.6
     * @param seatPassengerAttachY 座位的 PASSENGER 挂点 y，默认 0
     */
    public static double seatY(double surfaceY, double riderVehicleAttachY, double seatPassengerAttachY) {
        return surfaceY - SIT_DEPTH + riderVehicleAttachY - seatPassengerAttachY;
    }

    /** 反过来：座位放在 seatY 时，原版会把乘客脚底放在哪个 y（跟 Entity.positionRider 一样的算法）。 */
    public static double riderFeetY(double seatY, double riderVehicleAttachY, double seatPassengerAttachY) {
        return seatY + seatPassengerAttachY - riderVehicleAttachY;
    }

    /**
     * yaw/pitch（角度）换成视线方向的单位向量 {x, y, z}，跟原版 Entity.calculateViewVector 一样：
     * x = −sin(yaw)·cos(pitch)，y = −sin(pitch)，z = cos(yaw)·cos(pitch)。
     * 原版 Entity.lookAt 再把这个方向换回 yaw = atan2(z, x) − 90°、pitch = −atan2(y, 水平长度)，正好互逆。
     */
    public static double[] viewVector(double yawDeg, double pitchDeg) {
        double yaw = Math.toRadians(yawDeg);
        double pitch = Math.toRadians(pitchDeg);
        return new double[] {
                -Math.sin(yaw) * Math.cos(pitch),
                -Math.sin(pitch),
                Math.cos(yaw) * Math.cos(pitch)
        };
    }

    /**
     * 楼梯的 facing 指向高的那一边（靠背）。坐上去的人背靠靠背，脸朝反方向。
     * 返回原版的 yaw：0 = 朝南，90 = 朝西，180 = 朝北，270 = 朝东（跟 Direction.toYRot 一致）。
     *
     * @param facing 楼梯 facing 属性的名字：north / south / east / west
     * @return yaw；名字不认识时返回 null
     */
    public static Float sitterYawForStairFacing(String facing) {
        if (facing == null) {
            return null;
        }
        switch (facing) {
            case "north":
                return 0.0f;   // 靠背在北，脸朝南
            case "south":
                return 180.0f; // 靠背在南，脸朝北
            case "east":
                return 90.0f;  // 靠背在东，脸朝西
            case "west":
                return 270.0f; // 靠背在西，脸朝东
            default:
                return null;
        }
    }
}
