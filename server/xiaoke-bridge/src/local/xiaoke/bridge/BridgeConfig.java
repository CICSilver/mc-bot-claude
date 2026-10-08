package local.xiaoke.bridge;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 配置文件 config/xiaoke-bridge.json：
 * <pre>
 * { "bots": ["clawd", "clawd_test", "Moby"], "playersCanSit": true }
 * </pre>
 * bots：AI 小克们的登录名（不分大小写）。playersCanSit：普通玩家能不能坐（小克自己总是能坐）。
 *
 * <p>这个类只用 Gson 和 java.nio，不碰 Minecraft，方便单独自测。
 */
public final class BridgeConfig {
    public static final List<String> DEFAULT_BOTS = List.of("clawd", "clawd_test", "Moby");
    public static final boolean DEFAULT_PLAYERS_CAN_SIT = true;

    private final List<String> bots;
    private final Set<String> botsLower;
    private final boolean playersCanSit;

    public BridgeConfig(List<String> bots, boolean playersCanSit) {
        List<String> clean = new ArrayList<>();
        Set<String> lower = new LinkedHashSet<>();
        for (String name : bots) {
            if (name == null) {
                continue;
            }
            String trimmed = name.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            if (lower.add(trimmed.toLowerCase(Locale.ROOT))) {
                clean.add(trimmed);
            }
        }
        this.bots = Collections.unmodifiableList(clean);
        this.botsLower = Collections.unmodifiableSet(lower);
        this.playersCanSit = playersCanSit;
    }

    public static BridgeConfig defaults() {
        return new BridgeConfig(DEFAULT_BOTS, DEFAULT_PLAYERS_CAN_SIT);
    }

    public List<String> bots() {
        return bots;
    }

    public boolean playersCanSit() {
        return playersCanSit;
    }

    /** 这个登录名是不是小克（不分大小写）。 */
    public boolean isBot(String name) {
        return name != null && botsLower.contains(name.trim().toLowerCase(Locale.ROOT));
    }

    /** 读配置的结果：配置本身 + 一路上的警告；broken=true 表示整个文件没法用，config 是默认值。 */
    public static final class Result {
        public final BridgeConfig config;
        public final List<String> warnings;
        public final boolean broken;

        Result(BridgeConfig config, List<String> warnings, boolean broken) {
            this.config = config;
            this.warnings = Collections.unmodifiableList(new ArrayList<>(warnings));
            this.broken = broken;
        }
    }

    /** 默认配置文件的内容。 */
    public static String defaultJson() {
        StringBuilder sb = new StringBuilder();
        sb.append("{\n  \"bots\": [");
        for (int i = 0; i < DEFAULT_BOTS.size(); i++) {
            if (i > 0) {
                sb.append(", ");
            }
            sb.append('"').append(DEFAULT_BOTS.get(i)).append('"');
        }
        sb.append("],\n  \"playersCanSit\": ").append(DEFAULT_PLAYERS_CAN_SIT).append("\n}\n");
        return sb.toString();
    }

    /**
     * 解析配置文本。整个文件坏掉（不是 JSON、不是对象）时返回默认值并标记 broken；
     * 某一项缺了或类型不对时，那一项用默认值，并记一条警告。
     */
    public static Result parse(String text) {
        List<String> warnings = new ArrayList<>();
        JsonElement root;
        try {
            root = JsonParser.parseString(text == null ? "" : text);
        } catch (RuntimeException e) {
            warnings.add("配置文件不是合法的 JSON，先用默认设置：" + e.getMessage());
            return new Result(defaults(), warnings, true);
        }
        if (root == null || !root.isJsonObject()) {
            warnings.add("配置文件最外层应该是一个 { } 对象，先用默认设置");
            return new Result(defaults(), warnings, true);
        }
        JsonObject obj = root.getAsJsonObject();

        List<String> bots = new ArrayList<>(DEFAULT_BOTS);
        JsonElement botsEl = obj.get("bots");
        if (botsEl == null || botsEl.isJsonNull()) {
            warnings.add("配置里没有 bots，用默认名单 " + DEFAULT_BOTS);
        } else if (!botsEl.isJsonArray()) {
            warnings.add("bots 应该是字符串数组，用默认名单 " + DEFAULT_BOTS);
        } else {
            bots = new ArrayList<>();
            JsonArray arr = botsEl.getAsJsonArray();
            for (JsonElement e : arr) {
                if (e != null && e.isJsonPrimitive() && e.getAsJsonPrimitive().isString()) {
                    String name = e.getAsString().trim();
                    if (name.isEmpty()) {
                        warnings.add("bots 里有空名字，跳过");
                    } else {
                        bots.add(name);
                    }
                } else {
                    warnings.add("bots 里有一项不是字符串，跳过：" + e);
                }
            }
        }

        boolean playersCanSit = DEFAULT_PLAYERS_CAN_SIT;
        JsonElement sitEl = obj.get("playersCanSit");
        if (sitEl == null || sitEl.isJsonNull()) {
            warnings.add("配置里没有 playersCanSit，用默认值 " + DEFAULT_PLAYERS_CAN_SIT);
        } else if (sitEl.isJsonPrimitive() && sitEl.getAsJsonPrimitive().isBoolean()) {
            playersCanSit = sitEl.getAsBoolean();
        } else {
            warnings.add("playersCanSit 应该是 true 或 false，用默认值 " + DEFAULT_PLAYERS_CAN_SIT);
        }

        return new Result(new BridgeConfig(bots, playersCanSit), warnings, false);
    }

    /**
     * 读配置文件。文件不存在就按默认值新建一个；读不了或坏掉就用默认值（不会去覆盖坏文件，留给人改）。
     */
    public static Result load(Path file) {
        if (!Files.exists(file)) {
            List<String> warnings = new ArrayList<>();
            try {
                Path parent = file.getParent();
                if (parent != null) {
                    Files.createDirectories(parent);
                }
                Files.writeString(file, defaultJson(), StandardCharsets.UTF_8);
            } catch (IOException | RuntimeException e) {
                warnings.add("配置文件不存在，想新建一个也失败了（" + e + "），先用默认设置");
            }
            return new Result(defaults(), warnings, false);
        }
        String text;
        try {
            text = Files.readString(file, StandardCharsets.UTF_8);
        } catch (IOException | RuntimeException e) {
            List<String> warnings = new ArrayList<>();
            warnings.add("配置文件读不出来（" + e + "），先用默认设置");
            return new Result(defaults(), warnings, true);
        }
        // 去掉可能有的 UTF-8 BOM（Windows 记事本存的文件会带）
        if (!text.isEmpty() && text.charAt(0) == '﻿') {
            text = text.substring(1);
        }
        return parse(text);
    }

    @Override
    public String toString() {
        return "BridgeConfig{bots=" + bots + ", playersCanSit=" + playersCanSit + "}";
    }
}
