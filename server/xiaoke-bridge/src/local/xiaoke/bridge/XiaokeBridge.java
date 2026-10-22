package local.xiaoke.bridge;

import com.mojang.brigadier.CommandDispatcher;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerEntityEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.event.player.UseBlockCallback;
import net.fabricmc.fabric.api.event.player.UseEntityCallback;
import net.fabricmc.fabric.api.event.player.UseItemCallback;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.minecraft.world.InteractionResult;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.file.Path;

/**
 * xiaoke-bridge：只装在服务端的小模组，让没装任何模组的原版客户端也能跟 AI 小克互动。
 * <ul>
 *   <li>右键小克：摸头 / 牵手 / 递东西，并用系统消息告诉小克自己的客户端（见 {@link Protocol}）。</li>
 *   <li>右键楼梯、台阶、地毯：坐下（见 {@link Seats}）。</li>
 *   <li>小克把东西递给别人：对方点聊天栏里的“收下”就直接进背包（见 {@link HandOver}）。</li>
 *   <li>/xiaoke-bridge reload：重新读配置（需要 2 级以上权限）。</li>
 * </ul>
 */
public final class XiaokeBridge implements ModInitializer {
    public static final String MOD_ID = "xiaoke-bridge";
    public static final Logger LOG = LoggerFactory.getLogger(MOD_ID);
    public static final String CONFIG_FILE_NAME = "xiaoke-bridge.json";

    private static volatile BridgeConfig config = BridgeConfig.defaults();

    public static BridgeConfig config() {
        return config;
    }

    /** 服务端目录下的 config/xiaoke-bridge.json。 */
    public static Path configFile() {
        return FabricLoader.getInstance().getConfigDir().resolve(CONFIG_FILE_NAME);
    }

    @Override
    public void onInitialize() {
        BridgeConfig.Result result = BridgeConfig.load(configFile());
        for (String w : result.warnings) {
            LOG.warn("[xiaoke-bridge] {}", w);
        }
        config = result.config;
        LOG.info("[xiaoke-bridge] 已加载：小克名单 {}，普通玩家能坐：{}", config.bots(), config.playersCanSit());

        UseEntityCallback.EVENT.register((player, level, hand, entity, hit) ->
                Regions.consumes(player) ? InteractionResult.FAIL : InteractionResult.PASS);
        UseItemCallback.EVENT.register((player, level, hand) ->
                Regions.consumes(player) ? InteractionResult.FAIL : InteractionResult.PASS);
        UseBlockCallback.EVENT.register(Regions::onUseBlock);
        UseEntityCallback.EVENT.register(BotInteractions::onUseEntity);
        UseBlockCallback.EVENT.register(Seats::onUseBlock);
        ServerTickEvents.END_SERVER_TICK.register(Seats::onServerTick);
        ServerTickEvents.END_SERVER_TICK.register(HandOver::onServerTick);
        ServerTickEvents.END_SERVER_TICK.register(Regions::tick);
        ServerLifecycleEvents.SERVER_STARTED.register(Regions::start);
        ServerPlayConnectionEvents.DISCONNECT.register((handler, server) -> Regions.disconnect(handler.player));
        ServerEntityEvents.ENTITY_LOAD.register(Seats::onEntityLoad);
        ServerEntityEvents.ENTITY_UNLOAD.register(Seats::onEntityUnload);
        ServerLifecycleEvents.SERVER_STOPPED.register(server -> {
            Regions.stop();
            Seats.clear();
            BotInteractions.clear();
            HandOver.clear();
        });
        CommandRegistrationCallback.EVENT.register((dispatcher, buildContext, selection) -> {
            registerCommand(dispatcher);
            HandOver.register(dispatcher);
            Regions.register(dispatcher);
        });
    }

    private static void registerCommand(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal(MOD_ID)
                .requires(Commands.hasPermission(Commands.LEVEL_GAMEMASTERS))
                .then(Commands.literal("reload").executes(ctx -> reload(ctx.getSource()))));
    }

    /** 重新读配置。成功时不出声；文件坏了就保留原来的设置，并告诉执行命令的人。 */
    private static int reload(CommandSourceStack source) {
        try {
            BridgeConfig.Result result = BridgeConfig.load(configFile());
            for (String w : result.warnings) {
                LOG.warn("[xiaoke-bridge] {}", w);
            }
            if (result.broken) {
                source.sendFailure(Component.literal("xiaoke-bridge：配置文件有问题，没有换，还在用原来的设置。详情看服务器日志。"));
                return 0;
            }
            config = result.config;
            LOG.info("[xiaoke-bridge] 重新加载配置：小克名单 {}，普通玩家能坐：{}", config.bots(), config.playersCanSit());
            return 1;
        } catch (VirtualMachineError e) {
            throw e;
        } catch (Throwable t) {
            LOG.error("[xiaoke-bridge] 重新加载配置出错", t);
            source.sendFailure(Component.literal("xiaoke-bridge：重新加载配置出错，详情看服务器日志。"));
            return 0;
        }
    }
}
