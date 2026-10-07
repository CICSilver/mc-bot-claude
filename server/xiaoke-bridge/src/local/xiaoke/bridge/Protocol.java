package local.xiaoke.bridge;

/**
 * 发给小克自己客户端的系统消息格式。小克那边按这些固定的英文字符串解析，别随便改。
 *
 * <pre>
 *   [xiaoke-bridge] pet &lt;玩家名&gt;
 *   [xiaoke-bridge] hold &lt;玩家名&gt;
 *   [xiaoke-bridge] give &lt;玩家名&gt; &lt;物品id&gt; &lt;数量&gt;
 *   [xiaoke-bridge] give-full &lt;玩家名&gt; &lt;物品id&gt;
 * </pre>
 * 物品 id 不带命名空间（比如 cooked_cod），数量是真正放进她背包里的个数。
 */
public final class Protocol {
    private Protocol() {}

    public static final String PREFIX = "[xiaoke-bridge] ";

    public static String pet(String player) {
        return PREFIX + "pet " + player;
    }

    public static String hold(String player) {
        return PREFIX + "hold " + player;
    }

    public static String give(String player, String itemId, int count) {
        return PREFIX + "give " + player + " " + itemId + " " + count;
    }

    public static String giveFull(String player, String itemId) {
        return PREFIX + "give-full " + player + " " + itemId;
    }
}
