"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const fs = require("fs");
const TibboBasicJavascriptCompiler_1 = require("./TibboBasicJavascriptCompiler");
const ini = require("ini");
const TibboBasicPreprocessor_1 = require("./TibboBasicPreprocessor");
const worker_threads_1 = require("worker_threads");
const { resolve } = require('path');
const { readdir } = require('fs').promises;
const supportedFileTypes = ['.tbs', '.tbh', '.tph'];
// let files = [
//     path.join(__dirname, '..', 'tests', 'jstest', 'global.tbh'),
//     path.join(__dirname, '..', 'tests', 'jstest', 'main.tbs'),
//     path.join(__dirname, '..', 'tests', 'jstest', 'boot.tbs'),
//     path.join(__dirname, '..', 'tests', 'jstest', 'device.tbs'),
// ];
// async function getFiles(dir) {
//     const dirents = await readdir(dir, { withFileTypes: true });
//     const files = await Promise.all(dirents.map((dirent) => {
//         const res = resolve(dir, dirent.name);
//         return dirent.isDirectory() ? getFiles(res) : res;
//     }));
//     return Array.prototype.concat(...files);
// }
(async function start() {
    try {
        const workspaceRoot = path.join(__dirname, '..', 'tests', 'jstest');
        const tprPath = path.join(workspaceRoot, 'MyDevice.tpr');
        const tpr = ini.parse(fs.readFileSync(tprPath, 'utf-8'));
        const max = 999;
        const dirName = path.dirname(tprPath);
        let PLATFORMS_PATH = path.join(__dirname, '..', 'tests', 'Platforms');
        let needsUpdate = true;
        const preprocessor = new TibboBasicPreprocessor_1.default(workspaceRoot, PLATFORMS_PATH);
        const files = [];
        // preprocessor.parsePlatforms();
        // for (let i = 0; i < preprocessor.filePriorities.length; i++) {
        //     const priority = preprocessor.filePriorities[i];
        //     const file = preprocessor.files[priority];
        //     if (file) {
        //         files.push(file);
        //     }
        // }
        for (let i = 1; i < max; i++) {
            const entryName = 'file' + i.toString();
            if (tpr[entryName] != undefined) {
                const originalFilePath = tpr[entryName]['path'].split('\\').join(path.sep);
                let filePath = originalFilePath;
                const ext = path.extname(filePath);
                if (!supportedFileTypes.includes(ext)) {
                    continue;
                }
                let directory = dirName;
                if (tpr[entryName]['location'] == 'commonlib') {
                    directory = PLATFORMS_PATH;
                }
                filePath = preprocessor.parseFile(directory, originalFilePath, needsUpdate);
                const fileContents = preprocessor.files[filePath];
                files.push(fileContents);
            }
            else {
                break;
            }
        }
        const compiler = new TibboBasicJavascriptCompiler_1.default();
        const output = compiler.compile(files);
        const worker = new worker_threads_1.Worker(output, { eval: true });
        await new Promise((resolve, reject) => {
            setTimeout(() => {
                worker.terminate();
                resolve();
            }, 3000);
        });
        // fs.writeFileSync(path.join(__dirname, '..', '..', 'main.js'), output);
    }
    catch (ex) {
        console.log(ex);
    }
    console.log('transpile test ended');
})();
//# sourceMappingURL=testJSCompiler.js.map