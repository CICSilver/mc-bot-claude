package local.xiaoke.perks;

import com.github.ob_yekt.simpleskills.Skills;
import com.github.ob_yekt.simpleskills.managers.XPManager;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.tags.DamageTypeTags;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.damagesource.DamageTypes;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.projectile.Projectile;
import net.minecraft.world.entity.projectile.arrow.AbstractArrow;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.enchantment.EnchantmentHelper;

public final class CombatPerks {
    private CombatPerks() {}

    public interface RangedShot {
        double skillPerks$rangedBonus();
    }

    public static double rate(ServerPlayer player, Skills skill, double perLevel) {
        return PerksConfig.perLevel(perLevel, XPManager.getSkillLevel(player.getStringUUID(), skill));
    }

    public static float outgoing(DamageSource source, float amount) {
        if (source.getDirectEntity() instanceof AbstractArrow arrow) {
            return (float) (amount * (1 + ((RangedShot) arrow).skillPerks$rangedBonus()));
        }
        if (source.getEntity() instanceof ServerPlayer player
                && (source.is(DamageTypes.PLAYER_ATTACK) || source.is(DamageTypes.MACE_SMASH))) {
            return (float) (amount * (1 + rate(player, Skills.SLAYING, SkillPerks.settings().combat().meleeDamagePerLevel())));
        }
        return amount;
    }

    public static float incoming(ServerPlayer player, DamageSource source, float amount) {
        boolean combat = source.getEntity() instanceof LivingEntity || source.getDirectEntity() instanceof Projectile
                || source.is(DamageTypeTags.IS_EXPLOSION) || source.is(DamageTypes.MAGIC)
                || source.is(DamageTypes.INDIRECT_MAGIC);
        return combat ? (float) (amount * (1 - rate(player, Skills.DEFENSE,
                SkillPerks.settings().combat().defenseReductionPerLevel()))) : amount;
    }

    public static int payableLevels(ServerPlayer player, int levels) {
        double chance = rate(player, Skills.ENCHANTING, SkillPerks.settings().enchanting().levelPreservationPerLevel());
        int paid = 0;
        for (int i = 0; i < levels; i++) {
            if (player.getRandom().nextDouble() >= chance) paid++;
        }
        return paid;
    }

    public static void upgradeEnchantment(ServerPlayer player, ItemStack result) {
        var enchantments = EnchantmentHelper.getEnchantmentsForCrafting(result);
        var candidates = enchantments.keySet().stream()
                .filter(e -> enchantments.getLevel(e) < e.value().getMaxLevel()).toList();
        if (candidates.isEmpty()) return;
        double chance = rate(player, Skills.ENCHANTING, SkillPerks.settings().enchanting().upgradeChancePerLevel());
        if (player.getRandom().nextDouble() < chance) {
            var chosen = candidates.get(player.getRandom().nextInt(candidates.size()));
            result.enchant(chosen, enchantments.getLevel(chosen) + 1);
        }
    }

    public static boolean addsEnchantment(ItemStack input, ItemStack result) {
        var original = EnchantmentHelper.getEnchantmentsForCrafting(input);
        var output = EnchantmentHelper.getEnchantmentsForCrafting(result);
        return output.keySet().stream().anyMatch(e -> output.getLevel(e) > original.getLevel(e));
    }
}
