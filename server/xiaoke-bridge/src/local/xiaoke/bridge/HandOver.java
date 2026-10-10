package local.xiaoke.bridge;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import net.minecraft.ChatFormatting;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.Holder;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.HoverEvent;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.protocol.game.ClientboundSoundPacket;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.ItemStackTemplate;

import java.util.List;
import java.util.function.UnaryOperator;

/**
 * 小克把东西递给别人（不用扔在地上）：
 * <ol>
 *   <li>小克执行 {@code /xiaoke-hand to <玩家名> <物品id> [数量]}（只有名单里的小克能用）。她要在对方身边（8 格内）、身上真有这东西。</li>
 *   <li>对方聊天栏里出现一行只有 TA 自己看得见的“小克 想把 面包 ×3 递给你 [收下] [不用了]”，叮一声；小克挥一下手。</li>
 *   <li>对方点“收下”：东西从小克背包直接进对方背包（放不下的留在小克身上）；点“不用了”或者一分钟没点：东西还在小克身上。</li>
 * </ol>
 * 每一步都用系统消息告诉小克（格式见 {@link Protocol}）。
 */
final class HandOver {
    private HandOver() {}

    static final String COMMAND = "xiaoke-hand";
    /** 递东西时离对方最远多少格；对方点收下时离开远了（超过 ACCEPT_RANGE）就先不给。 */
    static final double OFFER_RANGE = 8;
    static final double ACCEPT_RANGE = 16;
    /** 玩家看到的名字：名单里的都是小克。 */
    static final String NICKNAME = "小克";

    private static final Offers OFFERS = new Offers();
    private static int ticks;

