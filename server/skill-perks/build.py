"""使用现有 MC/Fabric 编译缓存构建技能扩展，并检查默认玩法数值。"""
import os
from pathlib import Path
import runpy
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / "build"
CLASSES = BUILD / "classes"
CACHE = Path(os.environ.get("XKB_CACHE_DIR", ROOT.parents[2] / ".cache" / "mc-26.1"))


def main():
    helper = runpy.run_path(str(ROOT.parent / "xiaoke-bridge" / "build.py"))
    java = helper["find_java"]()
    helper["extract_fabric_api_modules"](CACHE)
    cp = [str(CACHE / "mods" / "simpleskills-1.4.4.jar"), *helper["classpath"](CACHE)]
    CLASSES.mkdir(parents=True, exist_ok=True)
    sources = sorted(str(p) for folder in ["src", "test"] for p in (ROOT / folder).rglob("*.java"))
    args = ["--release", "25", "-encoding", "UTF-8", "-Xlint:all,-processing,-classfile,-serial", "-Werror", "-proc:none",
            "-cp", os.pathsep.join(cp), "-d", str(CLASSES), *sources]
    argfile = BUILD / "javac.args"
    helper["write_argfile"](argfile, args)
    subprocess.run([java, "-m", "jdk.compiler/com.sun.tools.javac.Main", "@" + str(argfile)], check=True)
    subprocess.run([java, "-Dstdout.encoding=UTF-8", "-cp", os.pathsep.join([str(CLASSES), *cp]),
                    "local.xiaoke.perks.PerksCheck", str(ROOT / "resources" / "skill-perks.json")], check=True)
    jar = BUILD / "skill-perks-1.1.0.jar"
    with zipfile.ZipFile(jar, "w", zipfile.ZIP_DEFLATED) as output:
        for p in sorted(CLASSES.rglob("*.class")):
            if p.name != "PerksCheck.class" and "/test/" not in p.as_posix():
                output.write(p, p.relative_to(CLASSES).as_posix())
        for p in sorted((ROOT / "resources").rglob("*")):
            if p.is_file():
                output.write(p, p.relative_to(ROOT / "resources").as_posix())
    print(f"Built: {jar}")
    import json
    with zipfile.ZipFile(BUILD / "skill-perks-probe.jar", "w", zipfile.ZIP_DEFLATED) as output:
        output.writestr("fabric.mod.json", json.dumps({"schemaVersion": 1, "id": "skill-perks-probe", "version": "1.0.0", "environment": "server", "entrypoints": {"main": ["local.xiaoke.perks.test.CombatProbe"]}, "depends": {"skill-perks": "*"}}))
        for p in sorted((CLASSES / "local/xiaoke/perks/test").rglob("*.class")):
            output.write(p, p.relative_to(CLASSES).as_posix())


if __name__ == "__main__":
    main()
