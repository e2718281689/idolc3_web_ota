// 在文件顶部导入所需的模块
import { ESPLoader, Transport } from 'esptool-js';

document.addEventListener('DOMContentLoaded', () => {
    const connectButton = document.getElementById('connectButton');
    const flashButton = document.getElementById('flashButton');
    const chipSelect = document.getElementById('chip-select');
    const log = document.getElementById('log');

    // 后端 API 地址保持不变
    const BACKEND_URL = 'http://127.0.0.1:8000';
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
            await esploader.connect();
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


    // 2. 烧录固件逻辑 (这部分内部逻辑完全不需要改变)
    flashButton.addEventListener('click', async () => {
        if (!esploader) {
            terminal.writeLine('错误：设备未连接。');
            return;
        }

        flashButton.disabled = true;
        connectButton.disabled = true;
        terminal.clean();
        terminal.writeLine('开始烧录流程...');

        try {
            const selectedChip = chipSelect.value;
            terminal.writeLine(`目标芯片: ${selectedChip}`);

            // A: 获取清单
            terminal.writeLine('正在从后端获取固件清单...');
            const manifestResponse = await fetch(`${BACKEND_URL}/api/firmware/${selectedChip}`);
            if (!manifestResponse.ok) throw new Error(`获取清单失败: ${manifestResponse.statusText}`);
            const manifest = await manifestResponse.json();
            terminal.writeLine('清单获取成功！');

            // B: 下载固件
            const filePromises = manifest.map(async (part) => {
                terminal.writeLine(` -> 正在下载 ${part.file}...`);
                const fileUrl = `${BACKEND_URL}/firmware/${selectedChip}/${part.file}`;
                const fileResponse = await fetch(fileUrl);
                if (!fileResponse.ok) throw new Error(`下载 ${part.file} 失败`);
                const binary = await fileResponse.arrayBuffer();
                const dataAsString = new TextDecoder().decode(new Uint8Array(binary));
                return { data: dataAsString, address: part.address };
            });
            const fileArray = await Promise.all(filePromises);
            terminal.writeLine('所有固件文件下载完成！');

            // C: 烧录
            terminal.writeLine('准备烧录到设备...');
            await esploader.write_flash(
                fileArray, 'keep', 'keep', 'keep', false,
                (fileIndex, written, total) => {
                    const progress = Math.round((written / total) * 100);
                    if (progress % 10 === 0) {
                        terminal.write(`\r烧录文件 ${fileIndex + 1}/${fileArray.length}: ${progress}%`);
                    }
                }
            );
            terminal.writeLine('\n烧录成功！');
            terminal.writeLine('设备将在几秒后重启...');
            await esploader.hard_reset();

        } catch (e) {
            console.error(e);
            terminal.writeLine(`\n烧录过程中发生严重错误: ${e.message}`);
        } finally {
            flashButton.disabled = false;
            connectButton.disabled = false;
        }
    });
});

