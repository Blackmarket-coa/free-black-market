"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncStatus = exports.ImportStatus = void 0;
var ImportStatus;
(function (ImportStatus) {
    ImportStatus["PENDING"] = "pending";
    ImportStatus["IN_PROGRESS"] = "in_progress";
    ImportStatus["COMPLETED"] = "completed";
    ImportStatus["FAILED"] = "failed";
    ImportStatus["CANCELLED"] = "cancelled";
})(ImportStatus || (exports.ImportStatus = ImportStatus = {}));
var SyncStatus;
(function (SyncStatus) {
    SyncStatus["IDLE"] = "idle";
    SyncStatus["SYNCING"] = "syncing";
    SyncStatus["FAILED"] = "failed";
})(SyncStatus || (exports.SyncStatus = SyncStatus = {}));
