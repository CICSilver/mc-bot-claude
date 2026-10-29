package local.xiaoke.perks.mixin;

import local.xiaoke.perks.CombatPerks;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.Container;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.EnchantmentMenu;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(EnchantmentMenu.class)
public abstract class EnchantingMenuMixin {
    @Shadow @Final private Container enchantSlots;

    @Inject(method = "lambda$clickMenuButton$0", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/world/item/ItemStack;consume(ILnet/minecraft/world/entity/LivingEntity;)V"))
    private void skillPerks$quality(ItemStack input, int button, Player player, int cost, ItemStack lapis,
                                    Level world, BlockPos pos, CallbackInfo ci) {
        if (player instanceof ServerPlayer serverPlayer) {
            CombatPerks.upgradeEnchantment(serverPlayer, enchantSlots.getItem(0));
        }
    }
}
