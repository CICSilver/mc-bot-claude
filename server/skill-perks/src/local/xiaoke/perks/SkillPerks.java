package local.xiaoke.perks;

import com.github.ob_yekt.simpleskills.Skills;
import com.github.ob_yekt.simpleskills.managers.XPManager;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.tags.TagKey;
import net.minecraft.world.entity.ai.attributes.AttributeInstance;
import net.minecraft.world.entity.ai.attributes.AttributeModifier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Block;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

public final class SkillPerks implements ModInitializer {
    private static final Logger LOG = LoggerFactory.getLogger("skill-perks");
    private static final Identifier SPEED = Identifier.parse("skill-perks:tool_speed");
    private static final Path CONFIG = FabricLoader.getInstance().getConfigDir().resolve("skill-perks.json");
    private static List<Rule> rules = List.of();
    private static PerksConfig settings;

    public static PerksConfig settings() { return settings; }

    private record Rule(Skills skill, TagKey<Item> tools, Set<Identifier> blocks, PerksConfig.Skill settings) {}

    private static void load() throws IOException {
        PerksConfig config = PerksConfig.load(CONFIG);
        rules = config.skills().entrySet().stream().map(entry -> {
            PerksConfig.Skill settings = entry.getValue();
            return new Rule(Skills.valueOf(entry.getKey()),
                    TagKey.create(Registries.ITEM, Identifier.parse(settings.toolTag())),
                    settings.blocks().stream().map(Identifier::parse).collect(Collectors.toSet()), settings);
        }).toList();
        settings = config;
        LOG.info("[skill-perks] 已加载 {} 项采集技能，以及近战、远程、防御和附魔加成", rules.size());
    }

    @Override
    public void onInitialize() {
        try {
            load();
        } catch (IOException e) {
            throw new IllegalStateException("读取 skill-perks.json 出错", e);
        }
        ServerTickEvents.END_SERVER_TICK.register(SkillPerks::tick);
        PlayerBlockBreakEvents.AFTER.register((world, player, pos, state, entity) -> {
            if (!(player instanceof ServerPlayer serverPlayer) || player.isCreative() || player.isSpectator()) return;
            Identifier block = BuiltInRegistries.BLOCK.getKey(state.getBlock());
            for (Rule rule : rules) {
                if (rule.blocks().contains(block) && player.getMainHandItem().is(rule.tools())
                        && player.hasCorrectToolForDrops(state)) {
                    int level = XPManager.getSkillLevel(serverPlayer.getStringUUID(), rule.skill());
                    PerksConfig.Reward reward = PerksConfig.roll(rule.settings().rewards(), level, world.getRandom().nextDouble());
                    if (reward != null) {
                        Item item = BuiltInRegistries.ITEM.getValue(Identifier.parse(reward.item()));
                        Block.popResource(world, pos, new ItemStack(item, reward.count()));
                    }
                    break;
                }
            }
        });
        CommandRegistrationCallback.EVENT.register((dispatcher, context, selection) -> dispatcher.register(
                Commands.literal("skill-perks")
                        .requires(Commands.hasPermission(Commands.LEVEL_GAMEMASTERS))
                        .then(Commands.literal("reload").executes(ctx -> reload(ctx.getSource())))));
    }

    private static void tick(MinecraftServer server) {
        if (server.getTickCount() % 5 != 0) return;
        for (ServerPlayer player : server.getPlayerList().getPlayers()) updateSpeed(player);
    }

    /** 原版客户端通过同步的挖掘速度属性显示并执行加速。 */
    private static void updateSpeed(ServerPlayer player) {
        double bonus = 0;
        if (!player.isCreative() && !player.isSpectator()) {
            for (Rule rule : rules) {
                if (player.getMainHandItem().is(rule.tools())) {
                    bonus = PerksConfig.speedBonus(rule.settings(), XPManager.getSkillLevel(player.getStringUUID(), rule.skill()));
                    break;
                }
            }
        }
        AttributeInstance attribute = player.getAttribute(Attributes.BLOCK_BREAK_SPEED);
        AttributeModifier previous = attribute.getModifier(SPEED);
        if (bonus == 0) {
            if (previous != null) attribute.removeModifier(SPEED);
        } else if (previous == null || previous.amount() != bonus) {
            attribute.addOrUpdateTransientModifier(new AttributeModifier(SPEED, bonus, AttributeModifier.Operation.ADD_MULTIPLIED_BASE));
        }
    }

    private static int reload(CommandSourceStack source) {
        try {
            load();
            for (ServerPlayer player : source.getServer().getPlayerList().getPlayers()) updateSpeed(player);
            source.sendSuccess(() -> Component.literal("技能加成已重载：采集、战斗和附魔数值立即生效。"), true);
            return 1;
        } catch (IOException | RuntimeException e) {
            LOG.error("[skill-perks] 重载配置出错", e);
            source.sendFailure(Component.literal("技能加成配置读取出错，请查看服务端日志。"));
            return 0;
        }
    }
}
