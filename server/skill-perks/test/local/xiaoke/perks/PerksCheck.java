package local.xiaoke.perks;

import com.google.gson.Gson;
import java.nio.file.Files;
import java.nio.file.Path;

public final class PerksCheck {
    public static void main(String[] args) throws Exception {
        PerksConfig config = new Gson().fromJson(Files.readString(Path.of(args[0])), PerksConfig.class);
        PerksConfig.Skill mining = config.skills().get("MINING");
        PerksConfig.Reward coal = mining.rewards().getFirst();
        PerksConfig.Reward iron = mining.rewards().get(1);
        require(Math.abs(PerksConfig.speedBonus(mining, 50) - 0.50) < 1e-9, "50级采矿速度增加50%");
        require(Math.abs(PerksConfig.speedBonus(mining, 99) - 0.99) < 1e-9, "99级采矿速度增加99%");
        require(Math.abs(PerksConfig.chance(coal, 33) - (0.10 / 3)) < 1e-9, "33级煤炭概率约3.333%");
        require(PerksConfig.chance(iron, 5) == 0, "铁从10级开放");
        require(PerksConfig.roll(mining.rewards(), 99, 0.02) == coal, "煤炭奖励");
        require(PerksConfig.roll(mining.rewards(), 99, 0.12) == iron, "铁奖励");
        int hits = 0;
        for (int i = 0; i < 100000; i++) {
            if (PerksConfig.roll(mining.rewards(), 99, (i + 0.5) / 100000.0) != null) hits++;
        }
        require(hits == 19700, "99级每块石头总额外掉落概率19.7%");
        require(Math.abs(PerksConfig.perLevel(config.combat().meleeDamagePerLevel(), 99) - 0.495) < 1e-9, "满级近战增加49.5%");
        require(Math.abs(PerksConfig.perLevel(config.combat().defenseReductionPerLevel(), 99) - 0.198) < 1e-9, "满级防御减伤19.8%");
        require(Math.abs(PerksConfig.perLevel(config.combat().arrowRefundPerLevel(), 99) - 0.2475) < 1e-9, "满级返箭24.75%");
        require(Math.abs(PerksConfig.perLevel(config.enchanting().levelPreservationPerLevel(), 99) - 0.297) < 1e-9, "满级保留经验29.7%");
        require(Math.abs(PerksConfig.perLevel(config.enchanting().upgradeChancePerLevel(), 99) - 0.198) < 1e-9, "满级词条提升19.8%");
        System.out.println("PASS: 速度、等级成长、资源解锁、奖励区间和默认总掉率");
    }

    private static void require(boolean passed, String description) {
        if (!passed) throw new AssertionError(description);
    }
}
