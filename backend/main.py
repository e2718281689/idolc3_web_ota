# backend/main.py

import os
import json
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict

app = FastAPI()

# --- CORS 配置 (保持不变) ---
origins = ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 动态生成固件清单 ---

FIRMWARE_BASE_PATH = os.path.join(os.path.dirname(__file__), "firmware")

def get_manifest_from_json(chip_type: str) -> List[Dict]:
    """
    解析 flasher_args.json 文件并生成前端所需的清单格式。
    """
    manifest_path = os.path.join(FIRMWARE_BASE_PATH, chip_type, "flasher_args.json")
    
    if not os.path.exists(manifest_path):
        raise HTTPException(status_code=404, detail=f"Manifest file for {chip_type} not found.")

    try:
        with open(manifest_path, "r") as f:
            flasher_args = json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse manifest file: {e}")

    # 从 "flash_files" 字段中提取文件和地址
    flash_files = flasher_args.get("flash_files", {})
    if not flash_files:
        raise HTTPException(status_code=404, detail="No flash files found in manifest.")
        
    # 构建前端需要的格式: [{"file": "...", "address": ...}, ...]
    # 注意：地址是字符串，需要转换为整数
    frontend_manifest = []
    for address_str, file_path in flash_files.items():
        # 将 "0x..." 格式的地址字符串转换为整数
        address_int = int(address_str, 16)
        
        # 文件名可能包含路径，我们只需要文件名部分用于 URL
        # 但我们需要完整路径来定位文件
        full_file_path = os.path.join(FIRMWARE_BASE_PATH, chip_type, file_path)
        if not os.path.exists(full_file_path):
            print(f"Warning: File not found, skipping: {full_file_path}")
            continue

        frontend_manifest.append({
            "file": file_path,  # 保持原始路径，因为前端会用它来构建 URL
            "address": address_int
        })

    # 按地址排序，这对于烧录过程是好习惯
    frontend_manifest.sort(key=lambda x: x["address"])
    
    return frontend_manifest

@app.get("/api/firmware/{chip_type}")
async def get_firmware_manifest(chip_type: str):
    """
    根据芯片类型，动态读取其 flasher_args.json 并返回清单。
    """
    return get_manifest_from_json(chip_type)


@app.get("/firmware/{chip_type}/{file_path:path}")
async def download_firmware_file(chip_type: str, file_path: str):
    """
    提供二进制固件文件的下载。
    使用 :path 来捕获包含 '/' 的文件路径。
    """
    # 构建文件的绝对路径
    full_file_path = os.path.join(FIRMWARE_BASE_PATH, chip_type, file_path)

    if not os.path.exists(full_file_path):
        raise HTTPException(status_code=404, detail=f"File not found at path: {file_path}")

    # 从路径中提取文件名
    filename = os.path.basename(file_path)

    return FileResponse(path=full_file_path, media_type="application/octet-stream", filename=filename)


@app.get("/")
def read_root():
    return {"message": "ESP Web Flasher API (Dynamic Manifest) is running."}

