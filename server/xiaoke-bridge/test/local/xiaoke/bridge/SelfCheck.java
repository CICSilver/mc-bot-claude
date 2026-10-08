package local.xiaoke.bridge;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;

/**
 * 不需要服务端的自测：配置解析、消息格式、座位高度、楼梯朝向、冷却。
 * 用法：java -cp build/classes;build/test-classes;<依赖> local.xiaoke.bridge.SelfCheck
 */
public final class SelfCheck {
    private static int passed;
    private static int failed;

    public static void main(String[] args) throws Exception {
        configChecks();
        configFileChecks();
        protocolChecks();
        seatMathChecks();
        cooldownChecks();
        System.out.println("SelfCheck: 通过 " + passed + " 项，失败 " + failed + " 项");
        if (failed > 0) {
            System.exit(1);
        }
    }

    // ------------------------------------------------------------ 配置

    private static void configChecks() {
        BridgeConfig.Result r = BridgeConfig.parse("{\"bots\": [\"clawd\", \" Clawd_Test \", \"Moby\"], \"playersCanSit\": false}");
        check("正常配置不算坏", !r.broken);
        check("正常配置没有警告", r.warnings.isEmpty());
        check("名单大小写不敏感 CLAWD", r.config.isBot("CLAWD"));
        check("名单大小写不敏感 moby", r.config.isBot("moby"));
        check("名单会去掉首尾空格", r.config.isBot("clawd_test"));
        check("不在名单里的不是小克", !r.config.isBot("CICSilver"));
        check("null 不是小克", !r.config.isBot(null));
        check("playersCanSit=false 读到了", !r.config.playersCanSit());

        BridgeConfig.Result bad = BridgeConfig.parse("{not json");
        check("坏 JSON 标记为 broken", bad.broken);
        check("坏 JSON 用默认名单", bad.config.bots().equals(BridgeConfig.DEFAULT_BOTS));
        check("坏 JSON 用默认 playersCanSit", bad.config.playersCanSit() == BridgeConfig.DEFAULT_PLAYERS_CAN_SIT);
        check("坏 JSON 有警告", !bad.warnings.isEmpty());

        check("最外层是数组算坏", BridgeConfig.parse("[1, 2]").broken);
        check("空文件算坏", BridgeConfig.parse("").broken);
        check("只有空白算坏", BridgeConfig.parse("   \n").broken);

        BridgeConfig.Result partial = BridgeConfig.parse("{\"bots\": \"clawd\"}");
        check("缺项不算坏", !partial.broken);
        check("bots 类型不对用默认名单", partial.config.bots().equals(BridgeConfig.DEFAULT_BOTS));
        check("缺 playersCanSit 用默认值", partial.config.playersCanSit() == BridgeConfig.DEFAULT_PLAYERS_CAN_SIT);
        check("缺项和类型不对各有一条警告", partial.warnings.size() == 2);

        BridgeConfig.Result mixed = BridgeConfig.parse("{\"bots\": [\"a\", 1, null, \"\", \"A\"], \"playersCanSit\": \"yes\"}");
        check("名单里不是字符串的跳过，重复的去掉", mixed.config.bots().equals(List.of("a")));
        check("playersCanSit 不是布尔值用默认值", mixed.config.playersCanSit() == BridgeConfig.DEFAULT_PLAYERS_CAN_SIT);
        check("每个问题都有警告", mixed.warnings.size() >= 4);

        BridgeConfig.Result empty = BridgeConfig.parse("{\"bots\": [], \"playersCanSit\": true}");
        check("空名单是合法的", !empty.broken && empty.warnings.isEmpty() && empty.config.bots().isEmpty());
        check("空名单时谁都不是小克", !empty.config.isBot("clawd"));

        BridgeConfig.Result def = BridgeConfig.parse(BridgeConfig.defaultJson());
        check("默认文件能原样读回", !def.broken && def.warnings.isEmpty()
                && def.config.bots().equals(BridgeConfig.DEFAULT_BOTS)
                && def.config.playersCanSit() == BridgeConfig.DEFAULT_PLAYERS_CAN_SIT);
        check("默认名单里有 clawd / clawd_test / Moby",
                def.config.isBot("clawd") && def.config.isBot("clawd_test") && def.config.isBot("Moby"));

        BridgeConfig.Result extra = BridgeConfig.parse("{\"bots\": [\"x\"], \"playersCanSit\": true, \"other\": 1}");
        check("多余的键不影响", !extra.broken && extra.warnings.isEmpty());
    }

