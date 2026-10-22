package local.xiaoke.perks.mixin;

import com.github.ob_yekt.simpleskills.Skills;
import local.xiaoke.perks.CombatPerks;
import local.xiaoke.perks.SkillPerks;
import net.minecraft.core.component.DataComponents;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.tags.ItemTags;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.ProjectileWeaponItem;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(ProjectileWeaponItem.class)
public abstract class AmmoMixin {
    @Inject(method = "useAmmo", at = @At("RETURN"))
    private static void skillPerks$refund(ItemStack weapon, ItemStack ammo, LivingEntity shooter, boolean extra,
                                         CallbackInfoReturnable<ItemStack> cir) {
        ItemStack consumed = cir.getReturnValue();
        if (shooter instanceof ServerPlayer player && consumed.is(ItemTags.ARROWS)
                && !consumed.has(DataComponents.INTANGIBLE_PROJECTILE)) {
            double chance = CombatPerks.rate(player, Skills.RANGED, SkillPerks.settings().combat().arrowRefundPerLevel());
            for (int i = 0; i < consumed.getCount(); i++) {
                if (player.getRandom().nextDouble() < chance) {
                    ItemStack refund = consumed.copyWithCount(1);
                    if (!player.getInventory().add(refund)) player.drop(refund, false);
                }
            }
        }
    }
}
