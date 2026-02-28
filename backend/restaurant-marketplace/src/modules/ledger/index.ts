import { Module } from "@medusajs/framework/utils";
import Service from "./service";

export const LEDGER_MODULE = "ledger";

export default Module(LEDGER_MODULE, {
  service: Service,
});
