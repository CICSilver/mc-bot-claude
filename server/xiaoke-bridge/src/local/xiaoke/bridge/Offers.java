package local.xiaoke.bridge;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 小克递给别人、还没被点“收下 / 不用了”的东西。同一个小克对同一个人只留最新的一份；一分钟没人点就过期。
 * 只是记账，不碰 Minecraft，方便单独自测。
 */
final class Offers {
    static final long TTL_MS = 60_000;

    record Offer(int id, UUID bot, String botName, UUID target, String targetName, String itemId, int count, long createdAt) {}

    private final Map<Integer, Offer> byId = new LinkedHashMap<>();
    private int nextId = 1;

    synchronized Offer create(UUID bot, String botName, UUID target, String targetName, String itemId, int count, long now) {
        byId.values().removeIf(o -> o.bot().equals(bot) && o.target().equals(target));
        Offer offer = new Offer(nextId++, bot, botName, target, targetName, itemId, count, now);
        byId.put(offer.id(), offer);
        return offer;
    }

    /** 这一份还在不在、是不是递给这个人的。 */
    synchronized Offer peek(int id, UUID target) {
        Offer o = byId.get(id);
        return o != null && o.target().equals(target) ? o : null;
    }

    synchronized void remove(int id) {
        byId.remove(id);
    }

    /** 过期的拿出来（调用的人负责告诉小克）。 */
    synchronized List<Offer> expire(long now) {
        List<Offer> out = new ArrayList<>();
        for (Iterator<Offer> it = byId.values().iterator(); it.hasNext(); ) {
            Offer o = it.next();
            if (now - o.createdAt() >= TTL_MS) {
                out.add(o);
                it.remove();
            }
        }
        return out;
    }

    synchronized int size() {
        return byId.size();
    }

    synchronized void clear() {
        byId.clear();
    }
}
