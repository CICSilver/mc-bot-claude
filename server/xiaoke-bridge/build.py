#!/usr/bin/env python3
"""
xiaoke-bridge 的构建脚本：编译 → 自测 → 打包成 build/xiaoke-bridge-1.0.0.jar。

用法（在任意目录都行）：
    python build.py               # 缓存不全会自动通过 ssh 去服务器拷，然后编译、自测、打包
    python build.py --skip-tests  # 不跑自测
    python build.py --offline     # 不去服务器拷东西，缓存不全就直接报错
    python build.py --fetch-only  # 只把依赖拷到缓存目录

编译依赖缓存目录（不进 git）：
    默认从脚本所在目录一路往上找已经存在的 .cache/mc-26.1；找不到就用
    <仓库所在目录>/.cache/mc-26.1（比如 D:\\workspace\\mc-bot\\.cache\\mc-26.1）。
    可以用环境变量 XKB_CACHE_DIR 指定别的位置。

缓存目录里放的东西（和服务器 /opt/minecraft/server 下的相对路径一样）：
    versions/26.1/server-26.1.jar     游戏本体（26.1 没混淆，类名就是 Mojang 名）
    mods/fabric-api-*.jar             Fabric API 总包（里面 META-INF/jars/ 下是各个模块）
    libraries/**.jar                  fabric-loader、brigadier、gson、slf4j 等（不要 netty 的 native 包）
    fabric-api-modules/*.jar          脚本自己从 Fabric API 总包里解出来的各个模块
缓存缺东西时，脚本会只读地执行：
    ssh -o BatchMode=yes root@121.4.126.91 "cd /opt/minecraft/server && tar cf - ..."
把上面这些文件打包传回来解开。只读，不会改服务器上的任何东西。
主机和目录可以用环境变量 XKB_SSH_HOST、XKB_SERVER_DIR 改。

Java：需要带 jdk.compiler 模块的 JDK 25。按顺序找：环境变量 XKB_JAVA（java 可执行文件路径）、
JAVA_HOME、Minecraft 启动器自带的 java-runtime-epsilon（它是完整 JDK 25）、PATH 里的 java。
编译用 `java -m jdk.compiler/com.sun.tools.javac.Main`，不需要单独的 javac。
"""

import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path

VERSION = "1.0.0"
MOD_ID = "xiaoke-bridge"
MAIN_CLASS = "local.xiaoke.bridge.XiaokeBridge"

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
TEST_SRC = ROOT / "test"
RESOURCES = ROOT / "resources"
BUILD = ROOT / "build"
CLASSES = BUILD / "classes"
TEST_CLASSES = BUILD / "test-classes"
JAR = BUILD / f"{MOD_ID}-{VERSION}.jar"

SSH_HOST = os.environ.get("XKB_SSH_HOST", "root@121.4.126.91")
SERVER_DIR = os.environ.get("XKB_SERVER_DIR", "/opt/minecraft/server")
GAME_JAR_REL = "versions/26.1/server-26.1.jar"

# 打进 jar 的文件统一用这个时间，构建结果可以重复
ZIP_TIME = (2026, 1, 1, 0, 0, 0)


def log(msg):
    print(f"[build] {msg}", flush=True)


def die(msg):
    print(f"[build] 出错: {msg}", file=sys.stderr, flush=True)
    sys.exit(1)


# ---------------------------------------------------------------- 缓存目录

def find_cache_dir():
    env = os.environ.get("XKB_CACHE_DIR")
    if env:
        return Path(env).resolve()
    for parent in [ROOT, *ROOT.parents]:
        candidate = parent / ".cache" / "mc-26.1"
        if candidate.is_dir():
            return candidate
    # server/xiaoke-bridge -> 仓库根 -> 仓库所在目录
    return ROOT.parents[2] / ".cache" / "mc-26.1"


def cache_missing(cache):
    missing = []
    if not (cache / GAME_JAR_REL).is_file():
        missing.append(GAME_JAR_REL)
    if not glob.glob(str(cache / "mods" / "fabric-api-*.jar")):
        missing.append("mods/fabric-api-*.jar")
    if not glob.glob(str(cache / "libraries" / "net" / "fabricmc" / "fabric-loader" / "*" / "fabric-loader-*.jar")):
        missing.append("libraries/net/fabricmc/fabric-loader/...")
    if not glob.glob(str(cache / "libraries" / "com" / "google" / "code" / "gson" / "gson" / "*" / "*.jar")):
        missing.append("libraries/com/google/code/gson/...")
    return missing


