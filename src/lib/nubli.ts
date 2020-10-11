import Noble from "@abandonware/noble";
import { PeripheralFilter } from "./peripheralFilter";
import { SmartLockPeripheralFilter } from "./smartLockPeripheralFilter";
import { SmartLock } from "./smartLock";
import Events from 'events';

export class Nubli extends Events.EventEmitter {
    private noble: typeof Noble = Noble;
    private debugEnabled: boolean = false;
    private peripheralFilter: PeripheralFilter;
    private _smartlocks: Array<SmartLock> = [];
    private _configPath: string = "./config/";
    private _scanning: boolean = false;
    private activeScanning: boolean = false;

    constructor(peripheralFilter: PeripheralFilter = new SmartLockPeripheralFilter(), configPath?: string) {
        super();

        this.peripheralFilter = peripheralFilter;

        if (configPath) {
            this._configPath = configPath;
        }

        // Override HCI so we can scan passively.
        this.noble._bindings._hci.setScanParameters = () => {
            var cmd = new Buffer(11);

            let HCI_COMMAND_PKT = 0x01;
            let OCF_LE_SET_SCAN_PARAMETERS = 0x000b;
            let OGF_LE_CTL = 0x08;
            let LE_SET_SCAN_PARAMETERS_CMD = OCF_LE_SET_SCAN_PARAMETERS | OGF_LE_CTL << 10;

            // header
            cmd.writeUInt8(HCI_COMMAND_PKT, 0);
            cmd.writeUInt16LE(LE_SET_SCAN_PARAMETERS_CMD, 1);

            // length
            cmd.writeUInt8(0x07, 3);

            if (this.activeScanning) {
                cmd.writeUInt8(0x01, 4); // type: 0 -> passive, 1 -> active
            } else {
                cmd.writeUInt8(0x00, 4); // type: 0 -> passive, 1 -> active
            }

            cmd.writeUInt16LE(0x0010, 5); // internal, ms * 1.6
            cmd.writeUInt16LE(0x0010, 7); // window, ms * 1.6
            cmd.writeUInt8(0x00, 9); // own address type: 0 -> public, 1 -> random
            cmd.writeUInt8(0x00, 10); // filter: 0 -> all event types

            this.noble._bindings._hci._socket.write(cmd);
        }

        this.noble.on('discover', (peripheral: Noble.Peripheral) => this.peripheralDiscovered(peripheral));
        this.noble.on('stateChange', (state: string) => this.stateChange(state));

        this.noble.on('scanStart', () => {
            if (!this._scanning) {
                this.emit("startedScanning");
                this.debug("Started scanning");
            }

            this._scanning = true;
        })

        // When we connect to an peripheral, scanning will be stopped.
        // This way we make sure to start scanning again after a short delay (500ms).
        this.noble.on('scanStop', () => {
            if (this._scanning) {
                setTimeout(() => {
                    if (this._scanning) {
                        this.startScanning();
                    }
                }, 500);
            } else {
                this.emit("stoppedScanning");
                this.debug("Stopped scanning");
            }
        });
    }

    setDebug(debugEnabled: boolean) {
        this.debugEnabled = debugEnabled;
    }

    private peripheralDiscovered(peripheral: Noble.Peripheral): void {
        for (let smartLock of this._smartlocks) {
            if (peripheral.uuid == smartLock.uuid) {
                if ("manufacturerData" in peripheral.advertisement && peripheral.advertisement.manufacturerData !== null
                && peripheral.advertisement.manufacturerData !== undefined) {
                    smartLock.updateManufacturerData(peripheral.advertisement.manufacturerData);
                }

                return;
            }
        }

        if (!this.peripheralFilter.handle(peripheral)) return;

        this.debug("Peripheral matched filter: " + peripheral.id + " - " + peripheral.advertisement.localName);

        let smartLock: SmartLock = new SmartLock(this, peripheral);

        this._smartlocks.push(smartLock);
        this.emit("smartLockDiscovered", smartLock);
    }

    get smartlocks(): Array<SmartLock> {
        return this._smartlocks;
    }

    private stateChange(state: string): void {
        this.debug("state change: " + state);
        this.emit("state", state);

        if (state == "poweredOn") {
            this.emit("readyToScan");
        }
    }

    debug(message: string) {
        if (this.debugEnabled) {
            console.log(new Date().toLocaleString(), message);
        }
    }

    readyToScan(): boolean {
        return this.noble.state == "poweredOn";
    }

    async onReadyToScan(timeout: number = 10): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.readyToScan()) {
                resolve();
            } else {
                this.once('readyToScan', () => {
                    resolve();
                });
            }

            setTimeout(() => {
                reject('Adapter still not ready after ' + timeout + " seconds");
            }, timeout * 1000)
        });
    }

    startActiveScanning(): void {
        this.activeScanning = true;

        this.startScanning();
    }

    startScanning(): void {
        if (!this.readyToScan()) {
            throw new Error("Scanning only possible if the adapter is ready.");
        }

        this.noble.startScanning([], true);
    }

    stopScanning(): void {
        this._scanning = false;
        this.activeScanning = false;
        this.noble.stopScanning();
    }

    get configPath(): string {
        return this._configPath;
    }

    get scanning(): boolean {
        return this._scanning;
    }
}
