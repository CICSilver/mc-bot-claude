package local.xiaoke.perks;

import com.google.gson.Gson;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

public record PerksConfig(Map<String, Skill> skills, Combat combat, Enchanting enchanting) {
    public record Skill(String toolTag, double speedPerLevel, List<String> blocks, List<Reward> rewards) {}
    public record Reward(String item, int minLevel, double chanceAt99, int count) {}
    public record Combat(double meleeDamagePerLevel, double rangedDamagePerLevel,
                         double defenseReductionPerLevel, double arrowRefundPerLevel) {}
    public record Enchanting(double levelPreservationPerLevel, double upgradeChancePerLevel) {}

    public static PerksConfig load(Path path) throws IOException {
        if (Files.notExists(path)) {
            try (InputStream input = PerksConfig.class.getResourceAsStream("/skill-perks.json")) {
                Files.copy(input, path);
            }
        }
        Gson gson = new Gson();
        try (InputStream input = PerksConfig.class.getResourceAsStream("/skill-perks.json")) {
            com.google.gson.JsonObject merged = gson.fromJson(new String(input.readAllBytes(), StandardCharsets.UTF_8), com.google.gson.JsonObject.class);
            com.google.gson.JsonObject saved = gson.fromJson(Files.readString(path, StandardCharsets.UTF_8), com.google.gson.JsonObject.class);
            saved.entrySet().forEach(entry -> merged.add(entry.getKey(), entry.getValue()));
            return gson.fromJson(merged, PerksConfig.class);
        }
    }

    public static double perLevel(double rate, int level) {
        return rate * Math.clamp(level, 0, 99);
    }

    public static double speedBonus(Skill skill, int level) {
        return Math.clamp(level, 0, 99) * skill.speedPerLevel();
    }

    public static double chance(Reward reward, int level) {
        return level >= reward.minLevel() ? reward.chanceAt99() * Math.clamp(level, 0, 99) / 99.0 : 0;
    }

    /** 一个随机数对应互斥区间，每次挖方块最多额外掉落一份奖励。 */
    public static Reward roll(List<Reward> rewards, int level, double random) {
        double cumulative = 0;
        for (Reward reward : rewards) {
            cumulative += chance(reward, level);
            if (random < cumulative) return reward;
        }
        return null;
    }
}
