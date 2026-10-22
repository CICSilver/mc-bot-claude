package local.xiaoke.perks.mixin;

import com.github.ob_yekt.simpleskills.Skills;
import local.xiaoke.perks.CombatPerks;
import local.xiaoke.perks.SkillPerks;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.projectile.Projectile;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Projectile.class)
public abstract class ProjectileMixin implements CombatPerks.RangedShot {
    @Unique private double skillPerks$rangedBonus;

    @Override public double skillPerks$rangedBonus() { return skillPerks$rangedBonus; }

    @Inject(method = "setOwner(Lnet/minecraft/world/entity/Entity;)V", at = @At("TAIL"))
    private void skillPerks$rememberLevel(Entity owner, CallbackInfo ci) {
        skillPerks$rangedBonus = owner instanceof ServerPlayer player
                ? CombatPerks.rate(player, Skills.RANGED, SkillPerks.settings().combat().rangedDamagePerLevel()) : 0;
    }
}
