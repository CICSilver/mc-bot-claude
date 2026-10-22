package local.xiaoke.perks.mixin;

import local.xiaoke.perks.CombatPerks;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

@Mixin(Player.class)
public abstract class EnchantingPlayerMixin {
    @ModifyVariable(method = "onEnchantmentPerformed", at = @At("HEAD"), argsOnly = true)
    private int skillPerks$discount(int levels) {
        return (Object) this instanceof ServerPlayer player ? CombatPerks.payableLevels(player, levels) : levels;
    }
}
