export interface PeripheralFilter {
    handle(peripheral: import("@abandonware/noble").Peripheral): boolean;
}
