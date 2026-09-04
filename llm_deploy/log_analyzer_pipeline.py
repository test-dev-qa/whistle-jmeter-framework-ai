#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import re
import time
import json
import hashlib
import logging
from typing import Optional, Dict, Any
import requests
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

# ================= 1. 基础配置 =================
LOG_FILE_PATH = "/var/log/app/service_error.log"  # 待监听的日志路径
POLL_INTERVAL = 1.0                              # 轮询间隔 (秒)
DEBOUNCE_WINDOW_SEC = 300                        # 相同故障防抖窗口 (秒)

OLLAMA_API_URL = "http://localhost:11434/api/chat"
MODEL_NAME = "qwen2.5-log-analyzer"

FEISHU_APP_ID = "cli_your_feishu_app_id"
FEISHU_APP_SECRET = "your_feishu_app_secret"
FEISHU_APP_TOKEN = "bascnyour_app_token"         # 多维表格链接中的 app_token
FEISHU_TABLE_ID = "tblyour_table_id"             # 数据表 table_id

# 错误初筛正则
ERROR_PATTERN = re.compile(r'(ERROR|FATAL|CRITICAL|Exception|Traceback|errno)', re.IGNORECASE)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)

# ================= 2. 内存防抖缓存 =================
class DebounceCache:
    """滑动窗口缓存，剔除瞬态变量后根据日志指纹抑制高频重复报错"""
    def __init__(self, ttl: int = 300):
        self.ttl = ttl
        self._cache: Dict[str, float] = {}

    def is_duplicate(self, text: str) -> bool:
        now = time.time()
        # 清除过期项
        self._cache = {k: exp for k, exp in self._cache.items() if exp > now}

        # 归一化提取特征：移除时间戳、十六进制内存地址、纯数字
        normalized = re.sub(r'\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?', '', text)
        normalized = re.sub(r'0x[0-9a-fA-F]+', '', normalized)
        normalized = re.sub(r'\b\d+\b', '', normalized)
        sig = hashlib.md5(normalized.strip().encode('utf-8')).hexdigest()

        if sig in self._cache:
            return True
        self._cache[sig] = now + self.ttl
        return False

# ================= 3. 飞书 OpenAPI 客户端 =================
class FeishuClient:
    def __init__(self, app_id: str, app_secret: str, app_token: str, table_id: str):
        self.app_id = app_id
        self.app_secret = app_secret
        self.app_token = app_token
        self.table_id = table_id
        self.token = ""
        self.token_expire_time = 0

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=8), reraise=True)
    def _refresh_token(self):
        url = "[https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal](https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal)"
        resp = requests.post(url, json={"app_id": self.app_id, "app_secret": self.app_secret}, timeout=8)
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"获取飞书 token 失败: {data.get('msg')}")
        self.token = data["tenant_access_token"]
        self.token_expire_time = time.time() + data.get("expire", 7100) - 200
        logging.info("飞书 Tenant Access Token 刷新成功")

    def get_token(self) -> str:
        if not self.token or time.time() >= self.token_expire_time:
            self._refresh_token()
        return self.token

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((requests.RequestException, RuntimeError)),
        reraise=True
    )
    def insert_record(self, record_fields: Dict[str, Any]):
        token = self.get_token()
        url = f"[https://open.feishu.cn/open-apis/bitable/v1/apps/](https://open.feishu.cn/open-apis/bitable/v1/apps/){self.app_token}/tables/{self.table_id}/records"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8"
        }
        resp = requests.post(url, headers=headers, json={"fields": record_fields}, timeout=10)

        if resp.status_code == 400 and resp.json().get("code") == 99991663:
            self._refresh_token()
            raise RuntimeError("飞书 Token 判定失效，准备二次重试")

        resp.raise_for_status()
        res_json = resp.json()
        if res_json.get("code") != 0:
            raise RuntimeError(f"多维表格写入失败: {res_json}")
        logging.info("成功同步记录至多维表格, Record ID: %s", res_json.get("data", {}).get("record", {}).get("record_id"))

