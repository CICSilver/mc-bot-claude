package local.xiaoke.bridge;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import net.minecraft.server.MinecraftServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

/** Loopback-only read API. Registration and revocation remain in game commands. */
final class RegionHttp implements AutoCloseable {
    private final HttpServer http;
    private final RegionStore store;
    private final RegionSnapshots snapshots;
    private final int port;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    RegionHttp(MinecraftServer server, RegionStore store, int port) throws IOException {
        this.store = store;
        this.port = port;
        snapshots = new RegionSnapshots(server, store);
        http = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        http.setExecutor(executor);
        http.createContext("/", this::handle);
        http.start();
    }
    private void handle(HttpExchange exchange) throws IOException {
        try {
            String host = exchange.getRequestHeaders().getFirst("Host");
            if (!("127.0.0.1:" + port).equals(host) && !("localhost:" + port).equals(host)) {
                send(exchange, 403, Map.of("error", "loopback host required")); return;
            }
            if (exchange.getRequestHeaders().containsKey("Origin")) {
                send(exchange, 403, Map.of("error", "browser origin is not allowed")); return;
            }
            String path = exchange.getRequestURI().getPath();
            Map<String, String> query = query(exchange.getRequestURI().getRawQuery());
            if (path.equals("/health") && exchange.getRequestMethod().equals("GET")) {
                send(exchange, 200, Map.of("worldId", store.worldId(), "status", "ready"));
            } else if (path.equals("/regions") && exchange.getRequestMethod().equals("GET")) {
                send(exchange, 200, Map.of("worldId", store.worldId(), "regions", store.all()));
            } else if (path.equals("/capture") && exchange.getRequestMethod().equals("POST")) {
                if (!"application/json".equals(exchange.getRequestHeaders().getFirst("Content-Type"))) {
                    send(exchange, 415, Map.of("error", "application/json required")); return;
                }
                send(exchange, 200, snapshots.capture(required(query, "region"), "true".equals(query.get("refresh"))).info());
            } else if (path.equals("/snapshot") && exchange.getRequestMethod().equals("GET")) {
                RegionSnapshots.Job job = snapshots.get(required(query, "snapshot"), required(query, "region"));
                if ("true".equals(query.get("metadata")) || !job.status.equals("ready")) send(exchange, 200, job.info());
                else {
                    exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
                    exchange.getResponseHeaders().set("Content-Encoding", "gzip");
                    exchange.getResponseHeaders().set("Cache-Control", "no-store");
                    exchange.sendResponseHeaders(200, job.gzip.length);
                    exchange.getResponseBody().write(job.gzip);
                }
            } else send(exchange, 404, Map.of("error", "read-only region endpoint not found"));
        } catch (IllegalArgumentException e) {
            send(exchange, 400, Map.of("error", e.getMessage()));
        } finally {
            exchange.close();
        }
    }
    private static Map<String, String> query(String raw) {
        Map<String, String> result = new LinkedHashMap<>();
        if (raw != null) for (String part : raw.split("&")) {
            String[] pair = part.split("=", 2);
            result.put(URLDecoder.decode(pair[0], StandardCharsets.UTF_8), pair.length == 2 ? URLDecoder.decode(pair[1], StandardCharsets.UTF_8) : "");
        }
        return result;
    }
    private static String required(Map<String, String> query, String key) {
        String value = query.get(key);
        if (value == null || value.isEmpty()) throw new IllegalArgumentException("missing " + key);
        return value;
    }
    private static void send(HttpExchange exchange, int code, Object data) throws IOException {
        byte[] body = RegionStore.JSON.toJson(data).getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(code, body.length);
        exchange.getResponseBody().write(body);
    }
    @Override public void close() {
        http.stop(0);
        executor.shutdownNow();
        snapshots.close();
    }
}