    private static void configFileChecks() throws Exception {
        Path dir = Files.createTempDirectory("xkb-selfcheck");
        try {
            Path missing = dir.resolve("config").resolve("xiaoke-bridge.json");
            BridgeConfig.Result created = BridgeConfig.load(missing);
            check("文件不存在时用默认值", !created.broken && created.config.bots().equals(BridgeConfig.DEFAULT_BOTS));
            check("文件不存在时会新建（连目录一起）", Files.exists(missing));
            check("新建的文件内容就是默认内容",
                    Files.readString(missing, StandardCharsets.UTF_8).equals(BridgeConfig.defaultJson()));

            Path broken = dir.resolve("broken.json");
            String brokenText = "{\"bots\": [\"clawd\",";
            Files.writeString(broken, brokenText, StandardCharsets.UTF_8);
            BridgeConfig.Result b = BridgeConfig.load(broken);
            check("坏文件读出来是 broken", b.broken);
            check("坏文件不会被覆盖", Files.readString(broken, StandardCharsets.UTF_8).equals(brokenText));

            Path bom = dir.resolve("bom.json");
            Files.writeString(bom, "﻿{\"bots\": [\"Moby\"], \"playersCanSit\": false}", StandardCharsets.UTF_8);
            BridgeConfig.Result withBom = BridgeConfig.load(bom);
            check("带 BOM 的文件也能读", !withBom.broken && withBom.config.isBot("moby") && !withBom.config.playersCanSit());
        } finally {
            try (Stream<Path> walk = Files.walk(dir)) {
                walk.sorted(Comparator.reverseOrder()).forEach(p -> p.toFile().delete());
            }
        }
    }

    // ------------------------------------------------------------ 消息格式

    private static void protocolChecks() {
        check("pet 格式", Protocol.pet("CICSilver").equals("[xiaoke-bridge] pet CICSilver"));
        check("hold 格式", Protocol.hold("CICSilver").equals("[xiaoke-bridge] hold CICSilver"));
        check("give 格式", Protocol.give("CICSilver", "cooked_cod", 3).equals("[xiaoke-bridge] give CICSilver cooked_cod 3"));
        check("give-full 格式", Protocol.giveFull("CICSilver", "cooked_cod").equals("[xiaoke-bridge] give-full CICSilver cooked_cod"));
    }

    // ------------------------------------------------------------ 座位高度

