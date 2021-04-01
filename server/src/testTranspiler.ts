import path = require('path');
import TibboBasicTranspiler from './TibboBasicTranspiler';


const transpiler = new TibboBasicTranspiler();

transpiler.parseFile(path.join(__dirname, '..', 'tests', 'main.tbs'));