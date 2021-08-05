import SerialPort from "serialport";
import {EspLoader} from "./esptool"
import fs from "fs";

type Partition = {
    name: string;
    data: Uint8Array;
    offset: number;
};

const options = {
    baudRate: 115200,
    erase: false,
    logger: console,
    progressCallback(s: String, idx: number, cnt: number) {
    }
};

async function sleep(n: number) {
    await new Promise(resolve => setTimeout(resolve, n));
}

async function main() {
    const p = "/dev/tty.usbserial-0001";

    // TODO: Here you have to specify the partitions you want to flash to the ESP32.
    const partitions: Partition[] = [
        {
            name: 'bootloader',
            data: fs.readFileSync('/Volumes/Dev/Vysor/MCU/esp-idf/examples/get-started/blink/build/bootloader/bootloader.bin'),
            offset: 0x1000,
        },
        {
            name: 'partition-table',
            data: fs.readFileSync('/Volumes/Dev/Vysor/MCU/esp-idf/examples/get-started/blink/build/partition_table/partition-table.bin'),
            offset: 0x8000,
        },
        {
            name: 'data',
            data: fs.readFileSync('/Volumes/Dev/Vysor/MCU/esp-idf/examples/get-started/blink/build/blink.bin'),
            offset: 0x10000,
        },
    ];

    const port = await new Promise<SerialPort>(resolve => {
        const ret = new SerialPort(p, {
            baudRate: 115200,
        }, () => {
            resolve(ret);
        });
    });
    try {
        const loader = new EspLoader(port, { debug: true, logger: console });
        options.logger.log("connecting...");
        await loader.connect(3000);
        try {
            await loader.sync();
            options.logger.log("connected");

            options.logger.log("writing device partitions");
            const chipName = await loader.chipName();
            const macAddr = await loader.macAddr();
            await loader.loadStub();
            await loader.setBaudRate(options.baudRate, 921600);

            if (options.erase) {
                options.logger.log("erasing device flash...");
                await loader.eraseFlash();
                options.logger.log("successfully erased device flash");
            }

            for (let i = 0; i < partitions.length; i++) {
                options.logger.log("\nWriting partition: " + partitions[i].name);
                await loader.flashData(partitions[i].data, partitions[i].offset, function (idx, cnt) {
                    if (options.progressCallback) {
                        options.progressCallback(partitions[i].name, idx, cnt);
                    }
                });
                await sleep(100);
            }
            options.logger.log("successfully written device partitions");
            options.logger.log("flashing succeeded");
            await loader.flashFinish(true);
            await loader.flashFinish(true);
            await loader.flashFinish(true);
            options.logger.log("reboot succeeded");
        } finally {
            await loader.disconnect();
        }
    } finally {
        await port.close();
    }
}

main();