    private static void seatMathChecks() {
        double pv = SeatMath.DEFAULT_PLAYER_VEHICLE_ATTACH_Y;
        double dp = SeatMath.DEFAULT_DISPLAY_PASSENGER_ATTACH_Y;
        check("默认挂点：玩家 0.6", pv == 0.6);
        check("默认挂点：展示实体 0", dp == 0.0);
        check("SIT_DEPTH 默认 0.7", SeatMath.SIT_DEPTH == 0.7);

        check("楼梯坐面 = 方块 y + 0.5", near(SeatMath.surfaceY(64, SeatMath.Kind.STAIRS), 64.5));
        check("台阶坐面 = 方块 y + 0.5", near(SeatMath.surfaceY(64, SeatMath.Kind.SLAB), 64.5));
        check("地毯坐面 = 方块 y + 0.0625", near(SeatMath.surfaceY(64, SeatMath.Kind.CARPET), 64.0625));
        check("负数 y 也对", near(SeatMath.surfaceY(-5, SeatMath.Kind.SLAB), -4.5));

        double stairSeat = SeatMath.seatY(SeatMath.surfaceY(64, SeatMath.Kind.STAIRS), pv, dp);
        check("楼梯座位 y = 坐面 − 0.1 = 64.4", near(stairSeat, 64.4));
        check("楼梯乘客脚底 = 坐面 − 0.7 = 63.8", near(SeatMath.riderFeetY(stairSeat, pv, dp), 63.8));

        double carpetSeat = SeatMath.seatY(SeatMath.surfaceY(64, SeatMath.Kind.CARPET), pv, dp);
        check("地毯座位 y = 63.9625", near(carpetSeat, 63.9625));
        check("地毯乘客脚底 = 63.3625", near(SeatMath.riderFeetY(carpetSeat, pv, dp), 63.3625));

        for (SeatMath.Kind kind : SeatMath.Kind.values()) {
            for (int y : new int[] {-64, 0, 64, 319}) {
                double s = SeatMath.surfaceY(y, kind);
                double seat = SeatMath.seatY(s, pv, dp);
                check("乘客脚底 = 坐面 − SIT_DEPTH（" + kind + ", y=" + y + "）",
                        near(SeatMath.riderFeetY(seat, pv, dp), s - SeatMath.SIT_DEPTH));
                // 体型被放大一倍的玩家（挂点 1.2）脚底也该落在同一处
                double bigSeat = SeatMath.seatY(s, 1.2, dp);
                check("挂点不同时乘客脚底仍然 = 坐面 − SIT_DEPTH（" + kind + ", y=" + y + "）",
                        near(SeatMath.riderFeetY(bigSeat, 1.2, dp), s - SeatMath.SIT_DEPTH));
                // 读盘时没有方块标签的回退算法：座位 y + 0.2 取整应该回到方块所在格
                check("座位 y + 0.2 取整回到方块格（" + kind + ", y=" + y + "）",
                        (int) Math.floor(seat + 0.2) == y);
            }
        }

        check("楼梯朝北 → 脸朝南 yaw 0", SeatMath.sitterYawForStairFacing("north") == 0.0f);
        check("楼梯朝南 → 脸朝北 yaw 180", SeatMath.sitterYawForStairFacing("south") == 180.0f);
        check("楼梯朝东 → 脸朝西 yaw 90", SeatMath.sitterYawForStairFacing("east") == 90.0f);
        check("楼梯朝西 → 脸朝东 yaw 270", SeatMath.sitterYawForStairFacing("west") == 270.0f);
        check("不认识的朝向返回 null", SeatMath.sitterYawForStairFacing("up") == null);
        check("null 朝向返回 null", SeatMath.sitterYawForStairFacing(null) == null);

        // 视线向量：yaw 0 朝南（+z），90 朝西（−x），180 朝北（−z），270 朝东（+x）
        check("yaw 0 朝 +z", nearVec(SeatMath.viewVector(0, 0), 0, 0, 1));
        check("yaw 90 朝 −x", nearVec(SeatMath.viewVector(90, 0), -1, 0, 0));
        check("yaw 180 朝 −z", nearVec(SeatMath.viewVector(180, 0), 0, 0, -1));
        check("yaw 270 朝 +x", nearVec(SeatMath.viewVector(270, 0), 1, 0, 0));
        check("pitch 90 朝下", nearVec(SeatMath.viewVector(0, 90), 0, -1, 0));
        // 用原版 Entity.lookAt 的公式把向量换回角度，应该得到原来的 yaw/pitch
        for (double yaw : new double[] {0, 37.5, 90, 180, 270}) {
            for (double pitch : new double[] {-60, 0, 45, 80}) {
                double[] v = SeatMath.viewVector(yaw, pitch);
                double backYaw = Math.toDegrees(Math.atan2(v[2], v[0])) - 90.0;
                double backPitch = -Math.toDegrees(Math.atan2(v[1], Math.sqrt(v[0] * v[0] + v[2] * v[2])));
                check("lookAt 能还原 yaw=" + yaw + " pitch=" + pitch,
                        nearAngle(backYaw, yaw) && Math.abs(backPitch - pitch) < 1.0e-6);
            }
        }
    }

    private static boolean nearVec(double[] v, double x, double y, double z) {
        return Math.abs(v[0] - x) < 1.0e-9 && Math.abs(v[1] - y) < 1.0e-9 && Math.abs(v[2] - z) < 1.0e-9;
    }

    private static boolean nearAngle(double a, double b) {
        double d = ((a - b) % 360.0 + 540.0) % 360.0 - 180.0;
        return Math.abs(d) < 1.0e-6;
    }

    // ------------------------------------------------------------ 冷却

    private static void cooldownChecks() {
        Cooldown c = new Cooldown(600);
        check("第一次放行", c.tryAcquire("a>b", 1_000));
        check("599 毫秒后还在冷却", !c.tryAcquire("a>b", 1_599));
        check("冷却中再点不会顺延", c.tryAcquire("a>b", 1_600));
        check("不同的人互不影响", c.tryAcquire("c>b", 1_601));
        check("同一个人点另一个小克互不影响", c.tryAcquire("a>d", 1_601));
        c.prune(10_000);
        check("过期记录会被清掉", c.size() == 0);
        Cooldown big = new Cooldown(600);
        for (int i = 0; i < 1000; i++) {
            big.tryAcquire("k" + i, i * 1000L);
        }
        check("记录多了会自动清理", big.size() < 300);
    }

    // ------------------------------------------------------------ 工具

    private static boolean near(double a, double b) {
        return Math.abs(a - b) < 1.0e-9;
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
