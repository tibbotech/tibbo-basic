import path = require('path');
import TibboBasicTranspiler from '../src/TibboBasicTranspiler';
import fs = require('fs');
import ini = require('ini');
import TibboBasicProjectTranspiler from '../src/TibboBasicProjectTranspiler';
import TibboBasicPreprocessor from '../src/TibboBasicPreprocessor';

const supportedFileTypes = ['.tbs', '.tbh', '.tph', '.xtxt'];
test('C transpiler test', async () => {
    let error;
    try {
        const workspaceRoot = path.join(__dirname, '..', 'tests', 'ctrans');
        const tprPath = path.join(workspaceRoot, 'MyDevice.tpr');
        const tpr = ini.parse(fs.readFileSync(tprPath, 'utf-8'));
        const max = 999;
        const dirName = path.dirname(tprPath);
        let PLATFORMS_PATH = path.join(__dirname, '..', 'tests', 'Platforms');
        if (fs.existsSync(path.join(workspaceRoot, 'Platforms'))) {
            PLATFORMS_PATH = path.join(workspaceRoot, 'Platforms');
        }
        const preprocessor = new TibboBasicPreprocessor(workspaceRoot, PLATFORMS_PATH);
        const files: any[] = [];
        preprocessor.parsePlatforms();
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
                filePath = preprocessor.parseFile(directory, originalFilePath, false);

                const fileContents = preprocessor.files[filePath];
                files.push({
                    name: originalFilePath,
                    contents: fileContents
                });
            }
            else {
                break;
            }
        }
        // const inputcode = fs.readFileSync(path.join(__dirname, '..', 'testgoto.js'), 'utf-8');
        // const outputcode = gotojs(inputcode);
        // console.log(outputcode);



        // const transpiler = new TibboBasicTranspiler();
        // for (let i = 0; i < files.length; i++) {
        //     const filePath = files[i].name;
        //     const contents = fs.readFileSync(path.join(workspaceRoot, filePath), 'utf-8');
        //     const output = transpiler.parseFile(contents);
        //     let outputExtension = '.cpp';
        //     if (path.extname(filePath) == '.tbh') {
        //         outputExtension = '.h';
        //     }
        //     const newFileName = filePath.substr(0, filePath.length - 4) + outputExtension;
        //     const newFilePath = path.join(__dirname, 'ctransout', newFileName);
        //     if (!fs.existsSync(newFilePath)) {
        //         fs.mkdirSync(path.dirname(newFilePath), { recursive: true });
        //     }
        //     fs.writeFileSync(newFilePath, output);
        // }

        const projectTranspiler = new TibboBasicProjectTranspiler();
        const output = projectTranspiler.transpile(files);
        for (let i = 0; i < output.length; i++) {
            const filePath = output[i].name;
            const newFilePath = path.join('/Users/jimmyhu/Projects/ntios/webasm/app', filePath);
            if (!fs.existsSync(newFilePath)) {
                fs.mkdirSync(path.dirname(newFilePath), { recursive: true });
            }
            fs.writeFileSync(newFilePath, output);
        }
    }
    catch (ex) {
        console.log(ex);
        error = ex;
    }

    expect(error).toBe(undefined);
});
