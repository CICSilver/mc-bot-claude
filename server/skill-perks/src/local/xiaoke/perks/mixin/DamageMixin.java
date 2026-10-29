package local.xiaoke.perks.mixin;

import local.xiaoke.perks.CombatPerks;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.LivingEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(LivingEntity.class)
public abstract class DamageMixin {
    @ModifyVariable(method = "hurtServer", at = @At("HEAD"), argsOnly = true)
    private float skillPerks$outgoing(float amount, ServerLevel world, DamageSource source, float original) {
        return CombatPerks.outgoing(source, amount);
    }

    @Inject(method = "getDamageAfterMagicAbsorb", at = @At("RETURN"), cancellable = true)
    private void skillPerks$defense(DamageSource source, float amount, CallbackInfoReturnable<Float> cir) {
        if ((Object) this instanceof ServerPlayer player) {
            cir.setReturnValue(CombatPerks.incoming(player, source, cir.getReturnValue()));
        }
    }
}
