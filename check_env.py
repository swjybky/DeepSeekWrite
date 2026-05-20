from pathlib import Path
import sys

from app.ai_env import _ai_env_file_candidates, _parse_env_file, load_ai_model_defaults

print("=== 候选文件检查 ===")
for p in _ai_env_file_candidates():
    exists = p.is_file()
    print(f"  {'[存在]' if exists else '[缺失]'} {p}")

print("\n=== 首个存在文件的原始解析结果 ===")
data = {}
for p in _ai_env_file_candidates():
    if p.is_file():
        data = _parse_env_file(p)
        print(f"文件: {p}")
        for k, v in data.items():
            if 'key' in k:
                display = v[:4] + '*' * max(0, len(v) - 4) if len(v) > 4 else '*' * len(v)
                print(f"  {k} = {display} (长度 {len(v)})")
            else:
                print(f"  {k} = {v}")
        break
else:
    print("  没有候选文件存在！")

print("\n=== 必填字段检查 ===")
main_raw = (data.get("model_name_main") or data.get("model_name") or "").strip()
flash_raw = (data.get("model_name_flash") or "").strip()
api_key = (data.get("model_api_key") or "").strip()
source = (data.get("model_source") or data.get("mdoel_source") or "").strip().lower()

print(f"  model_name_main/model_name: {'✅ ' + main_raw if main_raw else '❌ 缺失或为空'}")
print(f"  model_api_key:              {'✅ 已设置 (长度 ' + str(len(api_key)) + ')' if api_key else '❌ 缺失或为空'}")
print(f"  model_source:               {'✅ ' + source if source else '❌ 缺失或为空'}")
print(f"  model_name_flash (可选):    {'✅ ' + flash_raw if flash_raw else '⚪ 未设置'}")

print("\n=== load_ai_model_defaults 返回 ===")
result = load_ai_model_defaults()
print(result if result is not None else "None (配置不完整)")
