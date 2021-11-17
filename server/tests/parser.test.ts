
import TibboBasicPreprocessor from '../src/TibboBasicPreprocessor';
import TibboBasicProjectParser from '../src/TibboBasicProjectParser';
const fs = require('fs');
const path = require('path');
import ini = require('ini');

const PLATFORMS_PATH = path.join(__dirname, 'Platforms');
const supportedFileTypes = ['.tbs', '.tbh', '.tph'];


const platformPreprocessor = new TibboBasicPreprocessor(path.join(__dirname), PLATFORMS_PATH);
const platformProjectParser = new TibboBasicProjectParser();
const preprocessor = new TibboBasicPreprocessor(__dirname, PLATFORMS_PATH);
const projectParser = new TibboBasicProjectParser();
let tprPath = '';
platformPreprocessor.parsePlatforms();
fs.readdirSync(__dirname).forEach(file => {
    const ext = path.extname(file);
    if (ext == '.tpr') {
        tprPath = path.join(__dirname, file);
    }
});
const tpr = ini.parse(fs.readFileSync(tprPath, 'utf-8'));
const max = 999;
const dirName = path.dirname(tprPath);
for (const filePath in platformPreprocessor.files) {
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

