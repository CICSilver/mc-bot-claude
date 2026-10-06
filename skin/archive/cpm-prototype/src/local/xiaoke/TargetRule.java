package local.xiaoke;

import java.util.Locale;
import java.util.UUID;

public record TargetRule(String server, String name, UUID uuid) {
    public TargetRule {
        if (server == null || server.isBlank() || name == null || name.isBlank() || uuid == null) {
            throw new IllegalArgumentException("Server, player name and UUID are required");
        }
        server = normalize(server);
    }

    private static String normalize(String server) {
        String value = server.trim().toLowerCase(Locale.ROOT);
        return value.endsWith(":25565") ? value.substring(0, value.length() - 6) : value;
    }

    public boolean matches(String address, String playerName, UUID playerUuid) {
        return address != null && server.equals(normalize(address))
            && name.equals(playerName) && uuid.equals(playerUuid);
    }
}
