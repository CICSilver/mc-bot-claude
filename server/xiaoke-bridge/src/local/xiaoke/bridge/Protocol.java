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
 *
 * <p>小克把东西递给别人（她执行 /xiaoke-hand to，见 {@link HandOver}）的结果：
 * <pre>
 *   [xiaoke-bridge] hand-offered &lt;玩家名&gt; &lt;物品id&gt; &lt;数量&gt;   对方聊天栏里出现了“收下 / 不用了”
 *   [xiaoke-bridge] hand-error &lt;玩家名&gt; &lt;原因&gt;               没递出去：offline 不在线、far 离太远、none 她没有这个、self 递给自己
 *   [xiaoke-bridge] handed &lt;玩家名&gt; &lt;物品id&gt; &lt;数量&gt;         对方点了收下，这么多进了对方背包
 *   [xiaoke-bridge] hand-full &lt;玩家名&gt; &lt;物品id&gt;             对方点了收下，但背包满了，一个都没放进去（还在等）
 *   [xiaoke-bridge] hand-declined &lt;玩家名&gt; &lt;物品id&gt;         对方点了不用了
 *   [xiaoke-bridge] hand-expired &lt;玩家名&gt; &lt;物品id&gt;          一分钟没人点，收回了
 *   [xiaoke-bridge] hand-gone &lt;玩家名&gt; &lt;物品id&gt;             对方点收下时她身上已经没有这个了
 * </pre>
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

    public static String handOffered(String player, String itemId, int count) {
        return PREFIX + "hand-offered " + player + " " + itemId + " " + count;
    }

    public static String handError(String player, String reason) {
        return PREFIX + "hand-error " + player + " " + reason;
    }

    public static String handed(String player, String itemId, int count) {
        return PREFIX + "handed " + player + " " + itemId + " " + count;
    }

    /** kind：full / declined / expired / gone。 */
    public static String handEnd(String kind, String player, String itemId) {
        return PREFIX + "hand-" + kind + " " + player + " " + itemId;
    }
}
