import SerialPort from "serialport";
import {EspLoader} from "./esptool"
import fs from "fs";

const p = "/dev/tty.usbserial-0001";

async function main() {
    const port = await new Promise<SerialPort>(resolve => {
        const ret = new SerialPort(p, {
            baudRate: 115200,
        }, () => {
            resolve(ret);
        });
    });

    const loader = new EspLoader(port, { debug: true, logger: console });
    await loader.connect(3000);
    await loader.sync();

    await loader.flashFinish();
}

main();
