import path = require('path');
import TibboBasicTranspiler from './TibboBasicTranspiler';
import fs = require('fs');




const files = [
    'device.tbs',
    'main.tbs',
    'global.tbh',
    'boot.tbs',
    'Platforms/src/2_01_03/dhcp/trunk/dhcp.tbh',
    'Platforms/src/2_01_03/dhcp/trunk/dhcp.tbs',
];

for (let i = 0; i < files.length; i++) {
    const transpiler = new TibboBasicTranspiler();
    const filePath = path.join(__dirname, '..', 'tests', files[i]);
    const contents = fs.readFileSync(filePath, 'utf-8');
    const output = transpiler.parseFile(contents);
    let outputExtension = '.tc';
    if (path.extname(filePath) == '.tbh') {
        outputExtension = '.th';
    }
    const newFileName = filePath.substr(0, filePath.length - 4) + outputExtension;
    fs.writeFileSync(newFileName, output);
}
