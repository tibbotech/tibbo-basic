import TibboBasicPreprocessor from '../src/TibboBasicPreprocessor';
const fs = require('fs');
const path = require('path');
import TibboBasicErrorListener from '../src/TibboBasicErrorListener';
const antlr4 = require('antlr4');
const TibboBasicPreprocessorLexer = require('../language/TibboBasic/lib/TibboBasicPreprocessorLexer').TibboBasicPreprocessorLexer;
const TibboBasicPreprocessorParser = require('../language/TibboBasic/lib/TibboBasicPreprocessorParser').TibboBasicPreprocessorParser;
import { PreprocessorListener } from '../src/TibboBasicPreprocessor';


const PLATFORMS_PATH = path.join(__dirname, 'Platforms');
let preprocessor: TibboBasicPreprocessor = new TibboBasicPreprocessor(__dirname, PLATFORMS_PATH);;
const extensions = ['.tph', '.tbs', '.tbh']

function getDirTests(dir: string) {
    const items = fs.readdirSync(dir);
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const tmpPath = path.join(dir, item);
        const extension = path.extname(item);
        if (!extensions.includes(extension)) {
            let stats = fs.lstatSync(tmpPath);
            if (stats.isDirectory()) {
                getDirTests(path.join(dir, item));
            }
            continue;
        }
        test('Preprocessor Test ' + item, async () => {
            const contents = fs.readFileSync(tmpPath, 'utf8');
            preprocessor.files[tmpPath] = contents;
            const chars = new antlr4.InputStream(contents);

            const lexer = new TibboBasicPreprocessorLexer(chars);
            const tokens = new antlr4.CommonTokenStream(lexer);
            const parser = new TibboBasicPreprocessorParser(tokens);
            parser.buildParseTrees = true;
            const errorListener = new TibboBasicErrorListener();
            parser.removeErrorListeners();
            parser.addErrorListener(errorListener);
            const tree = parser.preprocessor();

            const tmpPreprocessor = new PreprocessorListener(tmpPath, preprocessor, chars);
            try {
                antlr4.tree.ParseTreeWalker.DEFAULT.walk(tmpPreprocessor, tree);
            }
            catch(ex) {
                console.log(tmpPath);
            }
            
            expect(errorListener.errors.length).toBe(0);
        });
    }
}

getDirTests(PLATFORMS_PATH);