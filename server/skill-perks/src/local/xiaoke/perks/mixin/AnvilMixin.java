package local.xiaoke.perks.mixin;

import local.xiaoke.perks.CombatPerks;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.AnvilMenu;
import net.minecraft.world.item.ItemStack;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(AnvilMenu.class)
public abstract class AnvilMixin {
    @Unique private int skillPerks$savedLevels;

    @Inject(method = "onTake", at = @At("HEAD"))
    private void skillPerks$calculate(Player player, ItemStack result, CallbackInfo ci) {
        skillPerks$savedLevels = 0;
        AnvilMenu menu = (AnvilMenu) (Object) this;
        int levels = menu.getCost();
        if (player instanceof ServerPlayer serverPlayer && !player.hasInfiniteMaterials() && levels > 0
                && CombatPerks.addsEnchantment(menu.getSlot(0).getItem(), result)) {
            skillPerks$savedLevels = levels - CombatPerks.payableLevels(serverPlayer, levels);
        }
    }

    @Inject(method = "onTake", at = @At("TAIL"))
    private void skillPerks$refund(Player player, ItemStack result, CallbackInfo ci) {
        if (skillPerks$savedLevels > 0) player.giveExperienceLevels(skillPerks$savedLevels);
        skillPerks$savedLevels = 0;
    }
}