def fetch_from_server(cache):
    """通过 ssh 只读地把需要的 jar 打包拷回来。"""
    cache.mkdir(parents=True, exist_ok=True)
    remote = (
        f"cd {SERVER_DIR} && tar cf - --exclude='*native*' "
        f"{GAME_JAR_REL} $(ls mods/fabric-api-*.jar) libraries"
    )
    cmd = ["ssh", "-o", "BatchMode=yes", SSH_HOST, remote]
    log(f"从服务器拷依赖到 {cache}（只读）：{' '.join(cmd[:4])} \"{remote}\"")
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    try:
        with tarfile.open(fileobj=proc.stdout, mode="r|") as tf:
            if hasattr(tarfile, "data_filter"):
                tf.extractall(cache, filter="data")
            else:
                tf.extractall(cache)
    finally:
        proc.stdout.close()
        code = proc.wait()
    if code != 0:
        die(f"ssh/tar 退出码 {code}")


def extract_fabric_api_modules(cache):
    """把 Fabric API 总包里的各个模块解到 fabric-api-modules/。"""
    bundles = sorted(glob.glob(str(cache / "mods" / "fabric-api-*.jar")))
    if not bundles:
        die("缓存里没有 mods/fabric-api-*.jar")
    bundle = Path(bundles[-1])
    out = cache / "fabric-api-modules"
    stamp = out / ".from"
    if stamp.is_file() and stamp.read_text(encoding="utf-8").strip() == bundle.name and any(out.glob("*.jar")):
        return out
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    with zipfile.ZipFile(bundle) as z:
        for name in z.namelist():
            if name.startswith("META-INF/jars/") and name.endswith(".jar"):
                (out / Path(name).name).write_bytes(z.read(name))
    stamp.write_text(bundle.name, encoding="utf-8")
    log(f"从 {bundle.name} 解出 {len(list(out.glob('*.jar')))} 个 Fabric API 模块")
    return out


def classpath(cache):
    jars = [cache / GAME_JAR_REL]
    jars += sorted(Path(p) for p in glob.glob(str(cache / "libraries" / "**" / "*.jar"), recursive=True))
    jars += sorted((cache / "fabric-api-modules").glob("*.jar"))
    return [str(j) for j in jars]


# ---------------------------------------------------------------- Java