# ================= 4. 本地 Qwen-7B 分析 =================
@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=8), reraise=True)
def analyze_with_qwen(log_entry: str) -> Optional[Dict[str, Any]]:
    system_prompt = (
        "你是一名资深后端与SRE架构专家。请针对提供的服务异常或堆栈日志进行深度剖析。\n"
        "判断是否为系统 Bug 或代码缺陷，并严格返回标准 JSON 结构，包含以下字段：\n"
        "- is_bug (boolean): 是否属于程序代码Bug、逻辑漏洞或未捕获严重异常\n"
        "- severity (string): 评定等级，仅限 'P0', 'P1', 'P2', 'P3'\n"
        "- service_name (string): 推测所属微服务模块名，未知填 'default'\n"
        "- error_title (string): 单句故障核心摘要\n"
        "- root_cause (string): 代码或环境层面的根因定位推断\n"
        "- suggested_fix (string): 明确可执行的修复方案或排查指引\n"
    )

    payload = {
        "model": MODEL_NAME,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"日志片段：\n{log_entry}"}
        ],
        "format": "json",
        "stream": False,
        "options": {
            "temperature": 0.1
        }
    }

    resp = requests.post(OLLAMA_API_URL, json=payload, timeout=60)
    resp.raise_for_status()

    raw_content = resp.json().get("message", {}).get("content", "")
    try:
        return json.loads(raw_content)
    except json.JSONDecodeError:
        logging.error("模型响应无法被解析为 JSON: %s", raw_content)
        return None

# ================= 5. 日志监听与主调度 =================
def run_pipeline(file_path: str):
    if not os.path.exists(file_path):
        os.makedirs(os.path.dirname(os.path.abspath(file_path)), exist_ok=True)
        open(file_path, 'a').close()

    logging.info("启动日志监听守护进程: %s", file_path)
    file = open(file_path, "r", encoding="utf-8", errors="ignore")
    file.seek(0, os.SEEK_END)
    last_inode = os.fstat(file.fileno()).st_ino

    feishu = FeishuClient(FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_APP_TOKEN, FEISHU_TABLE_ID)
    debouncer = DebounceCache(ttl=DEBOUNCE_WINDOW_SEC)

    buffer_lines = []
    last_read_time = time.time()

    while True:
        try:
            # 检测日志轮转 (logrotate)
            if os.path.exists(file_path):
                current_inode = os.stat(file_path).st_ino
                if current_inode != last_inode:
                    logging.info("检测到日志轮转发生，重定向读取新文件句柄")
                    file.close()
                    file = open(file_path, "r", encoding="utf-8", errors="ignore")
                    last_inode = current_inode

            line = file.readline()
            if line:
                buffer_lines.append(line)
                last_read_time = time.time()
                if len(buffer_lines) < 25:
                    continue
            else:
                if not buffer_lines:
                    time.sleep(POLL_INTERVAL)
                    continue
                if time.time() - last_read_time < 0.5:
                    time.sleep(0.1)
                    continue

            # 聚合多行异常堆栈
            log_chunk = "".join(buffer_lines).strip()
            buffer_lines = []

            # 正则预筛
            if not ERROR_PATTERN.search(log_chunk):
                continue

            # 防抖特征过滤
            if debouncer.is_duplicate(log_chunk):
                logging.info("检测到相似错误频发，触发滑动窗口抑制")
                continue

            logging.info("开始执行 Qwen-7B 语义分析...")
            # 截取前 3000 字符，保留核心堆栈并兼顾推理延迟
            analysis = analyze_with_qwen(log_chunk[:3000])
            if not analysis:
                continue

            logging.info("分析判定完成: [%s] 是否Bug: %s | 等级: %s",
                         analysis.get("error_title"), analysis.get("is_bug"), analysis.get("severity"))

            # 仅上报确认为 Bug 或严重级别在 P0/P1/P2 的事件
            if analysis.get("is_bug") or analysis.get("severity") in ["P0", "P1", "P2"]:
                record_data = {
                    "错误摘要": analysis.get("error_title", "未知故障"),
                    "服务模块": analysis.get("service_name", "default"),
                    "故障等级": analysis.get("severity", "P2"),
                    "是否 BUG": "是" if analysis.get("is_bug") else "否",
                    "根因推测": analysis.get("root_cause", ""),
                    "修复建议": analysis.get("suggested_fix", ""),
                    "处理状态": "待认领",
                    "发现时间": int(time.time() * 1000)
                }
                feishu.insert_record(record_data)

        except KeyboardInterrupt:
            logging.info("守护进程收到退出中断，优雅关闭")
            file.close()
            break
        except Exception as ex:
            logging.error("主循环发生未捕获异常: %s", ex, exc_info=True)
            time.sleep(2)

if __name__ == "__main__":
    run_pipeline(LOG_FILE_PATH)