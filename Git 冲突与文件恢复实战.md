场景 A：本地修改被 git pull 阻挡

Bash
# 放弃本地变更并强制拉取
git checkout package-lock.json
git pull origin master

# 暂存变更后合并
git stash
git pull origin master
git stash pop
场景 B：检出被删文件并对齐远程最新版本

Bash
# 恢复工作区被手动误删的文件
git restore package.json

# 若工作区严重混乱，强制重置至远程基线
git fetch origin
git reset --hard origin/master