def has_compiler(java):
    try:
        out = subprocess.run([java, "--list-modules"], capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return False
    return out.returncode == 0 and "jdk.compiler@" in out.stdout


def find_java():
    candidates = []
    if os.environ.get("XKB_JAVA"):
        candidates.append(os.environ["XKB_JAVA"])
    exe = "java.exe" if os.name == "nt" else "java"
    if os.environ.get("JAVA_HOME"):
        candidates.append(str(Path(os.environ["JAVA_HOME"]) / "bin" / exe))
    appdata = os.environ.get("APPDATA")
    if appdata:
        candidates.append(str(Path(appdata) / ".minecraft" / "runtime" / "java-runtime-epsilon" / "bin" / exe))
    on_path = shutil.which("java")
    if on_path:
        candidates.append(on_path)
    for c in candidates:
        if Path(c).is_file() and has_compiler(c):
            return c
    die("找不到带 jdk.compiler 的 Java 25，请设置环境变量 XKB_JAVA 指向 java 可执行文件")


def write_argfile(path, args):
    # javac / java 的 @argfile：每个参数一行，带空格或反斜杠的加引号
    lines = []
    for a in args:
        a = a.replace("\\", "/")
        if any(ch in a for ch in " \t\"'#"):
            a = '"' + a.replace('"', '\\"') + '"'
        lines.append(a)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def javac(java, cp, src_dir, out_dir, extra_cp=()):
    sources = sorted(str(p) for p in src_dir.rglob("*.java"))
    if not sources:
        die(f"{src_dir} 下没有 .java 文件")
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    args = [
        "--release", "25",
        "-encoding", "UTF-8",
        "-Xlint:all,-processing,-classfile,-serial",
        "-Werror",
        "-cp", os.pathsep.join([*extra_cp, *cp]),
        "-d", str(out_dir),
        *sources,
    ]
    argfile = BUILD / f"javac-{out_dir.name}.args"
    write_argfile(argfile, args)
    log(f"编译 {len(sources)} 个文件 → {out_dir.relative_to(ROOT)}")
    r = subprocess.run([java, "-m", "jdk.compiler/com.sun.tools.javac.Main", f"@{argfile}"])
    if r.returncode != 0:
        die("javac 编译失败")


def run_java(java, cp, main):
    argfile = BUILD / f"run-{main.rsplit('.', 1)[-1]}.args"
    write_argfile(argfile, ["-cp", os.pathsep.join(cp), main])
    log(f"运行 {main}")
    opts = [
        "-Dfile.encoding=UTF-8",
        # joml 会调用 sun.misc.Unsafe，JDK 25 会打一堆警告，这里关掉
        "--sun-misc-unsafe-memory-access=allow",
    ]
    if not sys.stdout.isatty():
        # 输出被管道接走时统一用 UTF-8（控制台下让 Java 自己按控制台编码输出）
        opts.append("-Dstdout.encoding=UTF-8")
    r = subprocess.run([java, *opts, f"@{argfile}"], cwd=BUILD)
    if r.returncode != 0:
        die(f"{main} 没通过")


# ---------------------------------------------------------------- 打包

def check_mod_json():
    path = RESOURCES / "fabric.mod.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        die(f"fabric.mod.json 读不了: {e}")
    if data.get("schemaVersion") != 1:
        die("fabric.mod.json: schemaVersion 应该是 1")
    if data.get("id") != MOD_ID or not re.fullmatch(r"[a-z][a-z0-9_-]{1,63}", data.get("id", "")):
        die("fabric.mod.json: id 不对")
    if data.get("version") != VERSION:
        die(f"fabric.mod.json: version 应该是 {VERSION}")
    if data.get("environment") != "server":
        die("fabric.mod.json: environment 应该是 server")
    mains = data.get("entrypoints", {}).get("main", [])
    if mains != [MAIN_CLASS]:
        die(f"fabric.mod.json: main 入口应该是 {MAIN_CLASS}")
    deps = data.get("depends", {})
    for key in ("fabricloader", "minecraft", "fabric-api", "java"):
        if key not in deps:
            die(f"fabric.mod.json: depends 里缺 {key}")
    entry_class = CLASSES / (MAIN_CLASS.replace(".", "/") + ".class")
    if not entry_class.is_file():
        die(f"入口类没编译出来: {entry_class}")
    return path


def zip_write(z, arcname, data):
    info = zipfile.ZipInfo(arcname, date_time=ZIP_TIME)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    z.writestr(info, data)


def package(mod_json):
    if JAR.exists():
        JAR.unlink()
    manifest = (
        "Manifest-Version: 1.0\r\n"
        f"Implementation-Title: {MOD_ID}\r\n"
        f"Implementation-Version: {VERSION}\r\n"
        "\r\n"
    )
    classes = sorted(p for p in CLASSES.rglob("*.class"))
    with zipfile.ZipFile(JAR, "w") as z:
        zip_write(z, "META-INF/MANIFEST.MF", manifest.encode("utf-8"))
        zip_write(z, "fabric.mod.json", mod_json.read_bytes())
        for p in classes:
            zip_write(z, p.relative_to(CLASSES).as_posix(), p.read_bytes())
    # 打完包再自查一遍
    with zipfile.ZipFile(JAR) as z:
        bad = z.testzip()
        if bad:
            die(f"jar 里 {bad} 损坏")
        json.loads(z.read("fabric.mod.json").decode("utf-8"))
        names = z.namelist()
    log(f"打包完成: {JAR}（{len(names)} 个条目，{JAR.stat().st_size} 字节）")


# ---------------------------------------------------------------- main

def main():
    if not sys.stdout.isatty() and hasattr(sys.stdout, "reconfigure"):
        # 输出被管道接走时（比如 Git Bash、CI）用 UTF-8，免得中文乱码
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="构建 xiaoke-bridge")
    ap.add_argument("--skip-tests", action="store_true", help="不跑自测")
    ap.add_argument("--offline", action="store_true", help="缓存不全时不去服务器拷，直接报错")
    ap.add_argument("--fetch-only", action="store_true", help="只准备缓存目录")
    args = ap.parse_args()

    cache = find_cache_dir()
    log(f"依赖缓存目录: {cache}")
    missing = cache_missing(cache)
    if missing:
        if args.offline:
            die(f"缓存不全（缺 {', '.join(missing)}），又指定了 --offline")
        log(f"缓存缺: {', '.join(missing)}")
        fetch_from_server(cache)
        missing = cache_missing(cache)
        if missing:
            die(f"从服务器拷完还是缺: {', '.join(missing)}")
    extract_fabric_api_modules(cache)
    if args.fetch_only:
        log("依赖已就绪")
        return

    java = find_java()
    log(f"Java: {java}")
    BUILD.mkdir(exist_ok=True)
    cp = classpath(cache)

    javac(java, cp, SRC, CLASSES)
    mod_json = check_mod_json()

    if not args.skip_tests:
        javac(java, cp, TEST_SRC, TEST_CLASSES, extra_cp=[str(CLASSES)])
        test_cp = [str(CLASSES), str(TEST_CLASSES), *cp]
        run_java(java, test_cp, "local.xiaoke.bridge.SelfCheck")
        run_java(java, test_cp, "local.xiaoke.bridge.McCheck")
        run_java(java, test_cp, "local.xiaoke.bridge.RegionCheck")

    package(mod_json)


if __name__ == "__main__":
    main()
