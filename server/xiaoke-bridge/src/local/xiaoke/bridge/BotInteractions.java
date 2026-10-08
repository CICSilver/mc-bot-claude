package local.xiaoke.bridge;

import net.minecraft.core.Holder;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.animal.feline.CatSoundVariant;
import net.minecraft.world.entity.animal.feline.CatSoundVariants;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.EntityHitResult;

import java.util.concurrent.ThreadLocalRandom;

/**
 * 普通玩家右键小克：
 * <ul>
 *   <li>按着潜行（Shift）右键 → hold（牵手）</li>
 *   <li>主手空着右键 → pet（摸头）</li>
 *   <li>主手拿着东西右键 → give（把整组东西塞进她背包，塞不下的留在手里；一个都塞不下就是 give-full）</li>
 * </ul>
 * 每次都给小克自己的客户端发一条系统消息（格式见 {@link Protocol}），服务器日志记一行。
 */
final class BotInteractions {
    private BotInteractions() {}

    /** 同一个玩家对同一个小克，600 毫秒内只算一次。 */
    static final long COOLDOWN_MS = 600;

    private static final Cooldown COOLDOWN = new Cooldown(COOLDOWN_MS);

    static InteractionResult onUseEntity(Player player, Level level, InteractionHand hand, Entity entity, EntityHitResult hit) {
        try {
            if (level.isClientSide() || !(player instanceof ServerPlayer giver) || !(entity instanceof ServerPlayer bot)) {
                return InteractionResult.PASS;
            }
            if (giver == bot) {
                return InteractionResult.PASS;
            }
            BridgeConfig cfg = XiaokeBridge.config();
            String botName = bot.getGameProfile().name();
            String giverName = giver.getGameProfile().name();
            if (!cfg.isBot(botName) || cfg.isBot(giverName)) {
                // 点的不是小克，或者是小克在点别人：都不管
                return InteractionResult.PASS;
            }
            if (hand != InteractionHand.MAIN_HAND) {
                // 原版客户端两只手各发一次，只处理主手那次
                return InteractionResult.PASS;
            }
            if (giver.isSpectator()) {
                return InteractionResult.PASS;
            }
            String key = giver.getUUID() + ">" + bot.getUUID();
            if (!COOLDOWN.tryAcquire(key, System.currentTimeMillis())) {
                return InteractionResult.SUCCESS;
            }

            ServerLevel sl = bot.level();
            String message;
            String logAction;
            if (giver.isShiftKeyDown()) {
                message = Protocol.hold(giverName);
                logAction = "hold";
                hearts(sl, bot, 2);
            } else if (giver.getMainHandItem().isEmpty()) {
                message = Protocol.pet(giverName);
                logAction = "pet";
                hearts(sl, bot, 4);
                purr(sl, bot);
            } else {
                ItemStack held = giver.getMainHandItem();
                String itemId = BuiltInRegistries.ITEM.getKey(held.getItem()).getPath();
                ItemStack moving = held.copy();
                int before = moving.getCount();
                bot.getInventory().add(moving);
                int moved = before - moving.getCount();
                if (moved > 0) {
                    giver.setItemInHand(InteractionHand.MAIN_HAND, moving.isEmpty() ? ItemStack.EMPTY : moving);
                    message = Protocol.give(giverName, itemId, moved);
                    logAction = "give " + itemId + " " + moved;
                    pickupSound(sl, bot);
                } else {
                    // 她背包满了，东西还在给的人手里
                    message = Protocol.giveFull(giverName, itemId);
                    logAction = "give-full " + itemId;
                }
            }

            bot.sendSystemMessage(Component.literal(message));
            XiaokeBridge.LOG.info("[xiaoke-bridge] {} -> {}: {}", giverName, botName, logAction);
            // Fabric 在这里返回非 PASS 会直接取消原版处理（原版那边的挥手也不会发生），所以自己挥一下手，
            // true = 连他自己的客户端也播挥手动画
            giver.swing(InteractionHand.MAIN_HAND, true);
            return InteractionResult.SUCCESS;
        } catch (VirtualMachineError e) {
            throw e;
        } catch (Throwable t) {
            XiaokeBridge.LOG.error("[xiaoke-bridge] 处理右键小克时出错，按原版处理", t);
            return InteractionResult.PASS;
        }
    }

    /** 小克头顶冒爱心，附近所有人都看得到。 */
    private static void hearts(ServerLevel level, ServerPlayer bot, int count) {
        double y = bot.getY() + bot.getBbHeight() + 0.35;
        level.sendParticles(ParticleTypes.HEART, bot.getX(), y, bot.getZ(), count, 0.3, 0.15, 0.3, 0.0);
    }

    /** 猫咪呼噜声（26.1 的猫叫按品种分了组，用经典那组成年猫的 purr，也就是 entity.cat.purr）。 */
    private static void purr(ServerLevel level, ServerPlayer bot) {
        try {
            CatSoundVariant variant = SoundEvents.CAT_SOUNDS.get(CatSoundVariants.SoundSet.CLASSIC);
            if (variant == null) {
                return;
            }
            Holder<SoundEvent> sound = variant.adultSounds().purrSound();
            level.playSound(null, bot.getX(), bot.getY(), bot.getZ(), sound, SoundSource.PLAYERS, 1.0f, 1.15f);
        } catch (VirtualMachineError e) {
            throw e;
        } catch (Throwable t) {
            XiaokeBridge.LOG.warn("[xiaoke-bridge] 播呼噜声失败", t);
        }
    }

    /** 捡东西的"啵"一声，音高随机，跟原版捡起物品一样。 */
    private static void pickupSound(ServerLevel level, ServerPlayer bot) {
        ThreadLocalRandom r = ThreadLocalRandom.current();
        float pitch = ((r.nextFloat() - r.nextFloat()) * 0.7f + 1.0f) * 2.0f;
        level.playSound(null, bot.getX(), bot.getY(), bot.getZ(), SoundEvents.ITEM_PICKUP, SoundSource.PLAYERS, 0.3f, pitch);
    }

    static void clear() {
        COOLDOWN.clear();
    }
}
