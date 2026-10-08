package local.xiaoke.bridge;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * 简单的冷却计时：同一个 key 在 windowMs 毫秒内只放行一次。
 * 只在服务端主线程里用，不加锁。
 */
final class Cooldown {
    private static final int PRUNE_SIZE = 256;

    private final long windowMs;
    private final Map<String, Long> last = new HashMap<>();

    Cooldown(long windowMs) {
        this.windowMs = windowMs;
    }

    /** 冷却已过就记下这次并返回 true；还在冷却中返回 false（不会顺延冷却时间）。 */
    boolean tryAcquire(String key, long nowMs) {
        Long previous = last.get(key);
        if (previous != null && nowMs - previous >= 0 && nowMs - previous < windowMs) {
            return false;
        }
        last.put(key, nowMs);
        if (last.size() > PRUNE_SIZE) {
            prune(nowMs);
        }
        return true;
    }

    /** 清掉早就过了冷却的记录，免得表越积越大。 */
    void prune(long nowMs) {
        Iterator<Map.Entry<String, Long>> it = last.entrySet().iterator();
        while (it.hasNext()) {
            long t = it.next().getValue();
            if (nowMs - t >= windowMs || nowMs - t < 0) {
                it.remove();
            }
        }
    }

    int size() {
        return last.size();
    }

    void clear() {
        last.clear();
    }
}
