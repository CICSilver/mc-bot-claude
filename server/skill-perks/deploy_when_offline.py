"""部署冻结发布包：普通玩家离线后备份、安装、重启和验证正式服。"""
import argparse
import json
from pathlib import Path
import shutil
import subprocess

HOST = "root@121.4.126.91"
REMOTE_RELEASE = "/opt/minecraft/backups/manual/skill-perks-combat-20261019"

REMOTE = r'''
from pathlib import Path
import subprocess,json,re,sys,tarfile,shutil,os,pwd,grp,time,hashlib,sqlite3
root=Path('/opt/minecraft/server')
release=Path('/opt/minecraft/backups/manual/skill-perks-combat-20261019')
receipt=release/'deployed.json'
def result(value):
 print('DEPLOY_RESULT '+json.dumps(value,ensure_ascii=False),flush=True)
if receipt.exists():
 result(json.loads(receipt.read_text()));sys.exit(0)
unit=subprocess.check_output(['mc-active','unit'],text=True).strip()
if unit!='minecraft':
 result({'status':'waiting','active_unit':unit});sys.exit(0)
listing=subprocess.check_output(['mc','list'],text=True)
matches=re.findall(r'There are \d+ of a max of \d+ players online:\s*([^\r\n]*)',listing)
if not matches: raise RuntimeError('读取在线玩家列表出错：'+listing)
bots={name.lower() for name in json.loads((root/'config/xiaoke-bridge.json').read_text())['bots']}
players=[part.strip().split()[-1] for part in matches[-1].split(',') if part.strip()]
humans=[name for name in players if name.lower() not in bots]
if humans or sys.argv[-1]=='check':
 result({'status':'waiting' if humans else 'ready','players':players,'human_players':humans});sys.exit(0)
jar=release/'skill-perks-1.1.0.jar'
defaults=json.loads((release/'skill-perks.json').read_text())
active_config=root/'config/skill-perks.json'
old_config=active_config.read_bytes()
config=json.loads(old_config)
config['combat']=defaults['combat'];config['enchanting']=defaults['enchanting']
old_jar=root/'mods/skill-perks-1.0.0.jar'
new_jar=root/'mods/skill-perks-1.1.0.jar'
subprocess.run(['systemctl','stop','minecraft'],check=True)
installed=False
try:
 with tarfile.open(release/'server-before.tar.gz','w:gz') as archive:
  for name in ['mods','config','world','server.properties']:archive.add(root/name,arcname=name)
 shutil.copy2(old_jar,release/'previous-skill-perks-1.0.0.jar')
 (release/'previous-skill-perks.json').write_bytes(old_config)
 shutil.copy2(jar,new_jar)
 installed=True
 active_config.write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n')
 for path in [new_jar,active_config]:os.chown(path,pwd.getpwnam('minecraft').pw_uid,grp.getgrnam('minecraft').gr_gid)
 old_jar.unlink()
 since=subprocess.check_output(['date','+%Y-%m-%d %H:%M:%S'],text=True).strip()
 subprocess.run(['systemctl','start','minecraft'],check=True)
 deadline=time.monotonic()+60
 while time.monotonic()<deadline:
  log=subprocess.check_output(['journalctl','-u','minecraft','--since',since,'-o','cat','--no-pager'],text=True)
  if 'Done (' in log:break
  time.sleep(1)
 else:raise RuntimeError('正式服启动等待超时')
 (release/'startup.log').write_text(log)
 reloaded=subprocess.check_output(['mc','skill-perks','reload'],text=True)
 (release/'reload.log').write_text(reloaded)
 db=sqlite3.connect('file:'+str(root/'world/data/simpleskills.db')+'?mode=ro',uri=True)
 integrity=db.execute('PRAGMA integrity_check').fetchone()[0];db.close()
 if integrity!='ok':raise RuntimeError('技能数据库检查：'+integrity)
 subprocess.run(['mc-switch','main'],check=True,capture_output=True)
 result_data={'status':'deployed','version':'1.1.0','jar_sha256':hashlib.sha256(new_jar.read_bytes()).hexdigest(),'skill_database_integrity':integrity,'backup':str(release/'server-before.tar.gz')}
 receipt.write_text(json.dumps(result_data,indent=2))
 result(result_data)
except Exception:
 if installed:
  subprocess.run(['systemctl','stop','minecraft'],check=True)
  if new_jar.exists():new_jar.unlink()
  shutil.copy2(release/'previous-skill-perks-1.0.0.jar',old_jar)
  active_config.write_bytes(old_config)
  for path in [old_jar,active_config]:os.chown(path,pwd.getpwnam('minecraft').pw_uid,grp.getgrnam('minecraft').gr_gid)
 subprocess.run(['systemctl','start','minecraft'],check=True)
 raise
'''


def remote(mode):
    response = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", HOST,
                               "python3 - " + mode], input=REMOTE, capture_output=True, text=True, encoding="utf-8", check=True)
    lines = [line for line in response.stdout.splitlines() if line.startswith("DEPLOY_RESULT ")]
    return json.loads(lines[-1].removeprefix("DEPLOY_RESULT "))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--release", type=Path, required=True)
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    package = args.release.resolve()
    state = remote("check")
    if args.check_only or state["status"] == "waiting":
        print(json.dumps(state, ensure_ascii=False))
        return
    if state["status"] != "deployed":
        subprocess.run(["ssh", "-o", "BatchMode=yes", HOST, "mkdir -p " + REMOTE_RELEASE], check=True)
        subprocess.run(["scp", "-q", str(package / "skill-perks-1.1.0.jar"), str(package / "skill-perks.json"),
                        HOST + ":" + REMOTE_RELEASE + "/"], check=True)
        state = remote("deploy")
    if state["status"] == "deployed":
        target = Path(r"F:\PCL-2.13.1.1\mc-bot\mc-bot-claude\server\skill-perks")
        backup = package / "production-source-before.zip"
        if not backup.exists():
            shutil.make_archive(str(backup.with_suffix("")), "zip", target)
        shutil.copytree(package / "source", target, dirs_exist_ok=True)
        shutil.copy2(package / "skill-perks-1.1.0.jar", target / "build/skill-perks-1.1.0.jar")
        (package / "deployed.json").write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(state, ensure_ascii=False))


if __name__ == "__main__":
    main()
