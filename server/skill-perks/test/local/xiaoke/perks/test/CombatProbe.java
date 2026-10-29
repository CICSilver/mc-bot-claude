package local.xiaoke.perks.test;

import com.google.gson.Gson;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.github.ob_yekt.simpleskills.Skills;
import com.github.ob_yekt.simpleskills.managers.DatabaseManager;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.animal.cow.Cow;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.entity.projectile.arrow.Arrow;
import net.minecraft.world.inventory.AnvilMenu;
import net.minecraft.world.inventory.ContainerLevelAccess;
import net.minecraft.world.inventory.EnchantmentMenu;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.ProjectileWeaponItem;
import net.minecraft.world.item.alchemy.PotionContents;
import net.minecraft.world.item.alchemy.Potions;
import net.minecraft.world.item.enchantment.EnchantmentHelper;
import net.minecraft.world.item.enchantment.Enchantments;
import net.minecraft.world.level.block.Blocks;
import java.util.LinkedHashMap;
import java.util.Map;

/** 独立测试模组，通过原版伤害、弹药消耗和菜单操作验证技能。 */
public final class CombatProbe implements ModInitializer {
    @Override public void onInitialize() {
        CommandRegistrationCallback.EVENT.register((dispatcher, context, selection) -> dispatcher.register(
                Commands.literal("perks-probe").then(Commands.argument("action", StringArgumentType.word()).executes(ctx -> {
                    ServerPlayer player = ctx.getSource().getServer().getPlayerList().getPlayerByName("SkillTester");
                    try {
                        Map<String, Object> result = probe(player, StringArgumentType.getString(ctx, "action"));
                        ctx.getSource().sendSuccess(() -> Component.literal("PERKS_PROBE " + new Gson().toJson(result)), false);
                        return 1;
                    } catch (ReflectiveOperationException e) { throw new IllegalStateException(e); }
                }))));
    }

    private static int xp(ServerPlayer player, Skills skill) {
        return DatabaseManager.getInstance().getAllSkills(player.getStringUUID()).get(skill.getId()).xp();
    }

    private static Map<String, Object> probe(ServerPlayer player, String action) throws ReflectiveOperationException {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("action", action);
        var world = player.level();
        if (action.equals("melee") || action.equals("ranged")) {
            Cow target = new Cow(EntityType.COW, world);
            target.getAttribute(Attributes.MAX_HEALTH).setBaseValue(100);
            target.setHealth(100);
            target.setPos(player.getX() + 3, player.getY(), player.getZ());
            int rangedBefore = xp(player, Skills.RANGED), meleeBefore = xp(player, Skills.SLAYING);
            var source = world.damageSources().playerAttack(player);
            if (action.equals("ranged")) {
                Arrow arrow = new Arrow(world, player, new ItemStack(Items.ARROW), new ItemStack(Items.BOW));
                source = world.damageSources().arrow(arrow, player);
            }
            target.hurtServer(world, source, 10);
            result.put("damage", 100 - target.getHealth());
            result.put("rangedXp", xp(player, Skills.RANGED) - rangedBefore);
            result.put("meleeXp", xp(player, Skills.SLAYING) - meleeBefore);
        } else if (action.equals("defense")) {
            player.invulnerableTime = 0;
            player.setHealth(20);
            player.hurtServer(world, world.damageSources().magic(), 10);
            result.put("damage", 20 - player.getHealth());
            player.setHealth(20);
        } else if (action.equals("ammo")) {
            var use = ProjectileWeaponItem.class.getDeclaredMethod("useAmmo", ItemStack.class, ItemStack.class,
                    net.minecraft.world.entity.LivingEntity.class, boolean.class);
            use.setAccessible(true);
            for (var type : new net.minecraft.world.item.Item[]{Items.ARROW, Items.SPECTRAL_ARROW, Items.TIPPED_ARROW}) {
                player.getInventory().clearContent();
                ItemStack ammo = new ItemStack(type, 20);
                if (type == Items.TIPPED_ARROW) ammo.set(DataComponents.POTION_CONTENTS, new PotionContents(Potions.SLOW_FALLING));
                ItemStack consumed = (ItemStack) use.invoke(null, new ItemStack(Items.BOW), ammo, player, false);
                int refunds = 0;
                for (ItemStack item : player.getInventory().getNonEquipmentItems()) {
                    if (ItemStack.isSameItemSameComponents(consumed, item)) refunds += item.getCount();
                }
                result.put(type.toString(), refunds);
                result.put("consumed", 20 - ammo.getCount());
            }
        } else if (action.equals("enchant")) {
            player.setExperienceLevels(30);
            var seed = Player.class.getDeclaredField("enchantmentSeed");
            seed.setAccessible(true); seed.setInt(player, 23456);
            BlockPos pos = new BlockPos(4, 70, 0);
            world.setBlockAndUpdate(pos, Blocks.ENCHANTING_TABLE.defaultBlockState());
            EnchantmentMenu menu = new EnchantmentMenu(50, player.getInventory(), ContainerLevelAccess.create(world, pos));
            menu.getSlot(0).set(new ItemStack(Items.DIAMOND_PICKAXE));
            menu.getSlot(1).set(new ItemStack(Items.LAPIS_LAZULI, 20));
            result.put("required", menu.costs[0]);
            result.put("success", menu.clickMenuButton(player, 0));
            var enchants = EnchantmentHelper.getEnchantmentsForCrafting(menu.getSlot(0).getItem());
            Map<String, Integer> levels = new LinkedHashMap<>();
            for (var e : enchants.keySet()) levels.put(e.unwrapKey().orElseThrow().identifier().toString(), enchants.getLevel(e));
            result.put("enchants", levels);
            result.put("levelsPaid", 30 - player.experienceLevel);
            result.put("lapisPaid", 20 - menu.getSlot(1).getItem().getCount());
        } else if (action.equals("anvil")) {
            player.setExperienceLevels(40);
            AnvilMenu menu = new AnvilMenu(51, player.getInventory(), ContainerLevelAccess.create(world, new BlockPos(4, 70, 1)));
            world.setBlockAndUpdate(new BlockPos(4, 70, 1), Blocks.ANVIL.defaultBlockState());
            ItemStack book = new ItemStack(Items.ENCHANTED_BOOK);
            book.enchant(world.registryAccess().lookupOrThrow(Registries.ENCHANTMENT).getOrThrow(Enchantments.SHARPNESS), 1);
            menu.getSlot(0).set(new ItemStack(Items.DIAMOND_SWORD));
            menu.getSlot(1).set(book);
            menu.createResult();
            result.put("cost", menu.getCost());
            result.put("hasOutput", !menu.getSlot(2).getItem().isEmpty());
            var take = AnvilMenu.class.getDeclaredMethod("onTake", Player.class, ItemStack.class);
            take.setAccessible(true);
            take.invoke(menu, player, menu.getSlot(2).getItem().copy());
            result.put("levelsPaid", 40 - player.experienceLevel);
        }
        return result;
    }
}
