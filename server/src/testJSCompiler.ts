import path = require('path');
import TibboBasicTranspiler from './TibboBasicTranspiler';
import fs = require('fs');
import TibboBasicJavascriptCompiler from './TibboBasicJavascriptCompiler';
import ini = require('ini');
import TibboBasicPreprocessor from './TibboBasicPreprocessor';
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
        const preprocessor = new TibboBasicPreprocessor(workspaceRoot, PLATFORMS_PATH);
        const files: string[] = [];
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

        const compiler = new TibboBasicJavascriptCompiler();
        const output = compiler.compile(files);
        fs.writeFileSync(path.join(__dirname, '..', '..', 'main.js'), output);
    }
    catch (ex) {
        console.log(ex);
    }

    console.log('transpile ended');
})();



