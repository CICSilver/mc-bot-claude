package local.xiaoke;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.google.gson.Gson;
import com.mojang.authlib.GameProfile;
import com.tom.cpm.shared.MinecraftClientAccess;
import com.tom.cpm.shared.config.ConfigKeys;
import com.tom.cpm.shared.config.ModConfig;
import com.tom.cpm.shared.definition.ModelDefinitionLoader;
import com.tom.cpm.shared.io.ModelFile;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;

/** Cosmetic binding only. Never sends packets, chat, commands or account changes. */
public final class XiaokeAvatarClient implements ClientModInitializer {
    private static final Logger LOG = LoggerFactory.getLogger("xiaoke-avatar");
    private ModelFile model;
    private TargetRule target;
    private boolean enabled;
    private int ticks;

    private static final class Settings {
        boolean enabled = true;
        String server = "mc.lemalin.icu";
        String targetName = "clawd";
        String targetUuid = "bc9e625b-fdc0-370b-be2e-082f5a6731f6";
    }

    @Override
    public void onInitializeClient() {
        try {
            Path config = FabricLoader.getInstance().getConfigDir().resolve("xiaoke-avatar.json");
            Settings settings = Files.exists(config)
                ? new Gson().fromJson(Files.readString(config), Settings.class) : new Settings();
            if (settings == null) throw new IllegalArgumentException("Empty Xiaoke configuration");
            if (!settings.enabled) return;
            target = new TargetRule(settings.server, settings.targetName, UUID.fromString(settings.targetUuid));
            Path override = FabricLoader.getInstance().getConfigDir().resolve("xiaoke-avatar/xiaoke-maid.cpmmodel");
            try (InputStream input = Files.exists(override) ? Files.newInputStream(override)
                    : getClass().getResourceAsStream("/assets/xiaoke_avatar/xiaoke-maid.cpmmodel")) {
                if (input == null) throw new IllegalStateException("Missing bundled Xiaoke model");
                model = ModelFile.load("xiaoke-maid.cpmmodel", input);
            }
            enabled = true;
            ClientTickEvents.END_CLIENT_TICK.register(this::tick);
            LOG.info("Xiaoke avatar ready: {} on {}. Cosmetic client binding only.", target.name(), target.server());
        } catch (Exception ex) {
            LOG.error("Xiaoke avatar disabled; ordinary player rendering remains available.", ex);
        }
    }

    private void tick(Minecraft client) {
        if (!enabled || ++ticks % 20 != 0 || client.getConnection() == null || client.getCurrentServer() == null) return;
        var info = client.getConnection().getPlayerInfo(target.uuid());
        if (info == null) return;
        GameProfile profile = info.getProfile();
        if (!target.matches(client.getCurrentServer().ip, profile.name(), profile.id())) return;
        try {
            MinecraftClientAccess access = MinecraftClientAccess.get();
            if (access == null) return;
            ModelDefinitionLoader<GameProfile> loader = access.getDefinitionLoader();
            // Trust limits apply to this exact local target, never to arbitrary players.
            var safety = ModConfig.getCommonConfig().getEntry(ConfigKeys.PLAYER_SETTINGS).getEntry(target.uuid().toString());
            safety.setInt("maxTex", Math.max(safety.getInt("maxTex", 256), 2048));
            safety.setInt("maxCubeCount", Math.max(safety.getInt("maxCubeCount", 256), 1024));
            safety.setInt("maxLink", Math.max(safety.getInt("maxLink", 100), 4096));
            model.registerLocalCache(loader);
            if (!Arrays.equals(loader.getModel(profile), model.getDataBlock())) {
                loader.setModel(profile, model.getDataBlock(), true);
                LOG.info("Applied local Xiaoke model to {} ({})", profile.name(), profile.id());
            }
        } catch (Exception ex) {
            enabled = false;
            LOG.error("Xiaoke rendering stopped after an error; restart the client after correcting the model.", ex);
        }
    }
}
