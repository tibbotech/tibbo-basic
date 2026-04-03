import { compile, buildAST, parse, link } from '../../src/compiler/index';

describe('Tibbo Basic Compiler', () => {

    describe('Parser', () => {
        it('should parse an empty program', () => {
            const { tree, errors } = parse('');
            expect(tree).toBeDefined();
            expect(errors).toHaveLength(0);
        });

        it('should parse a simple sub', () => {
            const { tree, errors } = parse(`
sub on_sys_init()
end sub
`);
            expect(tree).toBeDefined();
            expect(errors).toHaveLength(0);
        });

        it('should parse variable declarations', () => {
            const { tree, errors } = parse(`
dim x as byte
dim s as string(32)
dim w as word
`);
            expect(tree).toBeDefined();
            expect(errors).toHaveLength(0);
        });
    });

    describe('AST Builder', () => {
        it('should build AST for empty program', () => {
            const { ast } = buildAST('');
            expect(ast.kind).toBe('Program');
            expect(ast.declarations).toHaveLength(0);
        });

        it('should build AST for sub declaration', () => {
            const { ast } = buildAST(`
sub on_sys_init()
end sub
`);
            expect(ast.declarations).toHaveLength(1);
            expect(ast.declarations[0].kind).toBe('SubDecl');
            const sub = ast.declarations[0] as any;
            expect(sub.name).toBe('on_sys_init');
            expect(sub.params).toHaveLength(0);
        });

        it('should build AST for function with return type', () => {
            const { ast } = buildAST(`
function add(byval a as byte, byval b as byte) as word
end function
`);
            expect(ast.declarations).toHaveLength(1);
            expect(ast.declarations[0].kind).toBe('FunctionDecl');
            const fn = ast.declarations[0] as any;
            expect(fn.name).toBe('add');
            expect(fn.params).toHaveLength(2);
            expect(fn.params[0].name).toBe('a');
            expect(fn.params[1].name).toBe('b');
        });

        it('should build AST for dim statement', () => {
            const { ast } = buildAST(`
dim x as byte
dim s as string(32)
`);
            expect(ast.declarations).toHaveLength(2);
            expect(ast.declarations[0].kind).toBe('DimStmt');
            expect(ast.declarations[1].kind).toBe('DimStmt');
        });

        it('should build AST for const declaration', () => {
            const { ast } = buildAST(`
const MAX_LEN = 8
const PI_APPROX = 3
`);
            expect(ast.declarations).toHaveLength(2);
            expect(ast.declarations[0].kind).toBe('ConstDecl');
        });

        it('should build AST for enum declaration', () => {
            const { ast } = buildAST(`
enum my_states
    STATE_IDLE,
    STATE_RUNNING,
    STATE_DONE = 10
end enum
`);
            expect(ast.declarations).toHaveLength(1);
            expect(ast.declarations[0].kind).toBe('EnumDecl');
            const en = ast.declarations[0] as any;
            expect(en.name).toBe('my_states');
            expect(en.members).toHaveLength(3);
        });

        it('should build AST for type declaration', () => {
            const { ast } = buildAST(`
type foo_struct
    x as byte
    s as string
end type
`);
            expect(ast.declarations).toHaveLength(1);
            expect(ast.declarations[0].kind).toBe('TypeDecl');
            const tp = ast.declarations[0] as any;
            expect(tp.name).toBe('foo_struct');
            expect(tp.members).toHaveLength(2);
        });

        it('should build AST for if/then/else', () => {
            const { ast } = buildAST(`
sub test()
    dim x as byte
    if x = 1 then
        x = 2
    else
        x = 3
    end if
end sub
`);
            const sub = ast.declarations[0] as any;
            expect(sub.body.length).toBeGreaterThan(0);
        });

        it('should build AST for for/next loop', () => {
            const { ast } = buildAST(`
sub test()
    dim i as byte
    for i = 0 to 10
    next i
end sub
`);
            const sub = ast.declarations[0] as any;
            const forStmt = sub.body.find((s: any) => s.kind === 'ForStmt');
            expect(forStmt).toBeDefined();
        });

        it('should build AST for while/wend loop', () => {
            const { ast } = buildAST(`
sub test()
    dim x as byte
    while x < 10
        x = x + 1
    wend
end sub
`);
            const sub = ast.declarations[0] as any;
            const whileStmt = sub.body.find((s: any) => s.kind === 'WhileStmt');
            expect(whileStmt).toBeDefined();
        });

        it('should build AST for do/loop', () => {
            const { ast } = buildAST(`
sub test()
    do
    loop
end sub
`);
            const sub = ast.declarations[0] as any;
            const doStmt = sub.body.find((s: any) => s.kind === 'DoLoopStmt');
            expect(doStmt).toBeDefined();
        });

        it('should build AST for select case', () => {
            const { ast } = buildAST(`
sub test()
    dim x as byte
    select case x
        case 1:
        case 2:
    end select
end sub
`);
            const sub = ast.declarations[0] as any;
            const selectStmt = sub.body.find((s: any) => s.kind === 'SelectCaseStmt');
            expect(selectStmt).toBeDefined();
        });

        it('should build AST for object declaration', () => {
            const { ast } = buildAST(`
object sock
`);
            expect(ast.declarations).toHaveLength(1);
            expect(ast.declarations[0].kind).toBe('ObjectDecl');
        });

        it('should build AST for expressions', () => {
            const { ast } = buildAST(`
sub test()
    dim x as byte
    x = 1 + 2 * 3
end sub
`);
            expect(ast.declarations).toHaveLength(1);
        });
    });

    describe('Compilation', () => {
        it('should compile empty program', () => {
            const result = compile('');
            expect(result.obj).toBeDefined();
            expect(result.obj.length).toBeGreaterThan(0);
            expect(result.errors).toHaveLength(0);
        });

        it('should compile a simple sub', () => {
            const result = compile(`
sub on_sys_init()
end sub
`);
            expect(result.obj).toBeDefined();
            expect(result.obj.length).toBeGreaterThan(0);
            expect(result.errors).toHaveLength(0);
        });

        it('should compile variables and assignments', () => {
            const result = compile(`
dim x as byte
sub test()
    dim y as word
    y = 42
    x = y
end sub
`);
            expect(result.errors).toHaveLength(0);
            expect(result.obj.length).toBeGreaterThan(0);
        });

        it('should compile implicit decimal string literal to word/short', () => {
            const result = compile(`
sub on_sys_init()
    dim wa as word = "42"
    dim wb as word = "0"
    wb = "100"
    dim sc as short = "-15"
end sub
`);
            expect(result.errors).toHaveLength(0);
            expect(result.obj.length).toBeGreaterThan(0);
        });

        it('should compile control flow', () => {
            const result = compile(`
sub test()
    dim i as byte
    for i = 0 to 10
    next i

    while i > 0
        i = i - 1
    wend

    if i = 0 then
        i = 1
    end if
end sub
`);
            expect(result.errors).toHaveLength(0);
            expect(result.obj.length).toBeGreaterThan(0);
        });

        it('should compile enum and const', () => {
            const result = compile(`
const MAX = 100
enum status
    OK,
    ERR = 5
end enum

sub test()
    dim x as byte
    x = MAX
end sub
`);
            expect(result.errors).toHaveLength(0);
        });

        it('should compile type declaration', () => {
            const result = compile(`
type point
    x as word
    y as word
end type

sub test()
    dim p as point
    p.x = 10
    p.y = 20
end sub
`);
            expect(result.errors).toHaveLength(0);
        });

        it('should compile function with return value', () => {
            const result = compile(`
function add(byval a as byte, byval b as byte) as word
    add = a + b
end function
`);
            expect(result.errors).toHaveLength(0);
        });

        it('should produce valid TOBJ header', () => {
            const result = compile(`
sub test()
end sub
`);
            const obj = result.obj;
            expect(obj.length).toBeGreaterThan(40);
            // Check TOBJ signature 'TOBJ'
            expect(obj.readUInt32LE(0)).toBe(0x4A424F54);
        });

        it('should compile sample boot.tbs patterns', () => {
            const result = compile(`
declare sub dosomething()
type foo_struct
    x as byte
    s as string
end type

sub boot()
    dim f as byte
    dim i as byte
    dim j as byte
    i = 42
    j = 32

    dim aa as boolean
    dim bb as byte
    dim cc as char
    dim dd as word
    dim ee as short
    dim ff as dword
    dim gg as long

    aa = 1
    bb = 3
    cc = 4
    dd = 5
    ee = 767
    ff = 65531
    gg = 65577

    dim ll as foo_struct
    ll.x = 9

    for i = 0 to 3
    next i

    dosomething()
end sub

sub dosomething()
    dim zz as byte
    zz = 3
end sub
`);
            expect(result.errors).toHaveLength(0);
            expect(result.obj.length).toBeGreaterThan(100);
        });
    });

    describe('Linker', () => {
        it('should link a single obj file', () => {
            const compileResult = compile(`
sub test()
    dim x as byte
    x = 42
end sub
`);
            expect(compileResult.errors).toHaveLength(0);

            const linkResult = link([{ name: 'test.obj', data: compileResult.obj }]);
            expect(linkResult.errors).toHaveLength(0);
            expect(linkResult.tpc).toBeDefined();
            expect(linkResult.tpc.length).toBeGreaterThan(0);
            // Check BIN signature 'TBIN'
            expect(linkResult.tpc.readUInt32LE(0)).toBe(0x4E494254);
        });

        it('should link multiple obj files', () => {
            const r1 = compile(`
declare sub helper()
sub main_sub()
    helper()
end sub
`, { fileName: 'main.tbs' });

            const r2 = compile(`
sub helper()
    dim x as byte
    x = 1
end sub
`, { fileName: 'helper.tbs' });

            expect(r1.errors).toHaveLength(0);
            expect(r2.errors).toHaveLength(0);

            const linkResult = link([
                { name: 'main.obj', data: r1.obj },
                { name: 'helper.obj', data: r2.obj },
            ]);
            expect(linkResult.errors).toHaveLength(0);
            expect(linkResult.tpc.length).toBeGreaterThan(0);
        });
    });
});