    static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal(COMMAND)
                .then(Commands.literal("to")
                        .requires(HandOver::fromBot)
                        .then(Commands.argument("player", StringArgumentType.word())
                                .then(Commands.argument("item", StringArgumentType.word())
                                        .executes(ctx -> offer(ctx, 0))
                                        .then(Commands.argument("count", IntegerArgumentType.integer(1, 64 * 36))
                                                .executes(ctx -> offer(ctx, IntegerArgumentType.getInteger(ctx, "count")))))))
                .then(Commands.literal("accept")
                        .then(Commands.argument("id", IntegerArgumentType.integer(1)).executes(ctx -> answer(ctx, true))))
                .then(Commands.literal("decline")
                        .then(Commands.argument("id", IntegerArgumentType.integer(1)).executes(ctx -> answer(ctx, false)))));
    }

    private static boolean fromBot(CommandSourceStack source) {
        ServerPlayer p = source.getPlayer();
        return p != null && XiaokeBridge.config().isBot(p.getGameProfile().name());
    }

    // ------------------------------------------------------------ 小克递出去

    private static int offer(CommandContext<CommandSourceStack> ctx, int wanted) {
        try {
            ServerPlayer bot = ctx.getSource().getPlayer();
            if (bot == null) {
                return 0;
            }
            String targetName = StringArgumentType.getString(ctx, "player");
            String itemId = stripNamespace(StringArgumentType.getString(ctx, "item"));
            MinecraftServer server = ctx.getSource().getServer();
            ServerPlayer target = server.getPlayerList().getPlayerByName(targetName);
            if (target == null) {
                return fail(bot, targetName, "offline");
            }
            targetName = target.getGameProfile().name();
            if (target == bot) {
                return fail(bot, targetName, "self");
            }
            if (target.level() != bot.level() || target.distanceTo(bot) > OFFER_RANGE) {
                return fail(bot, targetName, "far");
            }
            List<ItemStack> items = bot.getInventory().getNonEquipmentItems();
            int have = count(items, itemId);
            if (have == 0) {
                return fail(bot, targetName, "none");
            }
            int n = wanted <= 0 ? have : Math.min(wanted, have);
            ItemStack sample = first(items, itemId).copyWithCount(n);
            Offers.Offer o = OFFERS.create(bot.getUUID(), bot.getGameProfile().name(), target.getUUID(), targetName, itemId, n, System.currentTimeMillis());

            target.sendSystemMessage(offerLine(sample, n, o.id()));
            soundTo(target, SoundEvents.NOTE_BLOCK_CHIME, 0.6f, 1.6f);
            bot.swing(InteractionHand.MAIN_HAND, true);
            bot.sendSystemMessage(Component.literal(Protocol.handOffered(targetName, itemId, n)));
            XiaokeBridge.LOG.info("[xiaoke-bridge] {} -> {}: hand {} {}", bot.getGameProfile().name(), targetName, itemId, n);
            return 1;
        } catch (VirtualMachineError e) {
            throw e;
        } catch (Throwable t) {
            XiaokeBridge.LOG.error("[xiaoke-bridge] 小克递东西时出错", t);
            return 0;
        }
    }

    private static int fail(ServerPlayer bot, String targetName, String reason) {
        bot.sendSystemMessage(Component.literal(Protocol.handError(targetName, reason)));
        return 0;
    }

    /** “小克 想把 面包 ×3 递给你 [收下] [不用了]”：物品名按对方客户端的语言显示，鼠标放上去看得到物品详情。 */
    private static Component offerLine(ItemStack sample, int n, int id) {
        HoverEvent showItem = new HoverEvent.ShowItem(ItemStackTemplate.fromNonEmptyStack(sample));
        return Component.literal(NICKNAME).withStyle(ChatFormatting.LIGHT_PURPLE)
                .append(Component.literal(" 想把 ").withStyle(ChatFormatting.WHITE))
                .append(sample.getHoverName().copy().withStyle(s -> s.withColor(ChatFormatting.YELLOW).withHoverEvent(showItem)))
                .append(Component.literal(" ×" + n + " 递给你  ").withStyle(ChatFormatting.WHITE))
                .append(button("[收下]", ChatFormatting.GREEN, "/" + COMMAND + " accept " + id, "点一下，东西直接放进你的背包"))
                .append(Component.literal(" "))
                .append(button("[不用了]", ChatFormatting.GRAY, "/" + COMMAND + " decline " + id, "东西还留在" + NICKNAME + "身上"));
    }

    private static MutableComponent button(String text, ChatFormatting color, String command, String hint) {
        return Component.literal(text).withStyle(s -> s.withColor(color).withBold(true)
                .withClickEvent(new ClickEvent.RunCommand(command))
                .withHoverEvent(new HoverEvent.ShowText(Component.literal(hint))));
    }

    // ------------------------------------------------------------ 对方点了

    private static int answer(CommandContext<CommandSourceStack> ctx, boolean accept) {
        try {
            ServerPlayer player = ctx.getSource().getPlayer();
            if (player == null) {
                return 0;
            }
            Offers.Offer o = OFFERS.peek(IntegerArgumentType.getInteger(ctx, "id"), player.getUUID());
            if (o == null) {
                player.sendSystemMessage(gray("（这个已经过期了）"));
                return 0;
            }
            ServerPlayer bot = ctx.getSource().getServer().getPlayerList().getPlayer(o.bot());
            if (bot == null) {
                OFFERS.remove(o.id());
                player.sendSystemMessage(gray("（" + NICKNAME + "已经下线了）"));
                return 0;
            }
            if (!accept) {
                OFFERS.remove(o.id());
                bot.sendSystemMessage(Component.literal(Protocol.handEnd("declined", o.targetName(), o.itemId())));
                player.sendSystemMessage(gray("（没有收下，东西还在" + NICKNAME + "身上）"));
                XiaokeBridge.LOG.info("[xiaoke-bridge] {} declined {} from {}", o.targetName(), o.itemId(), o.botName());
                return 1;
            }
            if (player.level() != bot.level() || player.distanceTo(bot) > ACCEPT_RANGE) {
                player.sendSystemMessage(gray("（离" + NICKNAME + "太远了，走近一点再点「收下」）"));
                return 0;
            }
            List<ItemStack> items = bot.getInventory().getNonEquipmentItems();
            if (count(items, o.itemId()) == 0) {
                OFFERS.remove(o.id());
                bot.sendSystemMessage(Component.literal(Protocol.handEnd("gone", o.targetName(), o.itemId())));
                player.sendSystemMessage(gray("（" + NICKNAME + "身上已经没有这个了）"));
                return 0;
            }
            Component name = first(items, o.itemId()).getHoverName();
            int moved = transfer(items, o.itemId(), o.count(), stack -> {
                player.getInventory().add(stack);
                return stack;
            });
            if (moved == 0) {
                // 对方背包满了：这一份留着，腾出地方还能再点
                bot.sendSystemMessage(Component.literal(Protocol.handEnd("full", o.targetName(), o.itemId())));
                player.sendSystemMessage(gray("（背包满了，腾出地方再点「收下」）"));
                return 0;
            }
            OFFERS.remove(o.id());
            bot.getInventory().setChanged();
            player.getInventory().setChanged();
            soundTo(player, SoundEvents.ITEM_PICKUP, 0.4f, 1.4f);
            String rest = moved < o.count() ? "，背包放不下的还在" + NICKNAME + "身上" : "";
            player.sendSystemMessage(Component.literal("收下了 ").withStyle(ChatFormatting.GRAY)
                    .append(name.copy().withStyle(ChatFormatting.YELLOW))
                    .append(Component.literal(" ×" + moved + rest).withStyle(ChatFormatting.GRAY)));
            bot.sendSystemMessage(Component.literal(Protocol.handed(o.targetName(), o.itemId(), moved)));
            XiaokeBridge.LOG.info("[xiaoke-bridge] {} took {} {} from {}", o.targetName(), o.itemId(), moved, o.botName());
            return 1;
        } catch (VirtualMachineError e) {
            throw e;
        } catch (Throwable t) {
            XiaokeBridge.LOG.error("[xiaoke-bridge] 处理收下 / 不用了时出错", t);
            return 0;
        }
    }

    /** 每秒看一次：一分钟没人点的收回，告诉小克。 */
    static void onServerTick(MinecraftServer server) {
        if (++ticks % 20 != 0) {
            return;
        }
        for (Offers.Offer o : OFFERS.expire(System.currentTimeMillis())) {
            ServerPlayer bot = server.getPlayerList().getPlayer(o.bot());
            if (bot != null) {
                bot.sendSystemMessage(Component.literal(Protocol.handEnd("expired", o.targetName(), o.itemId())));
            }
        }
    }

    static void clear() {
        OFFERS.clear();
    }

    // ------------------------------------------------------------ 背包

    static String idOf(ItemStack stack) {
        return BuiltInRegistries.ITEM.getKey(stack.getItem()).getPath();
    }

    static String stripNamespace(String id) {
        int colon = id.indexOf(':');
        return (colon >= 0 ? id.substring(colon + 1) : id).toLowerCase(java.util.Locale.ROOT);
    }

    private static final Transfer.Ops<ItemStack> STACKS = new Transfer.Ops<>() {
        @Override public boolean isEmpty(ItemStack s) { return s == null || s.isEmpty(); }
        @Override public String id(ItemStack s) { return idOf(s); }
        @Override public int count(ItemStack s) { return s.getCount(); }
        @Override public ItemStack split(ItemStack s, int n) { return s.split(n); }
        @Override public void grow(ItemStack s, int n) { s.grow(n); }
    };

    static int count(List<ItemStack> items, String itemId) {
        return Transfer.count(items, STACKS, itemId);
    }

    private static ItemStack first(List<ItemStack> items, String itemId) {
        for (ItemStack s : items) {
            if (!s.isEmpty() && idOf(s).equals(itemId)) {
                return s;
            }
        }
        return ItemStack.EMPTY;
    }

    /** 从她背包里不算盔甲、副手的那 36 格拿最多 count 个，交给 give（见 {@link Transfer#move}）。 */
    static int transfer(List<ItemStack> from, String itemId, int count, UnaryOperator<ItemStack> give) {
        return Transfer.move(from, STACKS, itemId, count, give);
    }

    private static Component gray(String text) {
        return Component.literal(text).withStyle(ChatFormatting.GRAY);
    }

    private static void soundTo(ServerPlayer player, Holder<SoundEvent> sound, float volume, float pitch) {
        player.connection.send(new ClientboundSoundPacket(sound, SoundSource.PLAYERS, player.getX(), player.getY(), player.getZ(), volume, pitch, player.getRandom().nextLong()));
    }

    private static void soundTo(ServerPlayer player, SoundEvent sound, float volume, float pitch) {
        soundTo(player, BuiltInRegistries.SOUND_EVENT.wrapAsHolder(sound), volume, pitch);
    }
}
