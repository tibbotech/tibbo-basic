"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable @typescript-eslint/no-var-requires */
const path = require("path");
const TibboBasicTranspiler_1 = require("./TibboBasicTranspiler");
const fs = require("fs");
const { resolve } = require('path');
const { readdir } = require('fs').promises;
const files = [
    path.join(__dirname, '..', 'tests', 'global.tbh'),
    path.join(__dirname, '..', 'tests', 'main.tbs'),
    path.join(__dirname, '..', 'tests', 'device.tbs'),
    path.join(__dirname, '..', 'tests', 'boot.tbs'),
    path.join(__dirname, '..', 'tests', 'super_spi.tbs'),
    path.join(__dirname, '..', 'tests', 'tbt42.tbs'),
    path.join(__dirname, '..', 'tests', 'super_i2c.tbs'),
];
function getFiles(dir) {
    return __awaiter(this, void 0, void 0, function* () {
        const dirents = yield readdir(dir, { withFileTypes: true });
        const files = yield Promise.all(dirents.map((dirent) => {
            const res = resolve(dir, dirent.name);
            return dirent.isDirectory() ? getFiles(res) : res;
        }));
        return Array.prototype.concat(...files);
    });
}
(function start() {
    return __awaiter(this, void 0, void 0, function* () {
        const tmpFiles = yield getFiles(path.join(__dirname, '..', 'tests', 'Platforms'));
        for (let i = 0; i < tmpFiles.length; i++) {
            const filePath = tmpFiles[i];
            const extension = path.extname(filePath);
            if (extension == '.tbs' || extension == '.tbh') {
                files.push(filePath);
            }
        }
        const transpiler = new TibboBasicTranspiler_1.default();
        for (let i = 0; i < files.length; i++) {
            try {
                const filePath = files[i];
                console.log('parsing ' + filePath);
                const contents = fs.readFileSync(filePath, 'utf-8');
                const output = transpiler.parseFile(contents);
                let outputExtension = '.tc';
                if (path.extname(filePath) == '.tbh') {
                    outputExtension = '.th';
                }
                const newFileName = filePath.substr(0, filePath.length - 4) + outputExtension;
                fs.writeFileSync(newFileName, output);
            }
            catch (ex) {
                console.log(ex);
            }
        }
        console.log('transpile ended');
    });
})();
//# sourceMappingURL=testTranspiler.js.map