import java.util.UUID;
import local.xiaoke.TargetRule;

public final class TargetRuleTest {
    public static void main(String[] args) {
        UUID uuid = UUID.fromString("bc9e625b-fdc0-370b-be2e-082f5a6731f6");
        TargetRule rule = new TargetRule("mc.lemalin.icu", "clawd", uuid);
        check(rule.matches("mc.lemalin.icu", "clawd", uuid));
        check(rule.matches("MC.LEMALIN.ICU:25565", "clawd", uuid));
        check(!rule.matches("mc.lemalin.icu.evil.test", "clawd", uuid));
        check(!rule.matches("mc.lemalin.icu:25566", "clawd", uuid));
        check(!rule.matches("other.test", "clawd", uuid));
        check(!rule.matches("mc.lemalin.icu", "CICSilver", uuid));
        check(!rule.matches("mc.lemalin.icu", "clawd", UUID.randomUUID()));
        check(!rule.matches(null, "clawd", uuid));
        check(!rule.matches("mc.lemalin.icu", null, uuid));
        check(!rule.matches("mc.lemalin.icu", "clawd", null));
        boolean rejected = false;
        try { new TargetRule("", "clawd", uuid); } catch (IllegalArgumentException expected) { rejected = true; }
        check(rejected);
        System.out.println("TargetRule: 11 checks passed.");
    }
    private static void check(boolean result) {
        if (!result) throw new AssertionError("Target matching regression");
    }
}
