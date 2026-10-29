package local.xiaoke.perks.mixin;

import com.github.ob_yekt.simpleskills.Skills;
import com.github.ob_yekt.simpleskills.events.EventHandlers;
import com.github.ob_yekt.simpleskills.managers.ConfigManager;
import com.github.ob_yekt.simpleskills.managers.XPManager;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.decoration.ArmorStand;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.entity.projectile.Projectile;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(value = EventHandlers.class, remap = false)
public abstract class RangedExperienceMixin {
    @Inject(method = "lambda$registerCombatHandlers$2", at = @At("HEAD"), cancellable = true)
    private static void skillPerks$rangedExperience(LivingEntity target, DamageSource source, float amount,
                                                    CallbackInfoReturnable<Boolean> cir) {
        if (source.getDirectEntity() instanceof Projectile projectile && projectile.getOwner() instanceof ServerPlayer player) {
            var combat = ConfigManager.getCombatConfig();
            float threshold = combat.get("ranged_min_damage_threshold").getAsFloat();
            if (!(target instanceof Player) && !(target instanceof ArmorStand) && amount >= threshold) {
                int xp = (int) (amount * combat.get("ranged_xp_per_damage").getAsFloat());
                XPManager.addXPWithNotification(player, Skills.RANGED, xp);
            }
            cir.setReturnValue(true);
        }
    }
}
