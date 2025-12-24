// 在文件顶部导入所需的模块
import { ESPLoader, Transport } from 'esptool-js';
import JSZip from "jszip";

document.addEventListener('DOMContentLoaded', () => {
    const connectButton = document.getElementById('connectButton');
    const flashButton = document.getElementById('flashButton');
    const chipSelect = document.getElementById('chip-select');
    const log = document.getElementById('log');

    let device, transport, esploader;

    // terminal 对象保持不变
    const terminal = {
        clean() { log.innerHTML = ''; },
        writeLine(data) { log.innerHTML += data + '\n'; log.scrollTop = log.scrollHeight; },
        write(data) { log.innerHTML += data; log.scrollTop = log.scrollHeight; },
    };

    // 1. 连接设备逻辑
    connectButton.addEventListener('click', async () => {
        if (device) {
            // 如果 transport 存在，则断开连接
            if (transport) {
                await transport.disconnect();
            }
            device = undefined;
            transport = undefined;
            esploader = undefined;
            connectButton.textContent = '1. 连接设备';
            flashButton.disabled = true;
            terminal.writeLine('设备已断开。');
            return;
        }

        try {
            device = await navigator.serial.requestPort({});
            transport = new Transport(device);
            
            const baudrate = (chipSelect.value === 'esp32c3') ? 115200 : 921600;

            esploader = new ESPLoader({
                transport,
                baudrate,
                terminal: terminal,
            });

            // ==========================================================
            //  核心修改在这里！
            // ==========================================================
            terminal.writeLine('正在连接设备...');
            await esploader.main();
            // ==========================================================

            connectButton.textContent = '断开连接';
            flashButton.disabled = false;
            terminal.writeLine('设备连接成功！');
            terminal.writeLine(`芯片: ${esploader.chip.CHIP_NAME}`);
        } catch (e) {
            console.error(e);
            terminal.writeLine(`错误: ${e.message}`);
            if (transport) {
                await transport.disconnect();
            }
            device = undefined;
        }
    });

    function u8ToBinaryString(u8) {
        const CHUNK = 0x8000;
        let result = "";
        for (let i = 0; i < u8.length; i += CHUNK) {
            result += String.fromCharCode(...u8.subarray(i, i + CHUNK));
        }
        return result;
    }

    // 2. 烧录固件逻辑 (最终的、基于官方示例验证的正确版本)
    flashButton.addEventListener('click', async () => {
        if (!esploader) {
            terminal.writeLine('错误：设备未连接。');
            return;
        }

        // 禁用按钮，防止重复点击
        flashButton.disabled = true;
        connectButton.disabled = true;
        terminal.clean();
        terminal.writeLine('开始烧录流程...');

        try {
            const selectedChip = chipSelect.value;
            terminal.writeLine(`目标芯片: ${selectedChip}`);


            const workerUrl = 'https://spring-morning-16c2.cjia3254.workers.dev/'; 
            const originalUrl = 'github.com/e2718281689/idol-c3/releases/download/v1.0.1/firmware-v1.0.1-.zip';

            // 拼接
            const proxyUrl = workerUrl + originalUrl; 

            const resp = await fetch(proxyUrl);
            if (!resp.ok) throw new Error("Failed to fetch zip");

            const buffer = await resp.arrayBuffer();
            const zip = await JSZip.loadAsync(buffer);

            Object.keys(zip.files).forEach((name) => {
                console.log("file:", name);
            });

            const manifest = JSON.parse(
            await zip.file("flasher_args.json").async("string")
            );
            console.log("file:", manifest);

            for (const [offset, file] of Object.entries(manifest.flash_files)) 
            {
                console.log("offset:", offset, "file:", file); 
            }

            // const baseDir = manifestPath.includes("/")? manifestPath.slice(0, manifestPath.lastIndexOf("/") + 1): "";
            // 构造 esptool-js 需要的 fileArray
            const fileArray = [];
            for (const [offsetStr, relPath] of Object.entries(manifest.flash_files)) {
                const address = parseInt(offsetStr); // 支持 "0x..."
                const filePath = relPath;

                const entry = zip.file(filePath);
                if (!entry) throw new Error(`Missing file in zip: ${filePath} (offset ${offsetStr})`);

                // 用 "string" 返回 binary string，兼容你现有 CryptoJS + esptool-js 写法
                const u8 = await entry.async("uint8array");
                const data = u8ToBinaryString(u8);     // ✅ 变成 binary string

                fileArray.push({ address, data });
            }

            fileArray.sort((a, b) => a.address - b.address);

            await esploader.writeFlash({
                fileArray: fileArray,
                flashMode: "dio",   // "dio"
                flashSize: "4MB",   // "4MB"
                flashFreq: "80m",   // "80m"
                eraseAll: false,
                compress: true,
            });

            await esploader.after?.();   // 有则调用
            await transport.setDTR(false);
            await new Promise(r => setTimeout(r, 100));
            await transport.setDTR(true);

            

        } catch (e) {
            console.error(e);
            terminal.writeLine(`\n烧录过程中发生严重错误: ${e.message}`);
        } finally {
            // UI 状态更新：烧录流程结束后，重置所有状态到初始未连接状态
            if (transport && device && transport.connected) {
                 try { await transport.disconnect(); } catch(e) { /* 忽略错误 */ }
            }
            device = undefined;
            transport = undefined;
            esploader = undefined;
            connectButton.textContent = '1. 连接设备';
            flashButton.disabled = true;
            connectButton.disabled = false;
        }
    });


});

