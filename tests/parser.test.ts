
import { TibboBasicPreprocessor } from '../src/TibboBasicPreprocessor';
import { TibboBasicProjectParser } from '../src/TibboBasicProjectParser';
const fs = require('fs');
const path = require('path');
const ini = require('ini');

const projectTestPath = path.join(__dirname, 'parserTests');
const PLATFORMS_PATH = path.join(projectTestPath, 'Platforms');
const supportedFileTypes = ['.tbs', '.tbh', '.tph'];


const platformPreprocessor = new TibboBasicPreprocessor(projectTestPath, PLATFORMS_PATH);
const platformProjectParser = new TibboBasicProjectParser();
const preprocessor = new TibboBasicPreprocessor(projectTestPath, PLATFORMS_PATH);
const projectParser = new TibboBasicProjectParser();
let tprPath = '';
platformPreprocessor.parsePlatforms();
fs.readdirSync(projectTestPath).forEach(file => {
    const ext = path.extname(file);
    if (ext == '.tpr') {
        tprPath = path.join(projectTestPath, file);
    }
});
const tpr = ini.parse(fs.readFileSync(tprPath, 'utf-8'));
const max = 999;
const dirName = path.dirname(tprPath);
for (let i = 0; i < platformPreprocessor.filePriorities.length; i++) {
    const filePath = platformPreprocessor.filePriorities[i];
    test('Parser Test ' + filePath, () => {
        const fileContents = platformPreprocessor.files[filePath];
        platformProjectParser.parseFile(filePath, fileContents);

        expect(platformProjectParser.errors[filePath].length).toBe(0);
    });
}
for (let i = 1; i < max; i++) {
    const entryName = 'file' + i.toString();
    if (tpr[entryName] != undefined) {
        const originalFilePath = tpr[entryName]['path'].split('\\').join(path.sep);
        let filePath = originalFilePath;

        const ext = path.extname(filePath);
        if (!supportedFileTypes.includes(ext)) {
            continue;
        }
        test('Parser Test ' + originalFilePath, () => {
            let directory = dirName;
            if (tpr[entryName]['location'] == 'commonlib') {
                directory = PLATFORMS_PATH;
            }
            filePath = preprocessor.parseFile(directory, originalFilePath, true);

            const fileContents = preprocessor.files[filePath];
            projectParser.parseFile(filePath, fileContents);

            expect(projectParser.errors[filePath].length).toBe(0);
        });
    }
    else {
        break;
    }
}

